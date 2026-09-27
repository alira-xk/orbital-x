import json
from datetime import timezone

def decoded(value): return json.loads(value) if isinstance(value,str) else value
def timestamp(value): return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value).isoformat()

def to_record(row):
    d=dict(row); result=None
    if d["status"]=="completed":
        result={k:d[k] for k in ("summary","root_cause","confidence","severity","affected_subsystems","evidence","alternative_causes","recommended_actions")}
        result["evidence"],result["recommended_actions"]=decoded(result["evidence"]),decoded(result["recommended_actions"])
    return {"id":str(d["id"]),"incident_id":str(d["incident_id"]),"status":d["status"],"result":result,"error_message":d["error_message"],"tokens_used":d["tokens_used"],"duration_ms":d["duration_ms"],"created_at":timestamp(d["created_at"]),"completed_at":timestamp(d["completed_at"]) if d["completed_at"] else None}

class PostgresInvestigationRepository:
    def __init__(self,pool): self.pool=pool
    async def create(self,incident_id,provider,model):
        return to_record(await self.pool.fetchrow("INSERT INTO ai_investigations(incident_id,status,provider,model) VALUES($1::uuid,'in_progress',$2,$3) RETURNING *",incident_id,provider,model))
    async def complete(self,row_id,result,tokens,duration):
        async with self.pool.acquire() as c:
            async with c.transaction():
                row=await c.fetchrow("""UPDATE ai_investigations SET summary=$2,root_cause=$3,confidence=$4,severity=$5,affected_subsystems=$6,evidence=$7::jsonb,alternative_causes=$8,recommended_actions=$9::jsonb,status='completed',tokens_used=$10,duration_ms=$11,completed_at=now() WHERE id=$1::uuid RETURNING *""",row_id,result.summary,result.root_cause,result.confidence,result.severity,result.affected_subsystems,json.dumps([x.model_dump() for x in result.evidence]),result.alternative_causes,json.dumps([x.model_dump() for x in result.recommended_actions]),tokens,duration)
                await c.execute("INSERT INTO incident_timeline(incident_id,event_type,description,metadata) VALUES($1,'ai_investigation_completed','AI investigation completed',$2::jsonb)",row["incident_id"],json.dumps({"investigationId":str(row["id"]),"confidence":result.confidence}))
        return to_record(row)
    async def fail(self,row_id,message,duration):
        return to_record(await self.pool.fetchrow("UPDATE ai_investigations SET status='failed',error_message=$2,duration_ms=$3,completed_at=now() WHERE id=$1::uuid RETURNING *",row_id,message,duration))
    async def get(self,row_id):
        row=await self.pool.fetchrow("SELECT * FROM ai_investigations WHERE id=$1::uuid",row_id); return to_record(row) if row else None
    async def list(self,incident_id,limit=20):
        return [to_record(x) for x in await self.pool.fetch("SELECT * FROM ai_investigations WHERE incident_id=$1::uuid ORDER BY created_at DESC LIMIT $2",incident_id,limit)]
