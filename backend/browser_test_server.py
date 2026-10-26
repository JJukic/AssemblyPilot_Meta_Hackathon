"""Disposable API for Playwright. Never opens the developer's database or upload directory."""

from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn

from app.core.config import Settings
from app.main import create_app

if __name__ == "__main__":
    with TemporaryDirectory(prefix="assemblypilot-browser-") as directory:
        root = Path(directory)
        settings = Settings(
            _env_file=None,
            database_url=f"sqlite:///{root / 'browser.db'}",
            upload_dir=str(root / "uploads"),
            frontend_origin="http://localhost:3000",
        )
        uvicorn.run(create_app(settings), host="127.0.0.1", port=8000)
