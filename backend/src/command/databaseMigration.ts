export const COMMAND_SCHEMA_MIGRATION='phase8-command-system-v1';
export interface CommandMigrationClient { query(text:string,values?:readonly unknown[]):Promise<unknown>; }
export async function migrateCommandSchema(client:CommandMigrationClient):Promise<void>{
  await client.query('BEGIN');
  try {
    await client.query('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[COMMAND_SCHEMA_MIGRATION]);
    const guard=await client.query('INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name',[COMMAND_SCHEMA_MIGRATION]) as {rows?:unknown[]};
    if((guard.rows?.length??0)>0){
      await client.query(`
        ALTER TABLE commands DROP CONSTRAINT IF EXISTS commands_spacecraft_id_fkey;
        ALTER TABLE commands ALTER COLUMN spacecraft_id TYPE VARCHAR(100) USING spacecraft_id::text;
        ALTER TABLE commands ADD COLUMN IF NOT EXISTS incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE;
        ALTER TABLE commands ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20);
        ALTER TABLE commands ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
        ALTER TABLE commands ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE commands ADD COLUMN IF NOT EXISTS error_message TEXT;
        ALTER TABLE commands ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
        ALTER TABLE commands ALTER COLUMN executed_at TYPE TIMESTAMPTZ USING executed_at AT TIME ZONE 'UTC';
        ALTER TABLE commands DROP CONSTRAINT IF EXISTS commands_status_check;
        UPDATE commands SET status='pending_approval' WHERE status='pending';
        ALTER TABLE commands ALTER COLUMN status SET DEFAULT 'pending_approval';
      `);
      await client.query(`CREATE TABLE IF NOT EXISTS command_approvals (
        id BIGSERIAL PRIMARY KEY, command_id UUID NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id), decision VARCHAR(20) NOT NULL CHECK(decision IN ('approved','rejected')),
        actor_role VARCHAR(50) NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (command_id, user_id));`);
      await client.query(`CREATE TABLE IF NOT EXISTS command_audit_events (
        id BIGSERIAL PRIMARY KEY, command_id UUID NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
        incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE, actor_id UUID REFERENCES users(id),
        event_type VARCHAR(100) NOT NULL, from_status VARCHAR(50), to_status VARCHAR(50), metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
      await client.query('CREATE INDEX IF NOT EXISTS idx_commands_incident_created ON commands(incident_id, created_at DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_command_audit_command_created ON command_audit_events(command_id, created_at ASC)');
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
}
