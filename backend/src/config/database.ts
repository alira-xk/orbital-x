import { Pool, PoolClient } from 'pg';
import { config } from './index.js';
import { logger } from '../utils/logger.js';
import { TELEMETRY_SCHEMA_MIGRATION, migrateTelemetrySchema } from '../telemetry/databaseMigration.js';
import {
  INCIDENT_MANAGEMENT_SCHEMA_MIGRATION,
  INCIDENT_MANAGEMENT_REPAIR_MIGRATION,
  migrateIncidentManagementRepairs,
  migrateIncidentManagementSchema,
} from '../incident/databaseMigration.js';
import { COMMAND_SCHEMA_MIGRATION, migrateCommandSchema } from '../command/databaseMigration.js';

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error({ error: err.message }, 'Unexpected database pool error');
});

export const db = {
  query: async <T = unknown>(text: string, params?: unknown[]): Promise<T[]> => {
    const start = Date.now();
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: result.rowCount }, 'Executed query');
    return result.rows as T[];
  },

  queryOne: async <T = unknown>(text: string, params?: unknown[]): Promise<T | null> => {
    const rows = await db.query<T>(text, params);
    return rows[0] || null;
  },

  getClient: async (): Promise<PoolClient> => {
    const client = await pool.connect();
    return client;
  },
};

export async function initializeDatabase(): Promise<void> {
  try {
    logger.info('Connecting to PostgreSQL...');

    // Test connection
    const result = await pool.query('SELECT NOW()');
    logger.info({ timestamp: result.rows[0].now }, 'PostgreSQL connected');

    // Run migrations
    await runMigrations();

    logger.info('Database initialization complete');
  } catch (error) {
    logger.error({ error: String(error) }, 'Database initialization failed');
    throw error;
  }
}

async function runMigrations(): Promise<void> {
  const client = await pool.connect();

  try {
    // Create migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get applied migrations
    const { rows: applied } = await client.query<{ name: string }>(
      'SELECT name FROM migrations ORDER BY id'
    );
    const appliedNames = new Set(applied.map(m => m.name));

    await createTables(client);
    if (!appliedNames.has(TELEMETRY_SCHEMA_MIGRATION)) {
      await migrateTelemetrySchema(client);
    }
    if (!appliedNames.has(INCIDENT_MANAGEMENT_SCHEMA_MIGRATION)) {
      await migrateIncidentManagementSchema(client);
    }
    if (!appliedNames.has(INCIDENT_MANAGEMENT_REPAIR_MIGRATION)) {
      await migrateIncidentManagementRepairs(client);
    }
    if (!appliedNames.has(COMMAND_SCHEMA_MIGRATION)) {
      await migrateCommandSchema(client);
    }

  } finally {
    client.release();
  }
}

