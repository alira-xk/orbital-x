import { describe, expect, it } from "vitest";
import { parseInvestigation } from "./investigations";

const valid={id:"00000000-0000-4000-8000-000000000030",incidentId:"00000000-0000-4000-8000-000000000010",status:"completed",errorMessage:null,tokensUsed:42,durationMs:100,createdAt:"2026-09-20T00:00:00.000Z",completedAt:"2026-09-20T00:00:01.000Z",result:{summary:"Leak likely",rootCause:"Valve leak",confidence:.91,severity:"high",affectedSubsystems:["propulsion"],evidence:[{source:"propulsion.md",section:"Leaks",finding:"Pressure fell"}],alternativeCauses:["Sensor drift"],recommendedActions:[{title:"Inspect valve",rationale:"Confirm leak"}]}};

describe("investigation parser",()=>{
  it("accepts a complete validated investigation",()=>expect(parseInvestigation(valid).result?.confidence).toBe(.91));
  it.each([{...valid,status:"done"},{...valid,result:{...valid.result,confidence:2}},{...valid,result:{...valid.result,evidence:[]}}])("rejects malformed data",value=>expect(()=>parseInvestigation(value)).toThrow("Malformed investigation response"));
});
