export type InvestigationStatus="in_progress"|"completed"|"failed";
export interface Investigation { id:string; incidentId:string; status:InvestigationStatus; errorMessage:string|null; tokensUsed:number|null; durationMs:number|null; createdAt:string; completedAt:string|null; result:null|{summary:string;rootCause:string;confidence:number;severity:"info"|"warning"|"high"|"critical";affectedSubsystems:string[];evidence:{source:string;section:string;finding:string}[];alternativeCauses:string[];recommendedActions:{title:string;rationale:string}[]}; }
const bad=():never=>{throw new Error("Malformed investigation response")};
const rec=(v:unknown)=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Record<string,unknown>:bad();
const text=(v:unknown)=>typeof v==="string"&&v.length>0&&v.length<=4000?v:bad();
const number=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&v>=0?v:bad();
const date=(v:unknown)=>{const s=text(v);return Number.isFinite(Date.parse(s))?s:bad()};
const array=<T>(v:unknown,parse:(x:unknown)=>T,max:number,min=0)=>Array.isArray(v)&&v.length>=min&&v.length<=max?v.map(parse):bad();
export function parseInvestigation(value:unknown):Investigation{
  const x=rec(value); const status=["in_progress","completed","failed"].includes(String(x.status))?x.status as InvestigationStatus:bad();
  let result:Investigation["result"]=null;
  if(x.result!==null){const r=rec(x.result);const confidence=number(r.confidence);if(confidence>1)bad(); const severity=["info","warning","high","critical"].includes(String(r.severity))?r.severity as NonNullable<Investigation["result"]>["severity"]:bad();
    result={summary:text(r.summary),rootCause:text(r.rootCause),confidence,severity,affectedSubsystems:array(r.affectedSubsystems,text,20,1),evidence:array(r.evidence,e=>{const q=rec(e);return{source:text(q.source),section:text(q.section),finding:text(q.finding)}},20,1),alternativeCauses:array(r.alternativeCauses,text,10),recommendedActions:array(r.recommendedActions,a=>{const q=rec(a);return{title:text(q.title),rationale:text(q.rationale)}},10,1)};}
  return {id:text(x.id),incidentId:text(x.incidentId),status,errorMessage:x.errorMessage===null?null:text(x.errorMessage),tokensUsed:x.tokensUsed===null?null:number(x.tokensUsed),durationMs:x.durationMs===null?null:number(x.durationMs),createdAt:date(x.createdAt),completedAt:x.completedAt===null?null:date(x.completedAt),result};
}
export const parseInvestigationList=(value:unknown)=>array(value,parseInvestigation,50);
