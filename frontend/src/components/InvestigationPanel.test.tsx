// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationPanel } from "./InvestigationPanel";

const id="00000000-0000-4000-8000-000000000010";
const result={id:"00000000-0000-4000-8000-000000000030",incidentId:id,status:"completed",errorMessage:null,tokensUsed:42,durationMs:100,createdAt:"2026-09-20T00:00:00.000Z",completedAt:"2026-09-20T00:00:01.000Z",result:{summary:"Leak likely",rootCause:"Valve leak",confidence:.91,severity:"high",affectedSubsystems:["propulsion"],evidence:[{source:"propulsion.md",section:"Leaks",finding:"Pressure fell"}],alternativeCauses:["Sensor drift"],recommendedActions:[{title:"Inspect valve",rationale:"Confirm leak"}]}};
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
describe("InvestigationPanel",()=>{
  it("shows empty state then validated result after start",async()=>{
    const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({success:true,data:[]})}).mockResolvedValueOnce({ok:true,json:async()=>({success:true,data:result})});
    vi.stubGlobal("fetch",fetch); render(<InvestigationPanel incidentId={id} disabled={false} />);
    expect(await screen.findByText("No AI investigation recorded.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Start AI investigation"}));
    expect(await screen.findByText("Valve leak")).toBeInTheDocument();
    expect(screen.getByText("propulsion.md · Leaks")).toBeInTheDocument();
  });
  it("keeps start disabled without an operator",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({success:true,data:[]})}));
    render(<InvestigationPanel incidentId={id} disabled />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Start AI investigation"})).toBeDisabled());
  });
});
