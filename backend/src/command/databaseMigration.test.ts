import { COMMAND_CATALOG, parseCommandParameters } from './catalog.js';
import { COMMAND_SCHEMA_MIGRATION, migrateCommandSchema, type CommandMigrationClient } from './databaseMigration.js';

class Recorder implements CommandMigrationClient {
  calls: Array<{text:string; values?:readonly unknown[]}> = [];
  async query(text:string, values?:readonly unknown[]):Promise<unknown> {
    this.calls.push({text,values});
    return text.includes('INSERT INTO migrations') ? {rows:[{name:COMMAND_SCHEMA_MIGRATION}]} : {rows:[]};
  }
}

describe('Phase 8 command schema', () => {
  it('defines only the four validated command contracts', () => {
    expect(Object.keys(COMMAND_CATALOG)).toEqual(['CLOSE_ISOLATION_VALVE','REDUCE_THRUST','ENTER_SAFE_MODE','RESTART_FLIGHT_COMPUTER']);
    expect(parseCommandParameters('REDUCE_THRUST',{thrustPercent:20})).toEqual({thrustPercent:20});
    expect(() => parseCommandParameters('REDUCE_THRUST',{thrustPercent:91})).toThrow();
    expect(() => parseCommandParameters('CLOSE_ISOLATION_VALVE',{field:'fuel'})).toThrow();
  });

  it('installs approval uniqueness, audit storage and timezone lifecycle fields transactionally', async () => {
    const client=new Recorder();
    await migrateCommandSchema(client);
    const sql=client.calls.map(c=>c.text).join('\n');
    expect(client.calls[0]?.text).toBe('BEGIN');
    expect(sql).toContain('command_approvals');
    expect(sql).toContain('UNIQUE (command_id, user_id)');
    expect(sql).toContain('command_audit_events');
    expect(sql).toContain('TIMESTAMPTZ');
    expect(sql.indexOf('DROP CONSTRAINT IF EXISTS commands_status_check')).toBeGreaterThan(-1);
    expect(sql.indexOf('DROP CONSTRAINT IF EXISTS commands_status_check')).toBeLessThan(sql.indexOf("UPDATE commands SET status='pending_approval'"));
    expect(client.calls.at(-1)?.text).toBe('COMMIT');
  });
});
