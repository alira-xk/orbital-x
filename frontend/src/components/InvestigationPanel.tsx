import { useEffect, useState } from "react";
import { fetchInvestigations, startInvestigation } from "../api/incidents";
import type { Investigation } from "../domain/investigations";

export function InvestigationPanel({incidentId,disabled,onCompleted}:{incidentId:string;disabled:boolean;onCompleted?:()=>void}){
  const [items,setItems]=useState<Investigation[]|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{const controller=new AbortController();setItems(null);setError("");void fetchInvestigations(incidentId,controller.signal).then(setItems).catch(()=>{if(!controller.signal.aborted)setError("Could not load AI investigations.")});return()=>controller.abort()},[incidentId]);
  const latest=items?.[0];
  return <section className="investigation-panel" aria-label="AI investigation" aria-busy={busy||items===null}>
    <div className="investigation-heading"><h4>AI investigation</h4><button type="button" disabled={disabled||busy||items===null} onClick={async()=>{const controller=new AbortController();setBusy(true);setError("");try{const value=await startInvestigation(incidentId,controller.signal);setItems(previous=>[value,...(previous??[])]);if(value.status==="completed")onCompleted?.();}catch{setError("Investigation could not be completed. Check the AI service configuration and retry.")}finally{setBusy(false)}}}>{busy?"Investigating…":"Start AI investigation"}</button></div>
    <p className={error?"incident-error":"incident-meta"} role="status">{error|| (items===null?"Loading investigations…":!latest?"No AI investigation recorded.":latest.status==="failed"?latest.errorMessage??"Investigation failed.":latest.status==="in_progress"?"Investigation in progress…":"Latest validated assessment")}</p>
    {latest?.result&&<div className="investigation-result"><p className="eyebrow">Probable root cause · {Math.round(latest.result.confidence*100)}% confidence</p><h5>{latest.result.rootCause}</h5><p>{latest.result.summary}</p><h5>Evidence</h5><ul>{latest.result.evidence.map((item,index)=><li key={`${item.source}-${index}`}><strong>{item.source} · {item.section}</strong><br/>{item.finding}</li>)}</ul><h5>Alternative causes</h5><ul>{latest.result.alternativeCauses.map(item=><li key={item}>{item}</li>)}</ul><h5>Advisory actions</h5><ol>{latest.result.recommendedActions.map(item=><li key={item.title}><strong>{item.title}</strong> — {item.rationale}</li>)}</ol></div>}
  </section>;
}
