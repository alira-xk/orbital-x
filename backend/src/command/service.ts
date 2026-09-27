import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../incident/types.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { COMMAND_CATALOG, parseCommandParameters } from './catalog.js';
import type { CommandEnvelope, CommandRisk, CommandStatus, CommandType, CommandResultEnvelope } from './types.js';

export interface IncidentCommandContext{id:string;spacecraftId:string;status:string}
export interface CommandRecord{id:string;incidentId:string;spacecraftId:string;commandType:CommandType;parameters:Record<string,unknown>;status:CommandStatus;riskLevel:CommandRisk;requestedBy:string;expiresAt:string;createdAt:string;updatedAt:string;result:CommandResultEnvelope|null;errorMessage:string|null}
export interface CommandTransaction{
  incident(id:string):Promise<IncidentCommandContext|null>; create(value:CommandRecord):Promise<CommandRecord>; get(id:string):Promise<CommandRecord|null>;
  addApproval(commandId:string,user:AuthUser):Promise<boolean>; approvalCount(commandId:string):Promise<number>; update(value:CommandRecord):Promise<CommandRecord>;
  audit(commandId:string,incidentId:string,eventType:string,actorId:string|null,from:CommandStatus|null,to:CommandStatus|null,metadata?:Record<string,unknown>):Promise<void>;
}
export interface CommandStore extends CommandTransaction{transaction<T>(fn:(tx:CommandTransaction)=>Promise<T>):Promise<T>;list(incidentId:string,limit:number):Promise<CommandRecord[]>;listAudit(commandId:string,limit:number):Promise<unknown[]>}
const authorized=(role:string,type:CommandType)=>COMMAND_CATALOG[type].roles.includes(role as never);
const envelope=(c:CommandRecord):CommandEnvelope=>({schemaVersion:1,commandId:c.id,spacecraftId:c.spacecraftId,type:c.commandType,parameters:c.parameters});

export class CommandService{
  constructor(private readonly store:CommandStore,private readonly now=()=>new Date()){}
  async request(incidentId:string,user:AuthUser,type:CommandType,parameters:unknown,expectedIncidentStatus:string):Promise<CommandRecord>{
    if(!authorized(user.role,type))throw new ForbiddenError('Role cannot request this command');
    const parsed=parseCommandParameters(type,parameters);
    return this.store.transaction(async tx=>{
      const incident=await tx.incident(incidentId); if(!incident)throw new NotFoundError('Incident not found');
      if(incident.status!==expectedIncidentStatus)throw new ConflictError('Incident status changed');
      if(incident.status==='resolved')throw new ConflictError('Resolved incidents cannot receive commands');
      const now=this.now(); const command:CommandRecord={id:randomUUID(),incidentId,spacecraftId:incident.spacecraftId,commandType:type,parameters:parsed,status:'pending_approval',riskLevel:COMMAND_CATALOG[type].risk,requestedBy:user.id,expiresAt:new Date(now.getTime()+300000).toISOString(),createdAt:now.toISOString(),updatedAt:now.toISOString(),result:null,errorMessage:null};
      await tx.create(command); await tx.audit(command.id,incidentId,'requested',user.id,null,'pending_approval',{commandType:type,risk:command.riskLevel}); return command;
    });
  }
  async approve(id:string,user:AuthUser,expected:CommandStatus):Promise<{command:CommandRecord;dispatch:CommandEnvelope|null}>{
    return this.store.transaction(async tx=>{
      const command=await tx.get(id); if(!command)throw new NotFoundError('Command not found');
      if(command.status!==expected)throw new ConflictError('Command status changed');
      if(new Date(command.expiresAt)<=this.now()){const expired={...command,status:'expired' as const,updatedAt:this.now().toISOString()};await tx.update(expired);await tx.audit(id,command.incidentId,'expired',null,command.status,'expired');return{command:expired,dispatch:null};}
      if(!authorized(user.role,command.commandType))throw new ForbiddenError('Role cannot approve this command');
      if(!await tx.addApproval(id,user))throw new AppError('Operator already decided this command',409,'COMMAND_ALREADY_DECIDED');
      const count=await tx.approvalCount(id); const ready=count>=COMMAND_CATALOG[command.commandType].approvals;
      const next={...command,status:(ready?'approved':'pending_approval') as CommandStatus,updatedAt:this.now().toISOString()}; await tx.update(next);
      await tx.audit(id,command.incidentId,'approved',user.id,command.status,next.status,{approvalCount:count});
      return{command:next,dispatch:ready?envelope(next):null};
    });
  }
  listForIncident(id:string,limit=20){return this.store.list(id,Math.max(1,Math.min(50,limit)));}
  listAudit(id:string,limit=100){return this.store.listAudit(id,Math.max(1,Math.min(100,limit)));}
  reject(id:string,user:AuthUser,expected:CommandStatus,reason:string){return this.terminate(id,user,expected,'rejected',reason);}
  cancel(id:string,user:AuthUser,expected:CommandStatus,reason:string){return this.terminate(id,user,expected,'cancelled',reason);}
  private async terminate(id:string,user:AuthUser,expected:CommandStatus,status:'rejected'|'cancelled',reason:string):Promise<CommandRecord>{return this.store.transaction(async tx=>{const command=await tx.get(id);if(!command)throw new NotFoundError('Command not found');if(command.status!==expected)throw new ConflictError('Command status changed');if(!authorized(user.role,command.commandType))throw new ForbiddenError('Role cannot change this command');const next={...command,status,updatedAt:this.now().toISOString(),errorMessage:reason};await tx.update(next);await tx.audit(id,command.incidentId,status,user.id,command.status,status,{reason});return next;});}
  async recordResult(result:CommandResultEnvelope):Promise<CommandRecord>{return this.store.transaction(async tx=>{const command=await tx.get(result.commandId);if(!command)throw new NotFoundError('Command not found');if(result.spacecraftId!==command.spacecraftId)throw new ConflictError('Command result spacecraft mismatch');if(command.status==='completed'||command.status==='failed')return command;if(!['approved','executing'].includes(command.status))throw new ConflictError('Command is not executable');const status=result.success?'completed':'failed';const next={...command,status:status as CommandStatus,result,errorMessage:result.success?null:result.message,updatedAt:this.now().toISOString()};await tx.update(next);await tx.audit(command.id,command.incidentId,status,null,command.status,status,{changedFields:result.changedFields});return next;});}
}
