from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlmodel import select

from app.core.config import Settings, get_settings
from app.db.database import ReadSession, WriteSession
from app.db.tables import AssemblyProject, now
from app.models.projects import ProjectDetail, ProjectInput, ProjectRead
from app.services.media_service import images_for, schedule_image_cleanup
from app.services.project_service import ordered_steps, public_project, public_step, require_project

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
def list_projects(session: ReadSession):
    projects = session.exec(
        select(AssemblyProject).order_by(AssemblyProject.created_at, AssemblyProject.id)
    ).all()
    return [public_project(session, project) for project in projects]


@router.post("", response_model=ProjectRead, status_code=201)
def create_project(data: ProjectInput, session: WriteSession):
    project = AssemblyProject(**data.model_dump())
    session.add(project)
    session.flush()
    return public_project(session, project)


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, session: ReadSession):
    project = require_project(session, project_id)
    return ProjectDetail(
        **public_project(session, project).model_dump(),
        steps=[public_step(session, step) for step in ordered_steps(session, project_id)],
    )


@router.put("/{project_id}", response_model=ProjectRead)
def update_project(project_id: str, data: ProjectInput, session: WriteSession):
    project = require_project(session, project_id)
    project.sqlmodel_update(data.model_dump())
    project.updated_at = now()
    session.add(project)
    session.flush()
    return public_project(session, project)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: str, session: WriteSession, settings: Annotated[Settings, Depends(get_settings)]
):
    project = require_project(session, project_id)
    for step in ordered_steps(session, project_id):
        schedule_image_cleanup(session, settings, images_for(session, step_id=step.id))
    session.delete(project)  # Foreign keys cascade steps/assignments/images, never reusable blocks.
    session.flush()
    return Response(status_code=204)
