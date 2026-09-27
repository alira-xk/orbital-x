import request from 'supertest';
import { createApp } from '../app.js';
import type { AuthService } from '../auth/service.js';
import type { IncidentRepository } from '../incident/repository.js';
import type { InvestigationClient } from './client.js';
import { UnauthorizedError } from '../utils/errors.js';

const incidentId = '00000000-0000-4000-8000-000000000010';
const incidentRepository = { detail: async () => ({ incident: { id: incidentId }, alerts: [], timeline: [] }) } as unknown as IncidentRepository;
const result = { id:'00000000-0000-4000-8000-000000000030', incident_id:incidentId, status:'completed', error_message:null, tokens_used:42,
  duration_ms:100, created_at:'2026-09-20T00:00:00.000Z', completed_at:'2026-09-20T00:00:01.000Z', result:{summary:'Leak likely',root_cause:'Valve leak',confidence:.91,severity:'high',affected_subsystems:['propulsion'],evidence:[{source:'propulsion.md',section:'Leaks',finding:'Pressure fell'}],alternative_causes:['Sensor drift'],recommended_actions:[{title:'Inspect valve',rationale:'Confirm leak'}]} } as const;

const authService = { me: async (token?: string) => {
  if (token !== 'valid') throw new UnauthorizedError();
  return { id:'00000000-0000-4000-8000-000000000099',username:'operator',role:'engineer' };
} } as AuthService;

describe('investigation gateway', () => {
  it('requires authentication before starting', async () => {
    const client = { start: async () => result, list: async () => [result] } as InvestigationClient;
    const response = await request(createApp({ incidentRepository, investigationClient:client, authService }))
      .post(`/api/incidents/${incidentId}/investigations`);
    expect(response.status).toBe(401);
  });

  it('starts and lists validated durable investigations', async () => {
    const client = { start: async () => result, list: async () => [result] } as InvestigationClient;
    const app=createApp({ incidentRepository, investigationClient:client, authService });
    const started=await request(app).post(`/api/incidents/${incidentId}/investigations`).set('Cookie','access_token=valid');
    const listed=await request(app).get(`/api/incidents/${incidentId}/investigations?limit=10`);
    expect(started.status).toBe(200); expect(started.body.data.result.confidence).toBe(.91);
    expect(listed.status).toBe(200); expect(listed.body.data).toHaveLength(1);
  });
});
