import {Router} from 'express';
import {z} from 'zod';
import type {AuthService} from '../auth/service.js';
import {requireAuth} from '../auth/middleware.js';
import type {CommandService} from '../command/service.js';
import type {CommandDispatcher} from '../command/dispatcher.js';
import {COMMAND_TYPES,COMMAND_STATUSES} from '../command/types.js';
import {ServiceUnavailableError,ValidationError} from '../utils/errors.js';
const uuid=z.string().uuid();
const requestSchema=z.object({commandType:z.enum(COMMAND_TYPES),parameters:z.record(z.unknown()),expectedIncidentStatus:z.enum(['open','investigating','acknowledged'])}).strict();
const approvalSchema=z.object({expectedStatus:z.enum(COMMAND_STATUSES)}).strict();
const terminalSchema=approvalSchema.extend({reason:z.string().trim().min(1).max(500)}).strict();
const querySchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(20)}).strict();
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const r=schema.safeParse(value);if(!r.success)throw new ValidationError('Invalid command request');return r.data;}
export function createCommandsRouter(service?:CommandService,auth?:AuthService,dispatcher?:CommandDispatcher):Router{
  const router=Router(); const required=()=>{if(!service)throw new ServiceUnavailableError('Command storage is unavailable');return service;}; const authenticated=requireAuth(auth);
  router.get('/incidents/:incidentId/commands',async(req,res,next)=>{try{const id=parse(uuid,req.params.incidentId);const {limit}=parse(querySchema,req.query);res.json({success:true,data:await required().listForIncident(id,limit)});}catch(e){next(e);}});
  router.post('/incidents/:incidentId/commands',authenticated,async(req,res,next)=>{try{const id=parse(uuid,req.params.incidentId);const body=parse(requestSchema,req.body);const data=await required().request(id,req.user!,body.commandType,body.parameters,body.expectedIncidentStatus);res.status(201).json({success:true,data});}catch(e){next(e);}});
  router.post('/commands/:id/approve',authenticated,async(req,res,next)=>{try{const id=parse(uuid,req.params.id);const body=parse(approvalSchema,req.body);const result=await required().approve(id,req.user!,body.expectedStatus);if(result.dispatch){if(!dispatcher)throw new ServiceUnavailableError('Command dispatch is unavailable');await dispatcher.publish(result.dispatch);}res.json({success:true,data:result.command});}catch(e){next(e);}});
  router.post('/commands/:id/reject',authenticated,async(req,res,next)=>{try{const id=parse(uuid,req.params.id);const body=parse(terminalSchema,req.body);res.json({success:true,data:await required().reject(id,req.user!,body.expectedStatus,body.reason)});}catch(e){next(e);}});
  router.post('/commands/:id/cancel',authenticated,async(req,res,next)=>{try{const id=parse(uuid,req.params.id);const body=parse(terminalSchema,req.body);res.json({success:true,data:await required().cancel(id,req.user!,body.expectedStatus,body.reason)});}catch(e){next(e);}});
  router.get('/commands/:id/audit',async(req,res,next)=>{try{const id=parse(uuid,req.params.id);const {limit}=parse(querySchema,req.query);res.json({success:true,data:await required().listAudit(id,limit)});}catch(e){next(e);}});
  return router;
}
