import pytest
from pydantic import ValidationError

from app.investigation.models import InvestigationResult


def valid_result():
    return {
        "summary": "Pressure loss matches an upstream propulsion leak.",
        "root_cause": "Propellant isolation valve leak",
        "confidence": 0.91,
        "severity": "high",
        "affected_subsystems": ["propulsion"],
        "evidence": [{"source": "propulsion.md", "section": "Leaks", "finding": "Pressure fell below 2 MPa."}],
        "alternative_causes": ["Pressure sensor drift"],
        "recommended_actions": [{"title": "Inspect isolation valve", "rationale": "Confirm the leak before recovery."}],
    }


def test_result_accepts_complete_structured_output():
    result = InvestigationResult.model_validate(valid_result())
    assert result.confidence == 0.91
    assert result.evidence[0].source == "propulsion.md"


@pytest.mark.parametrize("change", [{"confidence": 1.1}, {"extra": True}, {"evidence": []}])
def test_result_rejects_untrusted_invalid_output(change):
    with pytest.raises(ValidationError):
        InvestigationResult.model_validate({**valid_result(), **change})
