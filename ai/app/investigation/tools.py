class EvidenceTools:
    def __init__(self, pool): self.pool = pool
    async def load_incident(self, incident_id):
        incident = await self.pool.fetchrow("SELECT * FROM incidents WHERE id=$1::uuid", incident_id)
        if not incident: raise LookupError("Incident not found")
        alerts = await self.pool.fetch("SELECT a.* FROM alerts a JOIN incident_alerts ia ON ia.alert_id=a.id WHERE ia.incident_id=$1::uuid ORDER BY a.created_at LIMIT 100", incident_id)
        timeline = await self.pool.fetch("SELECT * FROM incident_timeline WHERE incident_id=$1::uuid ORDER BY timestamp LIMIT 200", incident_id)
        telemetry = await self.pool.fetch("SELECT spacecraft_id,timestamp,subsystem,metric,value,unit FROM telemetry WHERE spacecraft_id=$1 ORDER BY timestamp DESC LIMIT 500", incident["spacecraft_id"])
        return {"incident":dict(incident),"alerts":[dict(x) for x in alerts],"timeline":[dict(x) for x in timeline],"telemetry":[dict(x) for x in telemetry]}
