// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissionReplay } from "./MissionReplay";

vi.mock("./OrbitalScene", () => ({ OrbitalScene: ({ telemetry }: { telemetry: { simulation_time: number } | null }) => <div data-testid="orbit">T+{telemetry?.simulation_time ?? "none"}</div> }));

const payload = { success: true, data: {
  incident: { id: "00000000-0000-4000-8000-000000000010", displayNumber: "INC-1000", spacecraftId: "ORBITAL-X1", title: "Leak", description: null, severity: "critical", status: "resolved", affectedSubsystems: ["propulsion"], createdAt: "2026-09-17T09:00:00.000Z", updatedAt: "2026-09-17T09:02:00.000Z" },
  window: { from: "2026-09-17T08:59:30.000Z", to: "2026-09-17T09:02:00.000Z" },
  frames: [
    { timestamp: "2026-09-17T09:00:00.000Z", spacecraft_id: "ORBITAL-X1", simulation_time: 30, scenario: "RECORDED_REPLAY", fuel_pressure: 1.7 },
    { timestamp: "2026-09-17T09:01:00.000Z", spacecraft_id: "ORBITAL-X1", simulation_time: 90, scenario: "RECORDED_REPLAY", fuel_pressure: 1.5 },
  ], markers: [{ id: "timeline:1", timestamp: "2026-09-17T09:00:00.000Z", kind: "timeline", label: "Incident created", severity: null }],
} };

afterEach(() => vi.restoreAllMocks());
describe("MissionReplay", () => {
  it("loads a replay on demand and scrubs recorded frames", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    render(<MissionReplay incidentId={payload.data.incident.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Load mission replay" }));
    await screen.findByText("Incident created");
    expect(screen.getByTestId("orbit")).toHaveTextContent("T+30");
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "1" } });
    expect(screen.getByTestId("orbit")).toHaveTextContent("T+90");
  });

  it("keeps a failed replay retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    render(<MissionReplay incidentId={payload.data.incident.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Load mission replay" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Replay unavailable"));
    expect(screen.getByRole("button", { name: "Retry mission replay" })).toBeEnabled();
  });
});
