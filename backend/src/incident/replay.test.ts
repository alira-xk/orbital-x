import { PostgresIncidentRepository } from './repository.js';
import type { TelemetryDatabase, TelemetryDatabaseClient } from '../telemetry/repository.js';

const incident = {
  id: '00000000-0000-4000-8000-000000000010', incident_number: 1000, spacecraft_id: 'ORBITAL-X1',
  title: 'Leak', description: null, severity: 'critical', status: 'resolved', root_cause: null,
  affected_subsystems: ['propulsion'], created_at: '2026-09-17T09:00:00.000Z', updated_at: '2026-09-17T09:02:00.000Z',
  acknowledged_at: null, acknowledged_by: null, resolved_at: '2026-09-17T09:02:00.000Z', resolved_by: null,
};

it('assembles recorded metrics without allowing them to overwrite replay metadata', async () => {
  const results = [
    { rows: [incident] },
    { rows: [{ timestamp: '2026-09-17T09:00:00.000Z', metrics: { fuel_pressure: 1.7, spacecraft_id: 42 } }] },
    { rows: [] }, { rows: [] },
  ];
  const client = { query: jest.fn(async () => results.shift()), release: jest.fn() } as unknown as TelemetryDatabaseClient;
  const database = { getClient: async () => client } as TelemetryDatabase;

  const replay = await new PostgresIncidentRepository(database).replay(incident.id);

  expect(replay?.frames[0]).toEqual(expect.objectContaining({ spacecraft_id: 'ORBITAL-X1', fuel_pressure: 1.7 }));
  expect(client.release).toHaveBeenCalled();
});
