import request from 'supertest';
import { createApp } from '../app.js';
import type { AuthService } from '../auth/service.js';
import type { CommandService } from './service.js';
import type { CommandDispatcher } from './dispatcher.js';

const user={id:'00000000-0000-4000-8000-000000000001',username:'controller',role:'flight_controller'};
const auth={me:jest.fn(async()=>user)} as unknown as AuthService;
const command={id:'00000000-0000-4000-8000-000000000020',incidentId:'00000000-0000-4000-8000-000000000010',spacecraftId:'ORBITAL-X1',commandType:'CLOSE_ISOLATION_VALVE',parameters:{},status:'pending_approval',riskLevel:'high',requestedBy:user.id,expiresAt:'2026-09-22T01:05:00.000Z',createdAt:'2026-09-22T01:00:00.000Z',updatedAt:'2026-09-22T01:00:00.000Z',result:null,errorMessage:null};

it('authenticates request and publishes only a final approval envelope',async()=>{
  const publish=jest.fn(async()=>undefined);
  const service={request:jest.fn(async()=>command),approve:jest.fn(async()=>({command:{...command,status:'approved'},dispatch:{schemaVersion:1,commandId:command.id,spacecraftId:'ORBITAL-X1',type:'CLOSE_ISOLATION_VALVE',parameters:{}}})),listForIncident:jest.fn(async()=>[command]),listAudit:jest.fn(async()=>[])} as unknown as CommandService;
  const app=createApp({authService:auth,commandService:service,commandDispatcher:{publish} as CommandDispatcher});
  await request(app).post(`/api/incidents/${command.incidentId}/commands`).set('Cookie','access_token=x').send({commandType:'CLOSE_ISOLATION_VALVE',parameters:{},expectedIncidentStatus:'open'}).expect(201);
  await request(app).post(`/api/commands/${command.id}/approve`).set('Cookie','access_token=x').send({expectedStatus:'pending_approval'}).expect(200);
  expect(publish).toHaveBeenCalledTimes(1);
});
