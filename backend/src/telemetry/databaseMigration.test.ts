import {
  TELEMETRY_SCHEMA_MIGRATION,
  migrateTelemetrySchema,
  type TelemetryMigrationClient,
} from './databaseMigration.js';

class RecordingMigrationClient implements TelemetryMigrationClient {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  async query(text: string, values?: readonly unknown[]): Promise<unknown> {
    this.calls.push({ text, values });
    return undefined;
  }
}

describe('migrateTelemetrySchema', () => {
  it('repairs legacy telemetry rows before replacing the idempotency index and recording the migration', async () => {
    const client = new RecordingMigrationClient();

    await migrateTelemetrySchema(client);

    const statements = client.calls.map(({ text }) => text);
    const migrationRecordIndex = client.calls.findIndex(({ text }) => text.includes('INSERT INTO migrations'));
    const duplicateRemovalIndex = client.calls.findIndex(({ text }) => text.includes('ROW_NUMBER() OVER'));
    const indexDropIndex = client.calls.findIndex(({ text }) => text.includes('DROP INDEX IF EXISTS'));
    const indexCreateIndex = client.calls.findIndex(({ text }) => text.includes('CREATE UNIQUE INDEX'));

    expect(statements[0]).toBe('BEGIN');
    expect(statements.join('\n')).toContain("timestamp AT TIME ZONE 'UTC'");
    expect(statements.join('\n')).toContain('DELETE FROM telemetry');
    expect(statements.join('\n')).toContain('SET subsystem = COALESCE');
    expect(duplicateRemovalIndex).toBeGreaterThan(-1);
    expect(indexDropIndex).toBeGreaterThan(duplicateRemovalIndex);
    expect(indexCreateIndex).toBeGreaterThan(indexDropIndex);
    expect(client.calls[migrationRecordIndex]).toEqual({
      text: 'INSERT INTO migrations (name) VALUES ($1)',
      values: [TELEMETRY_SCHEMA_MIGRATION],
    });
    expect(statements.at(-1)).toBe('COMMIT');
  });
});
