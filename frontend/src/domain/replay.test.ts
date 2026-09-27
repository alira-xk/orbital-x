import { describe, expect, it } from "vitest";
import { parseIncidentReplay } from "./replay";

const incident = {
  id: "00000000-0000-4000-8000-000000000010", displayNumber: "INC-1000",
  spacecraftId: "ORBITAL-X1", title: "propulsion: fuel_pressure", description: null,
  severity: "critical", status: "resolved", affectedSubsystems: ["propulsion"],
  createdAt: "2026-09-17T09:00:00.000Z", updatedAt: "2026-09-17T09:02:00.000Z",
};

describe("parseIncidentReplay", () => {
  it("accepts bounded chronological recorded frames and markers", () => {
    const replay = parseIncidentReplay({ incident,
      window: { from: "2026-09-17T08:59:30.000Z", to: "2026-09-17T09:02:00.000Z" },
      frames: [
        { timestamp: "2026-09-17T09:00:00.000Z", spacecraft_id: "ORBITAL-X1", simulation_time: 30, scenario: "RECORDED_REPLAY", fuel_pressure: 1.7 },
        { timestamp: "2026-09-17T09:01:00.000Z", spacecraft_id: "ORBITAL-X1", simulation_time: 90, scenario: "RECORDED_REPLAY", fuel_pressure: 1.5 },
      ],
      markers: [{ id: "timeline:1", timestamp: "2026-09-17T09:00:00.000Z", kind: "timeline", label: "Incident created", severity: null }],
    });
    expect(replay.frames[1].fuel_pressure).toBe(1.5);
  });

  it.each([
    { frames: "bad" },
    { frames: [{ timestamp: "bad" }] },
    { markers: [{ id: "x", timestamp: "2026-09-17T09:00:00.000Z", kind: "bad", label: "x", severity: null }] },
  ])("rejects malformed replay data", (change) => {
    expect(() => parseIncidentReplay({ incident, window: { from: "2026-09-17T08:59:30.000Z", to: "2026-09-17T09:02:00.000Z" }, frames: [], markers: [], ...change })).toThrow("Malformed replay response");
  });
});
