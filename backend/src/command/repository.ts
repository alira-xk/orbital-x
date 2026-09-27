import type {Pool,PoolClient} from 'pg';
import type {AuthUser} from '../incident/types.js';
import type {CommandRecord,CommandStore,CommandTransaction,IncidentCommandContext} from './service.js';
const json=(v:unknown):Record<string,unknown>=>typeof v==='string'?JSON.parse(v) as Record<string,unknown>:(v??{}) as Record<string,unknown>;
const iso=(v:unknown)=>new Date(String(v)).toISOString();
export function commandFromRow(r:Record<string,unknown>):CommandRecord{return{id:String(r.id),incidentId:String(r.incident_id),spacecraftId:String(r.spacecraft_id),commandType:r.command_type as CommandRecord['commandType'],parameters:json(r.parameters),status:r.status as CommandRecord['status'],riskLevel:r.risk_level as CommandRecord['riskLevel'],requestedBy:String(r.requested_by),expiresAt:iso(r.expires_at),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at),result:r.result?json(r.result) as unknown as CommandRecord['result']:null,errorMessage:r.error_message===null?null:String(r.error_message)};}
export const UPDATE_COMMAND_SQL="UPDATE commands SET status=$2::varchar,result=$3::jsonb,error_message=$4,updated_at=$5::timestamptz,executed_at=CASE WHEN $2::varchar IN ('completed','failed') THEN $5::timestamptz ELSE executed_at END WHERE id=$1 RETURNING *";
class Tx implements CommandTransaction{
  constructor(private readonly db:PoolClient|Pool){}
  async incident(id:string):Promise<IncidentCommandContext|null>{const q=await this.db.query('SELECT id, spacecraft_id, status FROM incidents WHERE id=$1 FOR UPDATE',[id]);const r=q.rows[0];return r?{id:r.id,spacecraftId:r.spacecraft_id,status:r.status}:null;}
  async create(c:CommandRecord){const q=await this.db.query(`INSERT INTO commands(id,incident_id,spacecraft_id,command_type,parameters,status,risk_level,requested_by,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) RETURNING *`,[c.id,c.incidentId,c.spacecraftId,c.commandType,JSON.stringify(c.parameters),c.status,c.riskLevel,c.requestedBy,c.expiresAt,c.createdAt,c.updatedAt]);return commandFromRow(q.rows[0]);}
  async get(id:string){const q=await this.db.query('SELECT * FROM commands WHERE id=$1 FOR UPDATE',[id]);return q.rows[0]?commandFromRow(q.rows[0]):null;}
  async addApproval(id:string,u:AuthUser){const q=await this.db.query(`INSERT INTO command_approvals(command_id,user_id,decision,actor_role) VALUES($1,$2,'approved',$3) ON CONFLICT(command_id,user_id) DO NOTHING RETURNING id`,[id,u.id,u.role]);return q.rowCount===1;}
  async approvalCount(id:string){const q=await this.db.query(`SELECT COUNT(*)::int count FROM command_approvals WHERE command_id=$1 AND decision='approved'`,[id]);return Number(q.rows[0].count);}
  async update(c:CommandRecord){const q=await this.db.query(UPDATE_COMMAND_SQL,[c.id,c.status,c.result?JSON.stringify(c.result):null,c.errorMessage,c.updatedAt]);return commandFromRow(q.rows[0]);}
  async audit(commandId:string,incidentId:string,eventType:string,actorId:string|null,from:string|null,to:string|null,metadata:Record<string,unknown>={}){await this.db.query('INSERT INTO command_audit_events(command_id,incident_id,actor_id,event_type,from_status,to_status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[commandId,incidentId,actorId,eventType,from,to,JSON.stringify(metadata)]);await this.db.query('INSERT INTO incident_timeline(incident_id,actor_id,event_type,description,metadata) VALUES($1,$2,$3,$4,$5::jsonb)',[incidentId,actorId,`command_${eventType}`,`Command ${eventType.replaceAll('_',' ')}`,JSON.stringify({commandId,...metadata})]);}
}
export class PostgresCommandStore extends Tx implements CommandStore{
  constructor(private readonly pool:Pool){super(pool);}
  async transaction<T>(fn:(tx:CommandTransaction)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');const value=await fn(new Tx(c));await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async list(id:string,limit:number){const q=await this.pool.query('SELECT * FROM commands WHERE incident_id=$1 ORDER BY created_at DESC LIMIT $2',[id,limit]);return q.rows.map(commandFromRow);}
  async listAudit(id:string,limit:number){const q=await this.pool.query('SELECT id,event_type,actor_id,from_status,to_status,metadata,created_at FROM command_audit_events WHERE command_id=$1 ORDER BY created_at ASC LIMIT $2',[id,limit]);return q.rows.map(r=>({...r,created_at:iso(r.created_at)}));}
}
