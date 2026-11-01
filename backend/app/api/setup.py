"""Read-only draft generation and atomic, idempotent, explicitly confirmed creation."""

import hashlib
import json
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.db.database import ReadSession, WriteSession
from app.db.tables import AssemblyProject, AssemblyStep, BuildingBlock, SetupReceipt
from app.models.projects import ProjectDetail, StepInput
from app.models.setup import SetupCommit, SetupDescription, validate_plan
from app.services.block_service import require_block
from app.services.image_processor import ImageValidationError, process_image
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import load_reference_image
from app.services.media_service import images_for, store_image
from app.services.project_service import ordered_steps, public_project, public_step, replace_blocks
from app.services.setup_planner import SetupPlanner

router = APIRouter(prefix="/api/setup", tags=["assembly setup"])
SettingsDep = Annotated[Settings, Depends(get_settings)]
Payload = Annotated[str, Form(max_length=200000)]
Photos = Annotated[list[UploadFile], File()]


def get_planner(settings: SettingsDep):
    return SetupPlanner(settings)


async def inputs(payload, photos, model, settings):
    try:
        try:
            data = model.model_validate_json(payload)
        except ValidationError:
            raise HTTPException(
                422, "Invalid setup. Check name, blocks, quantities, steps and confirmation."
            ) from None
        if len(photos) > 41:
            raise HTTPException(
                422, "Use at most one photo per block and step, plus the finished build."
            )
        images, total = {}, 0
        for upload in photos:
            name = upload.filename or ""
            if name in images:
                raise HTTPException(422, "Duplicate photo key")
            raw = await upload.read(settings.max_upload_bytes + 1)
            total += len(raw)
            if total > 24 * 1024 * 1024:
                raise HTTPException(
                    413, "Photos exceed the 24 MiB setup limit. Use smaller images."
                )
            processed = await run_in_threadpool(process_image, raw, settings)
            images[name] = (raw, processed)
        expected = {b.photo for b in data.blocks if b.photo}
        if data.finished_photo:
            expected.add(data.finished_photo)
        if isinstance(data, SetupCommit):
            for index in data.step_photos:
                if index not in {str(i) for i in range(len(data.plan.steps))}:
                    raise HTTPException(422, "Photo belongs to an unknown step")
            expected.update(data.step_photos.values())
        if expected != set(images):
            raise HTTPException(422, "Selected photos are missing or not assigned to this plan")
        return data, images
    except ImageValidationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
    finally:
        for upload in photos:
            await upload.close()


def resolve_inventory(session, data):
    for block in data.blocks:
        if block.existing_id:
            stored = require_block(session, block.existing_id)
            block.name, block.color = stored.name, stored.color


@router.post("/draft")
async def draft(
    payload: Payload,
    session: ReadSession,
    settings: SettingsDep,
    planner: Annotated[SetupPlanner, Depends(get_planner)],
    photos: Photos = [],
):
    data, images = await inputs(payload, photos, SetupDescription, settings)
    resolve_inventory(session, data)
    labelled = []
    if data.finished_photo:
        labelled.append(
            ("Human-provided finished assembly reference", images[data.finished_photo][1])
        )
    try:
        for block in data.blocks:
            if block.photo:
                labelled.append((f"Block reference for key {block.key}", images[block.photo][1]))
            elif block.existing_id:
                references = images_for(session, block_id=block.existing_id)
                if references:
                    image = await run_in_threadpool(
                        load_reference_image,
                        session,
                        settings,
                        references[0].id,
                        block_id=block.existing_id,
                    )
                    labelled.append((f"Library reference for key {block.key}", image))
        plan = await planner.propose(data, labelled)
        # Also validate injected/custom transports before exposing a draft.
        validate_plan(plan, data.blocks)
        return {"plan": plan, "model": settings.meta_vision_model, "requires_confirmation": True}
    except InspectionError as exc:
        raise HTTPException(exc.status_code, {"code": exc.code, "message": str(exc)}) from None
    except ValueError:
        raise HTTPException(
            502, "Meta proposed unknown blocks or quantities. Edit manually or retry."
        ) from None


def detail(session, project):
    return ProjectDetail(
        **public_project(session, project).model_dump(),
        steps=[public_step(session, s) for s in ordered_steps(session, project.id)],
    )


@router.post("/projects", response_model=ProjectDetail, status_code=201)
async def commit(
    payload: Payload, session: WriteSession, settings: SettingsDep, photos: Photos = []
):
    data, images = await inputs(payload, photos, SetupCommit, settings)
    try:
        validate_plan(data.plan, data.blocks)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "data": data.model_dump(mode="json"),
                "photos": {
                    key: hashlib.sha256(value[0]).hexdigest()
                    for key, value in sorted(images.items())
                },
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    receipt = session.get(SetupReceipt, str(data.request_id))
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise HTTPException(
                409,
                "This save already completed with another plan. "
                "Open the saved project or start a new setup.",
            )
        return detail(session, session.get(AssemblyProject, receipt.project_id))
    resolve_inventory(session, data)
    project = AssemblyProject(name=data.name, description=data.description)
    session.add(project)
    session.flush()
    ids = {}
    for item in data.blocks:
        if item.existing_id:
            block = require_block(session, item.existing_id)
        else:
            block = BuildingBlock(
                name=item.name,
                color=item.color,
                default_quantity=item.quantity,
                description="; ".join(
                    filter(
                        None,
                        [
                            f"Printed text note: {item.printed_text}" if item.printed_text else "",
                            f"Logo note: {item.logo_description}" if item.logo_description else "",
                        ],
                    )
                )
                or None,
                category="custom",
                shape="unspecified",
            )
            session.add(block)
            session.flush()
        ids[item.key] = block.id
        if item.photo:
            store_image(
                session, settings, images[item.photo][0], "block-reference.jpg", block_id=block.id
            )
    for index, proposed in enumerate(data.plan.steps):
        instruction = proposed.instruction
        if proposed.limitations:
            instruction += "\nRequirements not established by this setup: " + "; ".join(
                proposed.limitations
            )
        step = AssemblyStep(
            project_id=project.id, position=index + 1, title=proposed.title, instruction=instruction
        )
        session.add(step)
        session.flush()
        text = proposed.print_check
        replace_blocks(
            session,
            step,
            StepInput(
                title=step.title,
                instruction=step.instruction,
                required_blocks=[
                    {"block_id": ids[p.block_key], "required_quantity": p.quantity}
                    for p in proposed.parts
                ],
                simple_print={
                    "target_block_id": ids[text.block_key],
                    "expected_text": text.expected_text,
                }
                if text
                else None,
            ),
        )
        # A finished-build photo is not the correct reference for intermediate steps.
        photo_key = data.step_photos.get(str(index))
        if not photo_key and index == len(data.plan.steps) - 1:
            photo_key = data.finished_photo
        if photo_key:
            store_image(
                session, settings, images[photo_key][0], "step-reference.jpg", step_id=step.id
            )
    session.add(
        SetupReceipt(
            request_id=str(data.request_id), project_id=project.id, fingerprint=fingerprint
        )
    )
    session.flush()
    return detail(session, project)
