from datetime import datetime
from uuid import UUID
from app.investigation.repository import to_record

def test_repository_decodes_json_and_normalizes_legacy_timestamp():
    row={"id":UUID(int=1),"incident_id":UUID(int=2),"status":"completed","summary":"S","root_cause":"R","confidence":.8,"severity":"high","affected_subsystems":["propulsion"],"evidence":'[{"source":"x","section":"s","finding":"f"}]',"alternative_causes":[],"recommended_actions":'[{"title":"t","rationale":"r"}]',"error_message":None,"tokens_used":1,"duration_ms":2,"created_at":datetime(2026,9,20),"completed_at":datetime(2026,9,20)}
    result=to_record(row)
    assert result["result"]["evidence"][0]["source"]=="x"
    assert result["created_at"].endswith("+00:00")
