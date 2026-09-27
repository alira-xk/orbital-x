export const COMMAND_TYPES = ['CLOSE_ISOLATION_VALVE','REDUCE_THRUST','ENTER_SAFE_MODE','RESTART_FLIGHT_COMPUTER'] as const;
export type CommandType = typeof COMMAND_TYPES[number];
export const COMMAND_STATUSES = ['pending_approval','approved','executing','completed','failed','rejected','cancelled','expired'] as const;
export type CommandStatus = typeof COMMAND_STATUSES[number];
export type CommandRisk = 'medium'|'high'|'critical';
export interface CommandEnvelope { schemaVersion:1; commandId:string; spacecraftId:string; type:CommandType; parameters:Record<string,unknown>; }
export interface CommandResultEnvelope { schemaVersion:1; commandId:string; spacecraftId:string; success:boolean; message:string; simulationTime:number; changedFields:string[]; }
