# PR #6 integration review — 2026-10-29

> **Historical record.** A review of the repository on 2026-10-29. The pull request states here are as of that
> date.

Reviewed main `edbdef0`, original PR #6 `743ba77`, and PR #7 `a795e8e`.
PR #5 (SAM) is merged; #6 and #7 remain open. This update merges main into
**the feature branch**, not the feature PR into main. No PR is merged or closed.

## Exact conflicts and decisions

Reproducing `git merge origin/main` on the original PR #6 yielded seven files with
text conflicts. No blanket ours/theirs resolution was used. The already reviewed
integration commit `1941fe8` from PR #7 provided the combined implementation;
its final tested orchestrator and fixture corrections were reused selectively.
No OpenCV/calibration dependency or feature is introduced into PR #6.

| Conflicting file | PR #6 side | main side | Resolution |
| --- | --- | --- | --- |
| `backend/app/api/inspection.py` | Route through AssemblyOrchestrator; workflow response and fresh verification | Build context and call inspect_with_metadata with injected SamClient | Keep orchestrator and workflow routes; inject both MetaClient and SamClient for inspect **and** verify; invoke existing localization inside the orchestrator on each new image |
| `frontend/src/lib/inspection.ts` | Workflow validation, verifySnapshot and getProgress | SAM response image hash validation | Retain both protocols and all functions; use workflow state rather than inspection_id as discriminator; both initial and verification responses validate their own JPEG hash; preserve SAM-compatible timeout |
| `frontend/src/app/globals.css` | Correction/verification states, fresh preview, finding history | Segmentation controls, masks, SAM boxes and ambiguity display | Keep both independent CSS rule groups |
| `README.md` | Phase 4 introduction, correction workflow and limitations | SAM introduction, configuration/smoke instructions and limitations | Describe both features, preserve both workflows and remove stale claims that SAM is unmerged or verification absent |
| `docs/architecture.md` | Coordinator, sessions, fresh evidence and SQLite progress | SAM adapter/parser, localization and overlays | Document one active workflow with optional localization after each new diagnosis; distinguish standalone smoke/benchmark wrapper |
| `docs/inspection-api.md` | Verification/progress endpoints and workflow fields | SAM IDs, segmentations, provenance and fallback | Retain both additive contract sections |
| `docs/validation.md` | Phase 4 checks and limits | Phase 3C checks and limits | Preserve separate dated validation sections rather than interleave headings/tables; add this current integration review |

The frontend types did **not** produce text conflict markers, but required semantic
review. `InspectionResponse` retains SAM IDs and segmentations; `WorkflowInspection`
extends it with required server IDs, specification version, state, findings and
correction actions. The runtime validators enforce both contracts. Main's ordinary
SAM responses already have inspection_id, so that field alone must not trigger
workflow validation. Legacy Phase 3B and standalone SAM responses remain readable.

The backend diagnosis model likewise auto-merged: preserve private Muse attempt
metadata **and** SAM provenance validation. WorkflowInspectionResponse inherits the
SAM fields. The active orchestrator must explicitly populate segmentations: simply
retaining main's old inspection wrapper would bypass Phase 4, while retaining the
original Phase 4 orchestrator would omit SAM and fail the new response contract.

## Preserved behavior

- Existing Muse-only endpoint, model, prompt/context/reference selection, structured
  diagnoses, retry behavior and legacy image validation are unchanged.
- The planner is deterministic; acknowledgement cannot mark a repair verified.
  Verification independently assesses a new snapshot and outstanding findings.
- Session expiry, duplicate/cross-context/busy-frame checks, specification version
  checks, persistent SQLite progress and explicit next-step navigation remain.
- Active Vision requests a new view for uncertainty; SAM does not change that state.
- SAM operates on the exact current Muse JPEG, with per-issue limits, validated masks
  and snapshot identities. Missing/uncertain cases retain their existing skip policy.
  Ambiguous, empty, disabled or unavailable localization preserves Muse's diagnosis
  and valid boxes. Expiry is rechecked after SAM before recording completion.
- No boxes/masks are rendered on moving video or copied from an earlier inspection.

Regression fixtures were updated to include the now-required segmentation array
and to validate the combined workflow response class. New integration assertions
exercise SAM empty/outage behavior during verification and browser mask/fallback
rendering together with unresolved Phase 4 findings.

## PR #7 comparison

PR #7 contains original Phase 4 commit `743ba77` in its ancestry and the two-parent
integration `1941fe8` (parents: original Phase 4 and current main). It does not merely
reimplement a subset of Phase 4. Its coordinator, inspection routes, Muse/SAM
adapters, workflow models, planner, verification client, progress service, frontend
inspection client and workflow types match this resolved implementation.

Its additional changes are OpenCV calibration/capture functionality, corresponding
UI notices, tests and documentation. The correction UI, fresh capture API, selected
references, SQLite progress and Active Vision remain present. Therefore **PR #7
already functionally supersedes the original PR #6**. This review's extra regression
cases and documentation cleanup are new to #6, not yet present in #7.

## Verification and merge recommendation

Resolved PR #6 passed `make lint`, `make test` (265 Python tests plus TypeScript),
`make build` and `make test-browser` (38 tests). Unchanged PR #7 is checked
independently; its results are reported with the review. Tests use synthetic images and mocked Meta transport;
no live Muse/SAM inference or physical camera acceptance is claimed by this review.

Recommended sequence: review and approve the narrower resolved PR #6 first. After
it merges, refresh PR #7 from the resulting main, retain this review's additional
tests/documentation cleanup, rerun checks, and review its calibration delta separately.
This keeps Phase 4 delivery separate from the still-pending real calibration experiment.

Alternative: if the combined Phase 4 + 4.1A scope is explicitly approved, PR #7 can
replace #6 functionally. Carry over the extra regression/documentation changes and
refresh checks first. Close #6 as superseded only with explicit approval. There is
no need to merge the Phase 4 implementation twice. This review does neither action.
