import { config } from '../config/index.js';
import type { InvestigationClient } from './types.js';

async function request(path:string, init?:RequestInit):Promise<unknown>{
  const response=await fetch(`${config.ai.url}${path}`,{...init,signal:AbortSignal.timeout(config.ai.timeoutMs),headers:{'content-type':'application/json',...init?.headers}});
  if(!response.ok) throw new Error(`AI service request failed (${response.status})`);
  return response.json();
}
export class HttpInvestigationClient implements InvestigationClient {
  async start(incidentId:string){return request('/api/investigation/start',{method:'POST',body:JSON.stringify({incident_id:incidentId})});}
  async list(incidentId:string,limit:number){return request(`/api/investigation/incident/${encodeURIComponent(incidentId)}/history?limit=${limit}`);}
}
export type { InvestigationClient } from './types.js';