async function createTables(client: PoolClient): Promise<void> {
  // Users and authentication
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      username VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'viewer',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Missions
  await client.query(`
    CREATE TABLE IF NOT EXISTS missions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      start_date TIMESTAMP,
      end_date TIMESTAMP,
      status VARCHAR(50) DEFAULT 'planned',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Spacecraft
  await client.query(`
    CREATE TABLE IF NOT EXISTS spacecraft (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      mission_id UUID REFERENCES missions(id),
      status VARCHAR(50) DEFAULT 'nominal',
      launch_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Telemetry
  await client.query(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id BIGSERIAL PRIMARY KEY,
      spacecraft_id VARCHAR(100) NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      subsystem VARCHAR(50) NOT NULL,
      metric VARCHAR(100) NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      unit VARCHAR(20)
    )
  `);

  // Create index for efficient time-range queries
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_spacecraft_time
    ON telemetry(spacecraft_id, timestamp DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_metric
    ON telemetry(spacecraft_id, metric, timestamp DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_subsystem
    ON telemetry(spacecraft_id, subsystem, timestamp DESC)
  `);

  // Telemetry aggregates
  await client.query(`
    CREATE TABLE IF NOT EXISTS telemetry_aggregates (
      id SERIAL PRIMARY KEY,
      spacecraft_id UUID REFERENCES spacecraft(id),
      subsystem VARCHAR(50),
      metric VARCHAR(100),
      period_start TIMESTAMP,
      period_type VARCHAR(20),
      avg_value DOUBLE PRECISION,
      min_value DOUBLE PRECISION,
      max_value DOUBLE PRECISION,
      count INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Alerts
  await client.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      spacecraft_id VARCHAR(100),
      subsystem VARCHAR(50),
      severity VARCHAR(20) CHECK (severity IN ('info', 'warning', 'high', 'critical')),
      metric VARCHAR(100),
      value DOUBLE PRECISION,
      expected_range TEXT,
      anomaly_score DOUBLE PRECISION,
      status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
      detection_method VARCHAR(50) CHECK (detection_method IN ('rule', 'rate', 'ml', 'hybrid')),
      fingerprint TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by UUID REFERENCES users(id),
      resolved_at TIMESTAMPTZ,
      resolved_by UUID REFERENCES users(id),
      updated_at TIMESTAMPTZ
    )
  `);

  await client.query(`
    CREATE SEQUENCE IF NOT EXISTS incident_number_seq START WITH 1000
  `);

  // Incidents
  await client.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_number BIGINT NOT NULL DEFAULT nextval('incident_number_seq'),
      spacecraft_id VARCHAR(100),
      title VARCHAR(255) NOT NULL,
      description TEXT,
      severity VARCHAR(20) CHECK (severity IN ('info', 'warning', 'high', 'critical')),
      status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'acknowledged', 'resolved', 'reopened')),
      root_cause TEXT,
      affected_subsystems TEXT[],
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by UUID REFERENCES users(id),
      resolved_at TIMESTAMPTZ,
      resolved_by UUID REFERENCES users(id),
      updated_at TIMESTAMPTZ,
      UNIQUE (incident_number)
    )
  `);

  // Incident alerts junction
  await client.query(`
    CREATE TABLE IF NOT EXISTS incident_alerts (
      incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
      alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
      PRIMARY KEY (incident_id, alert_id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS incident_timeline (
      id BIGSERIAL PRIMARY KEY,
      incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
      actor_id UUID REFERENCES users(id),
      event_type VARCHAR(100),
      description TEXT,
      metadata JSONB,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
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

  // Commands
  await client.query(`
    CREATE TABLE IF NOT EXISTS commands (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      spacecraft_id VARCHAR(100) NOT NULL,
      incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      command_type VARCHAR(100) NOT NULL,
      parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
      risk_level VARCHAR(20) NOT NULL,
      requested_by UUID NOT NULL REFERENCES users(id),
      expires_at TIMESTAMPTZ NOT NULL,
      executed_at TIMESTAMPTZ,
      result JSONB,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // AI Investigations
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_investigations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_id UUID REFERENCES incidents(id),
      summary TEXT,
      root_cause TEXT,
      confidence DOUBLE PRECISION,
      severity VARCHAR(20),
      affected_subsystems TEXT[],
      evidence JSONB,
      alternative_causes TEXT[],
      recommended_actions JSONB,
      status VARCHAR(50) DEFAULT 'in_progress',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);

  // Mission events
  await client.query(`
    CREATE TABLE IF NOT EXISTS mission_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mission_id UUID REFERENCES missions(id),
      spacecraft_id UUID REFERENCES spacecraft(id),
      event_type VARCHAR(100),
      description TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Audit logs
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id),
      spacecraft_id UUID REFERENCES spacecraft(id),
      action VARCHAR(100),
      entity_type VARCHAR(50),
      entity_id UUID,
      details JSONB,
      ip_address VARCHAR(45),
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Simulation state
  await client.query(`
    CREATE TABLE IF NOT EXISTS simulation_state (
      id SERIAL PRIMARY KEY,
      spacecraft_id UUID REFERENCES spacecraft(id),
      scenario VARCHAR(100),
      speed INTEGER DEFAULT 1,
      is_running BOOLEAN DEFAULT false,
      simulation_time DOUBLE PRECISION DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  logger.info('Database tables created successfully');
}
