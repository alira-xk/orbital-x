import { z } from 'zod';

const evidence=z.object({source:z.string().min(1).max(255),section:z.string().min(1).max(255),finding:z.string().min(1).max(4000)}).strict();
const action=z.object({title:z.string().min(1).max(255),rationale:z.string().min(1).max(4000)}).strict();
const result=z.object({summary:z.string().min(1).max(4000),root_cause:z.string().min(1).max(4000),confidence:z.number().min(0).max(1),severity:z.enum(['info','warning','high','critical']),affected_subsystems:z.array(z.string().min(1).max(50)).min(1).max(20),evidence:z.array(evidence).min(1).max(20),alternative_causes:z.array(z.string().min(1).max(4000)).max(10),recommended_actions:z.array(action).min(1).max(10)}).strict();
export const investigationSchema=z.object({id:z.string().uuid(),incident_id:z.string().uuid(),status:z.enum(['in_progress','completed','failed']),result:result.nullable(),error_message:z.string().max(500).nullable(),tokens_used:z.number().int().nonnegative().nullable(),duration_ms:z.number().int().nonnegative().nullable(),created_at:z.string().datetime({offset:true}),completed_at:z.string().datetime({offset:true}).nullable()}).strict();
export type InvestigationWire=z.infer<typeof investigationSchema>;
export interface InvestigationClient { start(incidentId:string):Promise<unknown>; list(incidentId:string,limit:number):Promise<unknown>; }
export function parseInvestigation(value:unknown) {
  const row=investigationSchema.parse(value); const r=row.result;
  return {id:row.id,incidentId:row.incident_id,status:row.status,errorMessage:row.error_message,tokensUsed:row.tokens_used,durationMs:row.duration_ms,createdAt:row.created_at,completedAt:row.completed_at,result:r?{summary:r.summary,rootCause:r.root_cause,confidence:r.confidence,severity:r.severity,affectedSubsystems:r.affected_subsystems,evidence:r.evidence,alternativeCauses:r.alternative_causes,recommendedActions:r.recommended_actions}:null};
}
