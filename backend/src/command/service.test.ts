import { CommandService, type CommandRecord, type CommandStore, type CommandTransaction, type IncidentCommandContext } from './service.js';
import type { AuthUser } from '../incident/types.js';

const incident:IncidentCommandContext={id:'00000000-0000-4000-8000-000000000010',spacecraftId:'ORBITAL-X1',status:'open'};
const commander:AuthUser={id:'00000000-0000-4000-8000-000000000001',username:'c1',role:'mission_commander'};
const second:AuthUser={id:'00000000-0000-4000-8000-000000000002',username:'c2',role:'admin'};
class MemoryStore implements CommandStore,CommandTransaction{
  command?:CommandRecord; approvals=new Set<string>();
  async transaction<T>(fn:(tx:CommandTransaction)=>Promise<T>){return fn(this);}
  async incident(){return incident;}
  async create(value:CommandRecord){this.command=value;return value;}
  async get(){return this.command??null;}
  async addApproval(commandId:string,user:AuthUser){void commandId;if(this.approvals.has(user.id))return false;this.approvals.add(user.id);return true;}
  async approvalCount(){return this.approvals.size;}
  async update(command:CommandRecord){this.command=command;return command;}
  async audit(){return;}
  async list(){return this.command?[this.command]:[];}
  async listAudit(){return [];}
}

describe('CommandService',()=>{
  it('rejects read-only roles and invalid parameters',async()=>{
    const service=new CommandService(new MemoryStore());
    await expect(service.request(incident.id,{...commander,role:'engineer'},'REDUCE_THRUST',{thrustPercent:50},'open')).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.request(incident.id,commander,'REDUCE_THRUST',{thrustPercent:99},'open')).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  });
  it('dispatches a high-risk command after one authorized approval',async()=>{
    const service=new CommandService(new MemoryStore());
    const command=await service.request(incident.id,commander,'CLOSE_ISOLATION_VALVE',{},'open');
    const result=await service.approve(command.id,commander,'pending_approval');
    expect(result.command.status).toBe('approved'); expect(result.dispatch?.type).toBe('CLOSE_ISOLATION_VALVE');
  });
  it('requires two distinct privileged approvals for a critical command',async()=>{
    const service=new CommandService(new MemoryStore());
    const command=await service.request(incident.id,commander,'RESTART_FLIGHT_COMPUTER',{},'open');
    expect((await service.approve(command.id,commander,'pending_approval')).dispatch).toBeNull();
    await expect(service.approve(command.id,commander,'pending_approval')).rejects.toMatchObject({code:'COMMAND_ALREADY_DECIDED'});
    expect((await service.approve(command.id,second,'pending_approval')).dispatch?.type).toBe('RESTART_FLIGHT_COMPUTER');
  });
  it('makes rejection terminal',async()=>{
    const service=new CommandService(new MemoryStore());
    const command=await service.request(incident.id,commander,'ENTER_SAFE_MODE',{},'open');
    expect((await service.reject(command.id,commander,'pending_approval','Unsafe now')).status).toBe('rejected');
    await expect(service.approve(command.id,commander,'pending_approval')).rejects.toMatchObject({code:'CONFLICT'});
  });
  it('rejects a result for another spacecraft',async()=>{
    const service=new CommandService(new MemoryStore());const command=await service.request(incident.id,commander,'ENTER_SAFE_MODE',{},'open');await service.approve(command.id,commander,'pending_approval');
    await expect(service.recordResult({schemaVersion:1,commandId:command.id,spacecraftId:'OTHER',success:true,message:'applied',simulationTime:1,changedFields:[]})).rejects.toMatchObject({code:'CONFLICT'});
  });
});
