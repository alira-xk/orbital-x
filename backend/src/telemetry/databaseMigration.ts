export const TELEMETRY_SCHEMA_MIGRATION = '20260910_telemetry_timestamptz_idempotency';

export interface TelemetryMigrationClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Converges pre-Phase-3 telemetry tables with the canonical TIMESTAMPTZ and
 * idempotency schema. Legacy TIMESTAMP values are interpreted as UTC.
 */
export async function migrateTelemetrySchema(client: TelemetryMigrationClient): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(`
      ALTER TABLE telemetry
      DROP CONSTRAINT IF EXISTS telemetry_spacecraft_id_fkey
    `);
    await client.query(`
      ALTER TABLE telemetry
      ALTER COLUMN spacecraft_id TYPE VARCHAR(100) USING spacecraft_id::TEXT
    `);
    await client.query(`
      DO $$
      DECLARE timestamp_type text;
      BEGIN
        SELECT data_type INTO timestamp_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'telemetry'
          AND column_name = 'timestamp';

        IF timestamp_type = 'timestamp without time zone' THEN
          ALTER TABLE telemetry
          ALTER COLUMN timestamp TYPE TIMESTAMPTZ
          USING timestamp AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);
    await client.query(`
      DELETE FROM telemetry
      WHERE spacecraft_id IS NULL
         OR timestamp IS NULL
         OR metric IS NULL
         OR value IS NULL
    `);
    await client.query(`
      UPDATE telemetry
      SET subsystem = COALESCE(NULLIF(subsystem, ''), 'unknown')
      WHERE subsystem IS NULL OR subsystem = ''
    `);
    await client.query(`
      ALTER TABLE telemetry
      ALTER COLUMN spacecraft_id SET NOT NULL,
      ALTER COLUMN timestamp SET NOT NULL,
      ALTER COLUMN subsystem SET NOT NULL,
      ALTER COLUMN metric SET NOT NULL,
      ALTER COLUMN value SET NOT NULL
    `);
    await client.query(`
      DELETE FROM telemetry
      WHERE id IN (
        SELECT id
        FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY spacecraft_id, metric, timestamp
              ORDER BY id
            ) AS duplicate_rank
          FROM telemetry
        ) AS duplicates
        WHERE duplicate_rank > 1
      )
    `);
    await client.query('DROP INDEX IF EXISTS idx_telemetry_spacecraft_metric_timestamp');
    await client.query(`
      CREATE UNIQUE INDEX idx_telemetry_spacecraft_metric_timestamp
      ON telemetry(spacecraft_id, metric, timestamp)
    `);
    await client.query('INSERT INTO migrations (name) VALUES ($1)', [TELEMETRY_SCHEMA_MIGRATION]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
