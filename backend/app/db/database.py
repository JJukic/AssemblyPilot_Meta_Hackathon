import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.core.config import BACKEND_ROOT, Settings
from app.db import tables  # noqa: F401 -- registers all schema metadata

logger = logging.getLogger(__name__)


def database_engine(settings: Settings) -> Engine:
    url = make_url(settings.database_url)
    if url.drivername != "sqlite":
        raise ValueError("Phase 2 supports SQLite only")
    options = {}
    if not url.database or url.database == ":memory:":
        options["poolclass"] = StaticPool
    else:
        path = Path(url.database).expanduser()
        if not path.is_absolute():
            path = BACKEND_ROOT / path
        path = path.resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        url = url.set(database=str(path))
    engine = create_engine(url, connect_args={"check_same_thread": False}, **options)

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")

    SQLModel.metadata.create_all(engine)
    return engine


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine, expire_on_commit=False) as session:
        yield session


def cleanup_files(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # DB no longer exposes these files. Report failure; never undo a committed DB deletion.
            logger.exception("Could not clean up registered image %s", path.name)


def get_write_session(request: Request) -> Iterator[Session]:
    """Serialize read-modify-write operations, including step order, across SQLite writers."""
    with Session(request.app.state.engine, expire_on_commit=False) as session:
        try:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            yield session
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            cleanup_files(session.info.get("created_files", []))
            raise HTTPException(
                409, "Conflicting reference or concurrent change; reload and retry"
            ) from exc
        except OperationalError as exc:
            session.rollback()
            cleanup_files(session.info.get("created_files", []))
            raise HTTPException(503, "Local database unavailable or busy; please retry") from exc
        except BaseException:
            session.rollback()
            cleanup_files(session.info.get("created_files", []))
            raise
        else:
            cleanup_files(session.info.get("deleted_files", []))


ReadSession = Annotated[Session, Depends(get_session)]
# Commit before sending the HTTP response, so errors never appear as successful saves.
WriteSession = Annotated[Session, Depends(get_write_session, scope="function")]
