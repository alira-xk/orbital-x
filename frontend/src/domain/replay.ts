import { parseIncident, type Incident, type Severity } from "./incidents";
import type { TelemetryFrame } from "./telemetry";

export interface ReplayMarker { id: string; timestamp: string; kind: "alert" | "timeline"; label: string; severity: Severity | null }
export interface IncidentReplay { incident: Incident; window: { from: string; to: string }; frames: TelemetryFrame[]; markers: ReplayMarker[] }

const bad = (): never => { throw new Error("Malformed replay response"); };
const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : bad();
const text = (value: unknown): string => typeof value === "string" && value.length > 0 ? value : bad();
const date = (value: unknown): string => { const result = text(value); return Number.isFinite(Date.parse(result)) ? result : bad(); };
const finite = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : bad();

export function parseIncidentReplay(value: unknown): IncidentReplay {
  const row = object(value); const window = object(row.window);
  if (!Array.isArray(row.frames) || row.frames.length > 1000 || !Array.isArray(row.markers) || row.markers.length > 2000) bad();
  const rawFrames = row.frames as unknown[];
  const rawMarkers = row.markers as unknown[];
  const incident = parseIncident(row.incident);
  const frames = rawFrames.map(item => {
    const frame = object(item);
    for (const field of Object.values(frame)) if (typeof field !== "string" && (typeof field !== "number" || !Number.isFinite(field))) bad();
    const parsed = { ...frame, timestamp: date(frame.timestamp), spacecraft_id: text(frame.spacecraft_id),
      simulation_time: finite(frame.simulation_time), scenario: text(frame.scenario) } as TelemetryFrame;
    if (parsed.spacecraft_id !== incident.spacecraftId) bad();
    return parsed;
  });
  const markers = rawMarkers.map(item => { const marker = object(item);
    const kind: ReplayMarker["kind"] = marker.kind === "alert" || marker.kind === "timeline" ? marker.kind : bad();
    const severity = marker.severity === null ? null : ["info", "warning", "high", "critical"].includes(String(marker.severity)) ? marker.severity as Severity : bad();
    return { id: text(marker.id), timestamp: date(marker.timestamp), kind, label: text(marker.label), severity };
  });
  if (frames.some((frame, index) => index > 0 && Date.parse(frame.timestamp) < Date.parse(frames[index - 1].timestamp))) bad();
  return { incident, window: { from: date(window.from), to: date(window.to) }, frames, markers };
}
