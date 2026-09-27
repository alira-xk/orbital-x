import { commandFromRow, UPDATE_COMMAND_SQL } from './repository.js';
it('maps PostgreSQL command rows without trusting JSON strings',()=>{
  const value=commandFromRow({id:'c',incident_id:'i',spacecraft_id:'ORBITAL-X1',command_type:'ENTER_SAFE_MODE',parameters:'{}',status:'approved',risk_level:'high',requested_by:'u',expires_at:new Date('2026-01-01Z'),created_at:new Date('2026-01-01Z'),updated_at:new Date('2026-01-01Z'),result:null,error_message:null});
  expect(value.parameters).toEqual({}); expect(value.createdAt).toBe('2026-01-01T00:00:00.000Z');
});
it('casts reused update parameters consistently for PostgreSQL',()=>{expect(UPDATE_COMMAND_SQL).toContain('$2::varchar');expect(UPDATE_COMMAND_SQL).toContain('$5::timestamptz');});
