from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


Text = Annotated[str, Field(min_length=1, max_length=4000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InvestigationStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class EvidenceCitation(StrictModel):
    source: Annotated[str, Field(min_length=1, max_length=255)]
    section: Annotated[str, Field(min_length=1, max_length=255)]
    finding: Text


class RecommendedAction(StrictModel):
    title: Annotated[str, Field(min_length=1, max_length=255)]
    rationale: Text


class InvestigationResult(StrictModel):
    summary: Text
    root_cause: Text
    confidence: float = Field(ge=0, le=1)
    severity: Annotated[str, Field(pattern="^(info|warning|high|critical)$")]
    affected_subsystems: Annotated[list[Annotated[str, Field(min_length=1, max_length=50)]], Field(min_length=1, max_length=20)]
    evidence: Annotated[list[EvidenceCitation], Field(min_length=1, max_length=20)]
    alternative_causes: Annotated[list[Text], Field(max_length=10)]
    recommended_actions: Annotated[list[RecommendedAction], Field(min_length=1, max_length=10)]


class InvestigationRecord(StrictModel):
    id: str
    incident_id: str
    status: InvestigationStatus
    result: InvestigationResult | None = None
    error_message: str | None = None
    tokens_used: int | None = None
    duration_ms: int | None = None
    created_at: str
    completed_at: str | None = None
