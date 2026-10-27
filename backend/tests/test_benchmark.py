import pytest
from pydantic import ValidationError

from benchmark_inspection import BenchmarkManifest, main, summarize


def test_benchmark_errors_remain_in_denominator():
    result = summarize(
        [
            {
                "diagnosis": {},
                "status_match": True,
                "issue_types_match": True,
                "model_latency_ms": 120,
            },
            {
                "diagnosis": {},
                "status_match": False,
                "issue_types_match": True,
                "model_latency_ms": 80,
            },
            {"error_code": "meta_timeout"},
        ]
    )
    assert result["completed"] == 2
    assert result["failed"] == 1
    assert result["status_accuracy"] == pytest.approx(1 / 3)
    assert result["issue_type_exact_match"] == pytest.approx(2 / 3)
    assert result["mean_model_latency_ms"] == 100
    assert result["localization_accuracy"] is None


def test_no_successful_cases_has_no_invented_latency():
    result = summarize([{"error_code": "meta_invalid_response"}])
    assert result["status_accuracy"] == 0
    assert result["mean_model_latency_ms"] is None
    assert summarize([])["status_accuracy"] is None


@pytest.mark.parametrize(
    "cases",
    [
        [],
        [{"id": "case"}],
        [
            {
                "id": "case",
                "project_id": "project",
                "step_id": "step",
                "image": "test.jpg",
                "expected_status": "correct",
                "expected_issue_types": ["missing_part"],
            }
        ],
    ],
)
def test_invalid_manifest_labels_rejected(cases):
    with pytest.raises(ValidationError):
        BenchmarkManifest.model_validate({"cases": cases})


def test_benchmark_requires_explicit_live_opt_in(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["benchmark_inspection.py"])
    assert main() == 77
    assert "No Meta requests" in capsys.readouterr().out
