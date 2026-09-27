export const INCIDENT_MANAGEMENT_SCHEMA_MIGRATION = '20260914_incident_management';
export const INCIDENT_MANAGEMENT_REPAIR_MIGRATION = '20260914_incident_management_repairs';

export interface IncidentManagementMigrationClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
}

// A JSON array preserves field positions, NULLs, empty strings and delimiters.
// Normalize every status once; consolidation reuses this exact fingerprint.
const NORMALIZE_LEGACY_ALERTS_SQL = `
  UPDATE alerts
  SET fingerprint = md5(jsonb_build_array(spacecraft_id, metric, subsystem)::TEXT),
      last_seen_at = COALESCE(last_seen_at, created_at)
`;

/**
 * Converges the legacy alert and incident schema with telemetry's simulator
 * spacecraft identifiers, then adds the Phase 6 persistence foundation.
 */
export async function migrateIncidentManagementSchema(
  client: IncidentManagementMigrationClient,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [INCIDENT_MANAGEMENT_SCHEMA_MIGRATION]);
    const migrationRecord = await client.query(
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name',
      [INCIDENT_MANAGEMENT_SCHEMA_MIGRATION],
    ) as { rows?: readonly unknown[] };
    if (migrationRecord.rows?.length === 0) {
      await client.query('COMMIT');
      return;
    }

    await client.query(`
      ALTER TABLE alerts
      DROP CONSTRAINT IF EXISTS alerts_spacecraft_id_fkey
    `);
    await client.query(`
      ALTER TABLE incidents
      DROP CONSTRAINT IF EXISTS incidents_spacecraft_id_fkey
    `);
    await client.query(`
      ALTER TABLE alerts
      ALTER COLUMN spacecraft_id TYPE VARCHAR(100) USING spacecraft_id::TEXT
    `);
    await client.query(`
      ALTER TABLE incidents
      ALTER COLUMN spacecraft_id TYPE VARCHAR(100) USING spacecraft_id::TEXT
    `);
    await client.query(`
      ALTER TABLE alerts
      ADD COLUMN IF NOT EXISTS fingerprint TEXT,
      ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS detection_method VARCHAR(50)
    `);
    // An upgraded database may already index distinct legacy fingerprints.
    // Rebuild within this transaction so canonicalization can temporarily collide.
    await client.query('DROP INDEX IF EXISTS idx_alerts_active_fingerprint');
    await client.query(NORMALIZE_LEGACY_ALERTS_SQL);
    await client.query(`
      ALTER TABLE alerts
      ALTER COLUMN fingerprint SET NOT NULL,
      ALTER COLUMN last_seen_at SET NOT NULL,
      ALTER COLUMN last_seen_at SET DEFAULT CURRENT_TIMESTAMP
    `);
    await client.query(`
      ALTER TABLE alerts
      DROP CONSTRAINT IF EXISTS alerts_detection_method_check,
      ADD CONSTRAINT alerts_detection_method_check
      CHECK (detection_method IS NULL OR detection_method IN ('rule', 'rate', 'ml', 'hybrid'))
    `);
    await consolidateLegacyAlertDuplicates(client);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_fingerprint
      ON alerts(spacecraft_id, fingerprint)
      WHERE status IN ('active', 'acknowledged')
    `);
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS incident_number_seq START WITH 1000
    `);
    await client.query(`
      ALTER TABLE incidents
      ADD COLUMN IF NOT EXISTS incident_number BIGINT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id)
    `);
    await client.query(`
      ALTER TABLE incidents
      ALTER COLUMN incident_number SET DEFAULT nextval('incident_number_seq')
    `);
    await client.query(`
      UPDATE incidents
      SET incident_number = nextval('incident_number_seq')
      WHERE incident_number IS NULL
    `);
    await client.query(`
      UPDATE incidents
      SET title = COALESCE(NULLIF(title, ''), 'Incident ' || incident_number::TEXT)
      WHERE title IS NULL OR title = ''
    `);
    await client.query(`
      ALTER TABLE incidents
      ALTER COLUMN incident_number SET NOT NULL,
      ALTER COLUMN title SET NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_incident_number
      ON incidents(incident_number)
    `);
    await client.query(`
      ALTER TABLE incidents
      DROP CONSTRAINT IF EXISTS incidents_status_check,
      ADD CONSTRAINT incidents_status_check
      CHECK (status IN ('open', 'investigating', 'acknowledged', 'resolved', 'reopened'))
    `);
    await client.query(`
      ALTER TABLE incident_timeline
      ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id)
    `);
    await client.query(`
      DO $$
      DECLARE timestamp_type text;
      BEGIN
        SELECT data_type INTO timestamp_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'incident_timeline'
          AND column_name = 'timestamp';

        IF timestamp_type = 'timestamp without time zone' THEN
          ALTER TABLE incident_timeline
          ALTER COLUMN timestamp TYPE TIMESTAMPTZ
          USING timestamp AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_timeline_incident_timestamp
      ON incident_timeline(incident_id, timestamp ASC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_timeline_actor_timestamp
      ON incident_timeline(actor_id, timestamp ASC)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires
      ON auth_sessions(user_id, expires_at)
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Applies repairs needed by databases that recorded the original Phase 6 migration. */
export async function migrateIncidentManagementRepairs(
  client: IncidentManagementMigrationClient,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [INCIDENT_MANAGEMENT_REPAIR_MIGRATION]);
    const migrationRecord = await client.query(
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name',
      [INCIDENT_MANAGEMENT_REPAIR_MIGRATION],
    ) as { rows?: readonly unknown[] };
    if (migrationRecord.rows?.length === 0) {
      await client.query('COMMIT');
      return;
    }

    // DROP INDEX holds the table lock until commit; concurrent writers cannot
    // observe the gap before consolidation and recreation of the unique index.
    await client.query('DROP INDEX IF EXISTS idx_alerts_active_fingerprint');
    await client.query(NORMALIZE_LEGACY_ALERTS_SQL);
    await client.query(`
      ALTER TABLE alerts
      ALTER COLUMN last_seen_at SET NOT NULL,
      ALTER COLUMN last_seen_at SET DEFAULT CURRENT_TIMESTAMP
    `);
    await consolidateLegacyAlertDuplicates(client);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_fingerprint
      ON alerts(spacecraft_id, fingerprint)
      WHERE status IN ('active', 'acknowledged')
    `);
    await client.query(`
      UPDATE incidents
      SET title = COALESCE(NULLIF(title, ''), 'Incident ' || incident_number::TEXT)
      WHERE title IS NULL OR title = ''
    `);
    await client.query(`
      ALTER TABLE incidents
      ALTER COLUMN title SET NOT NULL
    `);
    await client.query(`
      DO $$
      DECLARE timestamp_type text;
      BEGIN
        SELECT data_type INTO timestamp_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'incident_timeline'
          AND column_name = 'timestamp';
        IF timestamp_type = 'timestamp without time zone' THEN
          ALTER TABLE incident_timeline
          ALTER COLUMN timestamp TYPE TIMESTAMPTZ
          USING timestamp AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function consolidateLegacyAlertDuplicates(client: IncidentManagementMigrationClient): Promise<void> {
  await client.query(`
    /* phase6_consolidate_canonical_alerts */
    WITH ranked AS (
      SELECT id, fingerprint, status, severity, anomaly_score,
        occurrence_count, last_seen_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by,
        FIRST_VALUE(id) OVER (
          PARTITION BY spacecraft_id, metric, subsystem ORDER BY created_at ASC, id ASC
        ) AS canonical_id
      FROM alerts WHERE status IN ('active', 'acknowledged')
    ), grouped AS (
      SELECT canonical_id,
        MIN(fingerprint) AS fingerprint,
        CASE MAX(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)
          WHEN 4 THEN 'critical' WHEN 3 THEN 'high' WHEN 2 THEN 'warning' ELSE 'info' END AS severity,
        MAX(anomaly_score) AS anomaly_score, SUM(GREATEST(occurrence_count, 1)) AS occurrence_count,
        MAX(last_seen_at) AS last_seen_at,
        CASE WHEN BOOL_OR(status = 'active') THEN 'active' ELSE 'acknowledged' END AS status,
        MAX(acknowledged_at) AS acknowledged_at,
        (ARRAY_AGG(acknowledged_by ORDER BY acknowledged_at DESC NULLS LAST)
          FILTER (WHERE acknowledged_by IS NOT NULL))[1] AS acknowledged_by,
        MAX(resolved_at) AS resolved_at,
        (ARRAY_AGG(resolved_by ORDER BY resolved_at DESC NULLS LAST)
          FILTER (WHERE resolved_by IS NOT NULL))[1] AS resolved_by
      FROM ranked GROUP BY canonical_id
    )
    UPDATE alerts AS alert
    SET fingerprint = grouped.fingerprint, severity = grouped.severity,
        anomaly_score = grouped.anomaly_score, occurrence_count = grouped.occurrence_count,
        last_seen_at = grouped.last_seen_at, status = grouped.status,
        acknowledged_at = grouped.acknowledged_at, acknowledged_by = grouped.acknowledged_by,
        resolved_at = grouped.resolved_at, resolved_by = grouped.resolved_by,
        updated_at = CURRENT_TIMESTAMP
    FROM grouped WHERE alert.id = grouped.canonical_id
  `);
  await client.query(`
    WITH ranked AS (
      SELECT id, FIRST_VALUE(id) OVER (
        PARTITION BY spacecraft_id, metric, subsystem ORDER BY created_at ASC, id ASC
      ) AS canonical_id FROM alerts WHERE status IN ('active', 'acknowledged')
    )
    INSERT INTO incident_alerts (incident_id, alert_id)
    SELECT links.incident_id, ranked.canonical_id
    FROM incident_alerts AS links JOIN ranked ON links.alert_id = ranked.id
    WHERE ranked.id <> ranked.canonical_id ON CONFLICT DO NOTHING
  `);
  await client.query(`
    WITH ranked AS (
      SELECT id, FIRST_VALUE(id) OVER (
        PARTITION BY spacecraft_id, metric, subsystem ORDER BY created_at ASC, id ASC
      ) AS canonical_id FROM alerts WHERE status IN ('active', 'acknowledged')
    )
    DELETE FROM incident_alerts AS links USING ranked
    WHERE links.alert_id = ranked.id AND ranked.id <> ranked.canonical_id
  `);
  await client.query(`
    WITH ranked AS (
      SELECT id, FIRST_VALUE(id) OVER (
        PARTITION BY spacecraft_id, metric, subsystem ORDER BY created_at ASC, id ASC
      ) AS canonical_id FROM alerts WHERE status IN ('active', 'acknowledged')
    )
    DELETE FROM alerts AS alert USING ranked
    WHERE alert.id = ranked.id AND ranked.id <> ranked.canonical_id
  `);
}
