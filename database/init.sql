-- ORBITAL-X Database Initialization
-- This script creates the database and required extensions

-- Create database (run as superuser)
-- CREATE DATABASE orbital_x;
-- \c orbital_x;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'mission_commander', 'flight_controller', 'engineer', 'viewer')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Missions
CREATE TABLE IF NOT EXISTS missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'aborted')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Spacecraft
CREATE TABLE IF NOT EXISTS spacecraft (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  mission_id UUID REFERENCES missions(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'nominal',
  launch_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Telemetry (high-resolution)
CREATE TABLE IF NOT EXISTS telemetry (
  id BIGSERIAL PRIMARY KEY,
  spacecraft_id VARCHAR(100) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subsystem VARCHAR(50) NOT NULL,
  metric VARCHAR(100) NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit VARCHAR(20)
);

-- Indexes for efficient time-range queries
CREATE INDEX IF NOT EXISTS idx_telemetry_spacecraft_time ON telemetry(spacecraft_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_metric ON telemetry(spacecraft_id, metric, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_subsystem ON telemetry(spacecraft_id, subsystem, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_spacecraft_metric_timestamp
  ON telemetry(spacecraft_id, metric, timestamp);

-- Telemetry aggregates
CREATE TABLE IF NOT EXISTS telemetry_aggregates (
  id SERIAL PRIMARY KEY,
  spacecraft_id UUID REFERENCES spacecraft(id) ON DELETE CASCADE,
  subsystem VARCHAR(50),
  metric VARCHAR(100),
  period_start TIMESTAMP NOT NULL,
  period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('minute', 'hour', 'day')),
  avg_value DOUBLE PRECISION,
  min_value DOUBLE PRECISION,
  max_value DOUBLE PRECISION,
  count INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(spacecraft_id, subsystem, metric, period_start, period_type)
);

CREATE INDEX IF NOT EXISTS idx_aggregates_lookup ON telemetry_aggregates(spacecraft_id, metric, period_start DESC);

-- Alerts
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
);

CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(spacecraft_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_fingerprint
  ON alerts(spacecraft_id, fingerprint) WHERE status IN ('active', 'acknowledged');

-- Incidents
CREATE SEQUENCE IF NOT EXISTS incident_number_seq START WITH 1000;

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
);

CREATE INDEX IF NOT EXISTS idx_incidents_active ON incidents(spacecraft_id, status) WHERE status IN ('open', 'investigating');

-- Incident-Alert junction
CREATE TABLE IF NOT EXISTS incident_alerts (
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
  PRIMARY KEY (incident_id, alert_id)
);

-- Incident Timeline
CREATE TABLE IF NOT EXISTS incident_timeline (
  id BIGSERIAL PRIMARY KEY,
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id),
  event_type VARCHAR(100),
  description TEXT,
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_timeline_incident_timestamp ON incident_timeline(incident_id, timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_timeline_actor_timestamp ON incident_timeline(actor_id, timestamp ASC);

-- Refresh token sessions store only a token hash.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires ON auth_sessions(user_id, expires_at);

-- Commands
CREATE TABLE IF NOT EXISTS commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spacecraft_id VARCHAR(100) NOT NULL,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  command_type VARCHAR(100) NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
  risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('medium', 'high', 'critical')),
  requested_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commands_spacecraft ON commands(spacecraft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_incident_created ON commands(incident_id, created_at DESC);
CREATE TABLE IF NOT EXISTS command_approvals (
  id BIGSERIAL PRIMARY KEY, command_id UUID NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id), decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved','rejected')),
  actor_role VARCHAR(50) NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (command_id, user_id)
);
CREATE TABLE IF NOT EXISTS command_audit_events (
  id BIGSERIAL PRIMARY KEY, command_id UUID NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE, actor_id UUID REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL, from_status VARCHAR(50), to_status VARCHAR(50), metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AI Investigations
CREATE TABLE IF NOT EXISTS ai_investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  summary TEXT,
  root_cause TEXT,
  confidence DOUBLE PRECISION,
  severity VARCHAR(20),
  affected_subsystems TEXT[],
  evidence JSONB,
  alternative_causes TEXT[],
  recommended_actions JSONB,
  status VARCHAR(50) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed')),
  tokens_used INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_investigations_incident ON ai_investigations(incident_id, created_at DESC);

-- Mission Events
CREATE TABLE IF NOT EXISTS mission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
  spacecraft_id UUID REFERENCES spacecraft(id) ON DELETE CASCADE,
  event_type VARCHAR(100),
  description TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  spacecraft_id UUID REFERENCES spacecraft(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  details JSONB,
  ip_address VARCHAR(45),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

-- Simulation State
CREATE TABLE IF NOT EXISTS simulation_state (
  id SERIAL PRIMARY KEY,
  spacecraft_id UUID REFERENCES spacecraft(id) ON DELETE CASCADE,
  scenario VARCHAR(100),
  speed INTEGER DEFAULT 1,
  is_running BOOLEAN DEFAULT false,
  simulation_time DOUBLE PRECISION DEFAULT 0,
  started_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Documentation chunks (for RAG)
CREATE TABLE IF NOT EXISTS documentation_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(255),
  section VARCHAR(255),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_docs_source ON documentation_chunks(source);

-- Success message
DO $$ BEGIN
  RAISE NOTICE 'ORBITAL-X database schema initialized successfully';
END $$;
