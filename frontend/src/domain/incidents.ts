export type IncidentStatus =
  "open" | "investigating" | "acknowledged" | "resolved" | "reopened";
export type Severity = "info" | "warning" | "high" | "critical";
export interface Incident {
  id: string;
  displayNumber: string;
  spacecraftId: string;
  title: string;
  description: string | null;
  severity: Severity;
  status: IncidentStatus;
  affectedSubsystems: string[];
  createdAt: string;
  updatedAt: string | null;
}
export interface IncidentSummary extends Incident {
  alertCount: number;
}
export interface IncidentAlert {
  id: string;
  metric: string;
  subsystem: string;
  severity: Severity;
  value: number;
  expectedRange: string | null;
  detectionMethod: string;
  occurrenceCount: number;
  lastSeenAt: string;
}
export interface TimelineEvent {
  id: number;
  incidentId: string;
  actorId: string | null;
  eventType: string;
  description: string;
  timestamp: string;
}
export interface IncidentDetailData {
  incident: Incident;
  alerts: IncidentAlert[];
  timeline: TimelineEvent[];
}
export interface Operator {
  id: string;
  username: string;
  role: string;
}
export const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  reopened: "Reopened",
};
export const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ["investigating", "acknowledged", "resolved"],
  investigating: ["acknowledged", "resolved"],
  acknowledged: ["investigating", "resolved"],
  resolved: ["reopened"],
  reopened: ["investigating", "acknowledged", "resolved"],
};
export const utcTime = (value: string) =>
  `${new Date(value).toISOString().replace("T", " ").replace(".000Z", "")} UTC`;

function malformed(): never {
  throw new Error("Malformed incident response");
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : malformed();
}
function text(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : malformed();
}
function nullable(value: unknown): string | null {
  return value === null
    ? null
    : typeof value === "string"
      ? value
      : malformed();
}
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : malformed();
}
function count(value: unknown): number {
  const n = number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : malformed();
}
function date(value: unknown): string {
  const s = text(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    s,
  ) && Number.isFinite(Date.parse(s))
    ? s
    : malformed();
}
function uuid(value: unknown): string {
  const s = text(value);
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(s)
    ? s
    : malformed();
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  return choices.includes(value as T) ? (value as T) : malformed();
}
function list<T>(
  value: unknown,
  parse: (item: unknown) => T,
  limit: number,
): T[] {
  return Array.isArray(value) && value.length <= limit
    ? value.map(parse)
    : malformed();
}
const severity = (value: unknown) =>
  choice(value, ["info", "warning", "high", "critical"] as const);
export function parseIncident(value: unknown): Incident {
  const row = record(value);
  return {
    id: uuid(row.id),
    displayNumber: text(row.displayNumber),
    spacecraftId: text(row.spacecraftId),
    title: text(row.title),
    description: nullable(row.description),
    severity: severity(row.severity),
    status: choice(row.status, Object.keys(STATUS_LABELS) as IncidentStatus[]),
    affectedSubsystems: list(row.affectedSubsystems, text, 100),
    createdAt: date(row.createdAt),
    updatedAt: row.updatedAt === null ? null : date(row.updatedAt),
  };
}
export function parseIncidentList(value: unknown): IncidentSummary[] {
  return list(
    value,
    (item) => ({
      ...parseIncident(item),
      alertCount: count(record(item).alertCount),
    }),
    50,
  );
}
export function parseTimelineEvent(value: unknown): TimelineEvent {
  const row = record(value);
  return {
    id: count(row.id),
    incidentId: uuid(row.incidentId),
    actorId: row.actorId === null ? null : uuid(row.actorId),
    eventType: choice(row.eventType, [
      "created",
      "observed_again",
      "acknowledged",
      "status_changed",
      "commented",
      "resolved",
      "reopened",
    ]),
    description: text(row.description),
    timestamp: date(row.timestamp),
  };
}
export function parseDetail(value: unknown): IncidentDetailData {
  const row = record(value);
  const incident = parseIncident(row.incident);
  const timeline = list(row.timeline, parseTimelineEvent, 1000);
  if (timeline.some((event) => event.incidentId !== incident.id)) malformed();
  return {
    incident,
    timeline: timeline.sort(
      (a, b) =>
        Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id - b.id,
    ),
    alerts: list(
      row.alerts,
      (item) => {
        const alert = record(item);
        return {
          id: uuid(alert.id),
          metric: text(alert.metric),
          subsystem: text(alert.subsystem),
          severity: severity(alert.severity),
          value: number(alert.value),
          expectedRange: nullable(alert.expectedRange),
          detectionMethod: choice(alert.detectionMethod, [
            "rule",
            "rate",
            "ml",
            "hybrid",
          ]),
          occurrenceCount: count(alert.occurrenceCount),
          lastSeenAt: date(alert.lastSeenAt),
        };
      },
      1000,
    ),
  };
}
export function parseOperator(value: unknown): Operator {
  const row = record(value);
  return {
    id: uuid(row.id),
    username: text(row.username),
    role: text(row.role),
  };
}
