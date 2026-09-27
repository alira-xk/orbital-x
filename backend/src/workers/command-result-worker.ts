import {z} from 'zod';
import type {CommandService} from '../command/service.js';
const schema=z.object({schemaVersion:z.literal(1),commandId:z.string().uuid(),spacecraftId:z.string().min(1).max(100),success:z.boolean(),message:z.string().max(500),simulationTime:z.number().finite().nonnegative(),changedFields:z.array(z.string().max(100)).max(20)}).strict();
export interface CommandResultRedis{xgroup(...args:string[]):Promise<unknown>;xreadgroup(...args:(string|number)[]):Promise<unknown>;xack(stream:string,group:string,id:string):Promise<unknown>}
export class CommandResultWorker{
  private stopped=false;private initialized=false;
  constructor(private readonly redis:CommandResultRedis,private readonly service:CommandService,private readonly stream='command-results:stream',private readonly group='backend-command-results',private readonly consumer=`backend-${process.pid}`){}
  stop(){this.stopped=true;}
  private async init(){if(this.initialized)return;try{await this.redis.xgroup('CREATE',this.stream,this.group,'0','MKSTREAM');}catch(e){if(!String(e).includes('BUSYGROUP'))throw e;}this.initialized=true;}
  async pollOnce():Promise<number>{await this.init();const batches=await this.redis.xreadgroup('GROUP',this.group,this.consumer,'COUNT',10,'BLOCK',50,'STREAMS',this.stream,'>') as Array<[string,Array<[string,string[]]>]>|null;let count=0;for(const [,messages] of batches??[]){for(const [id,fields] of messages){const index=fields.indexOf('command:result');if(index<0){await this.redis.xack(this.stream,this.group,id);continue;}let value:unknown;try{value=JSON.parse(fields[index+1]??'');}catch{await this.redis.xack(this.stream,this.group,id);continue;}const parsed=schema.safeParse(value);if(!parsed.success){await this.redis.xack(this.stream,this.group,id);continue;}await this.service.recordResult(parsed.data);await this.redis.xack(this.stream,this.group,id);count++;}}return count;}
  async consume(){while(!this.stopped)await this.pollOnce();}
}
