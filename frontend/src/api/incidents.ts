import {
  parseDetail,
  parseIncident,
  parseIncidentList,
  parseOperator,
  parseTimelineEvent,
  type IncidentStatus,
} from "../domain/incidents";
import { parseInvestigation, parseInvestigationList } from "../domain/investigations";
import {parseCommand,parseCommandList,type CommandStatus,type CommandType} from "../domain/commands";
import { parseIncidentReplay } from "../domain/replay";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
export class IncidentRequestError extends Error {
  constructor(public status: number) {
    super(`Incident request failed (${status})`);
  }
}
async function request<T>(
  path: string,
  parse: (value: unknown) => T,
  signal: AbortSignal,
  body?: object,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = window.setTimeout(abort, 10_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      signal: controller.signal,
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!response.ok) throw new IncidentRequestError(response.status);
    const envelope: unknown = await response.json();
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      !("success" in envelope) ||
      envelope.success !== true ||
      !("data" in envelope)
    ) {
      throw new Error("Malformed incident response");
    }
    return parse(envelope.data);
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export const fetchIncidents = (offset: number, signal: AbortSignal) =>
  request(
    `/incidents?spacecraftId=ORBITAL-X1&limit=50&offset=${offset}`,
    (data) => {
      const incidents = parseIncidentList(data);
      if (incidents.some((incident) => incident.spacecraftId !== "ORBITAL-X1"))
        throw new Error("Incident response does not match spacecraft");
      return incidents;
    },
    signal,
  );
export const fetchIncident = (id: string, signal: AbortSignal) =>
  request(
    `/incidents/${encodeURIComponent(id)}?limit=1000`,
    (data) => {
      const detail = parseDetail(data);
      if (detail.incident.id !== id)
        throw new Error("Incident response does not match selection");
      return detail;
    },
    signal,
  );
export async function fetchOperator(signal: AbortSignal) {
  try {
    return await request("/auth/me", parseOperator, signal);
  } catch (error) {
    if (
      !(error instanceof IncidentRequestError) ||
      error.status !== 401 ||
      signal.aborted
    )
      throw error;
    return request("/auth/refresh", parseOperator, signal, {});
  }
}
export const loginOperator = (
  identity: string,
  password: string,
  signal: AbortSignal,
) =>
  request("/auth/login", parseOperator, signal, {
    [identity.includes("@") ? "email" : "username"]: identity.trim(),
    password,
  });
export type IncidentAction = "acknowledge" | "status" | "comments" | "resolve";
export function mutateIncident(
  id: string,
  action: IncidentAction,
  expectedStatus: IncidentStatus,
  signal: AbortSignal,
  value?: string,
) {
  const body =
    action === "comments"
      ? { comment: value?.trim() }
      : action === "status"
        ? { expectedStatus, status: value }
        : { expectedStatus };
  return request(
    `/incidents/${encodeURIComponent(id)}/${action}`,
    (data) =>
      action === "comments" ? parseTimelineEvent(data) : parseIncident(data),
    signal,
    body,
  );
}
export const fetchInvestigations=(id:string,signal:AbortSignal)=>request(`/incidents/${encodeURIComponent(id)}/investigations?limit=20`,parseInvestigationList,signal);
export const startInvestigation=(id:string,signal:AbortSignal)=>request(`/incidents/${encodeURIComponent(id)}/investigations`,parseInvestigation,signal,{});
export const fetchCommands=(id:string,signal:AbortSignal)=>request(`/incidents/${encodeURIComponent(id)}/commands?limit=20`,parseCommandList,signal);
export const requestCommand=(id:string,type:CommandType,parameters:Record<string,unknown>,incidentStatus:string,signal:AbortSignal)=>request(`/incidents/${encodeURIComponent(id)}/commands`,parseCommand,signal,{commandType:type,parameters,expectedIncidentStatus:incidentStatus});
export const approveCommand=(id:string,status:CommandStatus,signal:AbortSignal)=>request(`/commands/${encodeURIComponent(id)}/approve`,parseCommand,signal,{expectedStatus:status});
export const fetchIncidentReplay=(id:string,signal:AbortSignal)=>request(`/incidents/${encodeURIComponent(id)}/replay`,parseIncidentReplay,signal);
