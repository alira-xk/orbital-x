import type { CommandEnvelope } from './types.js';
export interface CommandRedisClient{xadd(stream:string,...args:string[]):Promise<unknown>}
export interface CommandDispatcher{publish(envelope:CommandEnvelope):Promise<void>}
export class RedisCommandDispatcher implements CommandDispatcher{
  constructor(private readonly redis:CommandRedisClient,private readonly stream='commands:stream'){}
  async publish(envelope:CommandEnvelope):Promise<void>{await this.redis.xadd(this.stream,'*','command:request',JSON.stringify(envelope));}
}
