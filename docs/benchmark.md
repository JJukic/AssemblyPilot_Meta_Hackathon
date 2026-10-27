# Real-image inspection benchmark

This is a small, explicit evaluation of Meta inspection on your own labelled photos, not a training dataset or an autonomous agent loop. No reference photographs, test photographs, results or accuracy claims are fabricated. At implementation time the cloud registry had zero projects, steps and reference images, and no backend API key was available. Consequently **no real benchmark or successful live inference has been recorded**.

## Prepare a small dataset

1. Register a real project and its blocks/steps using the existing UI. Upload actual component photos and a correctly assembled step reference. Do not use the test photograph as the reference unless that is deliberately the control case.
2. Take 1–10 test photographs. A useful small set includes a correct build, one missing part, one misplaced part, wrong color, wrong orientation, an unexpected part and an obscured/ambiguous view. Label only errors you actually constructed/observed; do not invent cases to fill the list.
3. Keep lighting/viewpoint reasonably consistent for error comparisons. For an Active Vision case, retain both the obstructed view and the requested follow-up view as separate labelled cases. The harness does not automatically take images or infer labels.
4. Save a manifest beside your local photos, preferably under ignored `backend/data/benchmark/`. Image paths resolve relative to the manifest. Project/step IDs refer to your current registry; references come through the same ownership-checked loader as the UI.

Manifest shape (replace every placeholder and set labels from the real photograph; this is input documentation, not an AI result):

```json
{
  "cases": [
    {
      "id": "your-labelled-case",
      "project_id": "YOUR_PROJECT_ID",
      "step_id": "YOUR_STEP_ID",
      "image": "your-real-photo.jpg",
      "expected_status": "incorrect",
      "expected_issue_types": ["wrong_orientation"]
    }
  ]
}
```

Case IDs must be unique. Expected status is `correct`, `incorrect` or `uncertain`. Issue types use the diagnostic API enum; correct requires no expected issues, incorrect requires at least one. At most ten cases are accepted.

## Run explicitly

Configure `MODEL_API_KEY` in the backend environment or existing `backend/.env`, then:

```sh
cd backend
uv run --frozen python benchmark_inspection.py \
  --manifest data/benchmark/manifest.json \
  --output data/benchmark/run-001.json \
  --run-live
```

This sends potentially billable Meta requests, sequentially, with the adapter's bounded retry policy. All photographs/context are validated before the first request. The runner refuses to overwrite an existing report. Missing opt-in, manifest argument or credentials produces `SKIPPED` and exit 77. Invalid input or failed API cases return nonzero. Successful requests with incorrect predictions still finish evaluation with exit 0; inspect the metrics rather than treating exit 0 as model accuracy.

The JSON report records the configured model, validated diagnoses, timestamp, measured Meta call latency, normalized input SHA-256 and reference count for each case. It excludes embedded image bytes and credentials; keep the original photos and registry references unchanged for review/reproduction. Reports may contain descriptions of your assembly and should remain outside Git with the real images.

## Interpret results

- **Status accuracy:** exact status matches divided by all cases, including failed requests in the denominator.
- **Issue-type exact match:** equality of expected and reported issue-type sets divided by all cases. This does not measure part-ID/count accuracy or per-instance matching.
- **Mean model latency:** successful adapter calls, including retries/backoff and response parsing; not pure model compute time. Failed calls are counted separately and do not get a fabricated latency.
- **Localization accuracy:** explicitly null. The manifest has no spatial ground truth; valid 0–1 coordinates alone do not prove correct localization. Review the actual boxes against the exact analyzed snapshot in the UI, or add a separately labelled localization dataset before scoring IoU.

Small datasets do not establish general recognition reliability. Record occlusion, image angle, reference availability, schema failures, and whether Active Vision produced useful instructions. There is currently no evidence that Muse Spark localization is insufficient, so SAM is deliberately absent. No benchmark is part of ordinary tests/CI.
