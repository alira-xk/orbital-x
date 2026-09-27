import { PostgresTelemetryRepository } from './repository.js';

class RecordingClient {
  readonly calls: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  failInserts = false;
  rows: unknown[] = [];

  async query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ text, values });
    if (this.failInserts && text.startsWith('INSERT INTO telemetry')) {
      throw new Error('database unavailable');
    }
    return { rows: this.rows };
  }

  release(): void {
    this.released = true;
  }
}

const frame = {
  timestamp: '2026-09-10T12:00:00.000Z',
  spacecraft_id: 'ORBITAL-X1',
  simulation_time: 1,
  scenario: 'NORMAL',
  fuel_pressure: 2.45,
  future_sensor: 18.5,
};

describe('PostgresTelemetryRepository', () => {
  it('stores every known and unknown metric in one parameterized transaction', async () => {
    const client = new RecordingClient();
    const repository = new PostgresTelemetryRepository({
      getClient: async () => client,
    });

    await repository.store(frame);

    const inserts = client.calls.filter(({ text }) => text.startsWith('INSERT INTO telemetry'));
    expect(client.calls[0]).toEqual({ text: 'BEGIN', values: undefined });
    expect(inserts).toHaveLength(2);
    expect(inserts.map(({ values }) => values)).toEqual([
      ['ORBITAL-X1', '2026-09-10T12:00:00.000Z', 'propulsion', 'fuel_pressure', 2.45],
      ['ORBITAL-X1', '2026-09-10T12:00:00.000Z', 'unknown', 'future_sensor', 18.5],
    ]);
    expect(inserts.every(({ text }) => text.includes('VALUES ($1, $2, $3, $4, $5)'))).toBe(true);
    expect(client.calls.at(-1)).toEqual({ text: 'COMMIT', values: undefined });
    expect(client.released).toBe(true);
  });

  it('rolls back and rethrows when a metric insert fails', async () => {
    const client = new RecordingClient();
    client.failInserts = true;
    const repository = new PostgresTelemetryRepository({
      getClient: async () => client,
    });

    await expect(repository.store(frame)).rejects.toThrow('database unavailable');

    expect(client.calls.map(({ text }) => text)).toContain('ROLLBACK');
    expect(client.calls.map(({ text }) => text)).not.toContain('COMMIT');
    expect(client.released).toBe(true);
  });

  it('returns the latest row for each metric keyed by metric', async () => {
    const client = new RecordingClient();
    client.rows = [
      {
        spacecraft_id: 'ORBITAL-X1',
        timestamp: new Date('2026-09-10T12:00:00.000Z'),
        subsystem: 'propulsion',
        metric: 'fuel_pressure',
        value: 2.45,
        unit: null,
      },
      {
        spacecraft_id: 'ORBITAL-X1',
        timestamp: new Date('2026-09-10T11:59:59.000Z'),
        subsystem: 'power',
        metric: 'battery_level',
        value: 92,
        unit: '%',
      },
    ];
    const repository = new PostgresTelemetryRepository({
      getClient: async () => client,
    });

    const result = await repository.latest('ORBITAL-X1');

    expect(result).toEqual({
      fuel_pressure: {
        spacecraft_id: 'ORBITAL-X1',
        timestamp: '2026-09-10T12:00:00.000Z',
        subsystem: 'propulsion',
        metric: 'fuel_pressure',
        value: 2.45,
        unit: null,
      },
      battery_level: {
        spacecraft_id: 'ORBITAL-X1',
        timestamp: '2026-09-10T11:59:59.000Z',
        subsystem: 'power',
        metric: 'battery_level',
        value: 92,
        unit: '%',
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].text).toContain('DISTINCT ON (metric)');
    expect(client.calls[0].text).toContain('WHERE spacecraft_id = $1');
    expect(client.calls[0].text).toContain('ORDER BY metric, timestamp DESC');
    expect(client.calls[0].values).toEqual(['ORBITAL-X1']);
    expect(client.released).toBe(true);
  });

  it('queries bounded history with parameter values and chronological ordering', async () => {
    const client = new RecordingClient();
    client.rows = [
      {
        spacecraft_id: 'ORBITAL-X1',
        timestamp: '2026-09-10T11:59:58.000Z',
        subsystem: 'propulsion',
        metric: 'fuel_pressure',
        value: 2.4,
        unit: null,
      },
    ];
    const repository = new PostgresTelemetryRepository({
      getClient: async () => client,
    });

    const result = await repository.history({
      spacecraftId: 'ORBITAL-X1',
      metric: 'fuel_pressure',
      from: '2026-09-10T11:59:00.000Z',
      to: '2026-09-10T12:01:00.000Z',
      limit: 250,
    });

    expect(result).toEqual(client.rows);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].text).toContain('spacecraft_id = $1');
    expect(client.calls[0].text).toContain('metric = $2');
    expect(client.calls[0].text).toContain('timestamp >= $3::timestamptz');
    expect(client.calls[0].text).toContain('timestamp <= $4::timestamptz');
    expect(client.calls[0].text).toContain('ORDER BY timestamp ASC');
    expect(client.calls[0].text).toContain('LIMIT $5');
    expect(client.calls[0].values).toEqual([
      'ORBITAL-X1',
      'fuel_pressure',
      '2026-09-10T11:59:00.000Z',
      '2026-09-10T12:01:00.000Z',
      250,
    ]);
    expect(client.released).toBe(true);
  });

  it('queries aggregated history in parameterized time buckets', async () => {
    const client = new RecordingClient();
    client.rows = [
      {
        spacecraft_id: 'ORBITAL-X1',
        timestamp: new Date('2026-09-10T11:55:00.000Z'),
        subsystem: 'propulsion',
        metric: 'fuel_pressure',
        value: '2.45',
        min: '2.40',
        max: '2.50',
        unit: 'MPa',
      },
    ];
    const repository = new PostgresTelemetryRepository({
      getClient: async () => client,
    });

    const result = await repository.history({
      spacecraftId: 'ORBITAL-X1',
      metric: 'fuel_pressure',
      from: '2026-09-10T11:00:00.000Z',
      to: '2026-09-10T12:00:00.000Z',
      bucketSeconds: 300,
      limit: 500,
    });

    expect(result).toEqual([{
      spacecraft_id: 'ORBITAL-X1',
      timestamp: '2026-09-10T11:55:00.000Z',
      subsystem: 'propulsion',
      metric: 'fuel_pressure',
      value: 2.45,
      min: 2.4,
      max: 2.5,
      unit: 'MPa',
    }]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].text).toContain('date_bin');
    expect(client.calls[0].text).toContain('AVG(value)');
    expect(client.calls[0].text).toContain('MIN(value)');
    expect(client.calls[0].text).toContain('MAX(value)');
    expect(client.calls[0].text).toContain('ORDER BY timestamp ASC');
    expect(client.calls[0].text).toContain('LIMIT $6');
    expect(client.calls[0].values).toEqual([
      'ORBITAL-X1',
      'fuel_pressure',
      '2026-09-10T11:00:00.000Z',
      '2026-09-10T12:00:00.000Z',
      300,
      500,
    ]);
    expect(client.released).toBe(true);
  });

  it('returns an empty history result without synthesizing buckets', async () => {
    const client = new RecordingClient();
    const repository = new PostgresTelemetryRepository({
      getClient: async () => client,
    });

    const result = await repository.history({
      spacecraftId: 'ORBITAL-X1',
      metric: 'fuel_pressure',
      bucketSeconds: 60,
      limit: 100,
    });

    expect(result).toEqual([]);
  });
});
