import { subsystemForMetric } from '../telemetry/metricCatalog.js';
import { AlertSeverity, AlertStatus, IncidentStatus, type AlertRecord, type IncidentRecord } from './types.js';

export const CORRELATION_WINDOW_MS = 5 * 60 * 1000;
const severities = [AlertSeverity.INFO, AlertSeverity.WARNING, AlertSeverity.HIGH, AlertSeverity.CRITICAL];

export function normalizeSeverity(value: string): AlertSeverity {
  const severity = value.toLowerCase() as AlertSeverity;
  if (!severities.includes(severity)) throw new Error('Unsupported alert severity');
  return severity;
}

export function normalizeDetectionMethod(methods: readonly string[]): AlertRecord['detectionMethod'] {
  const mapping: Record<string, AlertRecord['detectionMethod']> = {
    rule: 'rule', rate_of_change: 'rate', rate: 'rate', isolation_forest: 'ml', ml: 'ml', hybrid: 'hybrid',
  };
  const normalized = [...new Set(methods.map(method => {
    const value = mapping[method.toLowerCase()];
    if (!value) throw new Error('Unsupported detection method');
    return value;
  }))];
  if (normalized.length === 0) throw new Error('Missing detection method');
  return normalized.length > 1 ? 'hybrid' : normalized[0];
}

export function highestSeverity(alerts: readonly AlertRecord[]): AlertSeverity {
  return alerts.filter(alert => alert.status !== AlertStatus.RESOLVED)
    .reduce<AlertSeverity>((highest, alert) => severities.indexOf(alert.severity) > severities.indexOf(highest) ? alert.severity : highest, AlertSeverity.INFO);
}

// The catalog explicitly assigns metrics to each of the six subsystem families.
// This extra family documents the propulsion leak relationship without a model.
const extraFamilies: Readonly<Record<string, readonly string[]>> = {
  fuel_pressure: ['propellant-leak'], fuel_flow: ['propellant-leak'], fuel_level: ['propellant-leak'],
};
function families(metric: string): readonly string[] {
  const subsystem = subsystemForMetric(metric);
  return [...(subsystem === 'unknown' ? [] : [subsystem]), ...(extraFamilies[metric] ?? [])];
}
export function relatedAlerts(a: AlertRecord, b: AlertRecord): boolean {
  if (a.subsystem === b.subsystem && a.subsystem !== 'unknown') return true;
  const other = families(b.metric);
  return families(a.metric).some(family => other.includes(family));
}

export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus): boolean {
  const transitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
    open: [IncidentStatus.INVESTIGATING, IncidentStatus.ACKNOWLEDGED, IncidentStatus.RESOLVED],
    investigating: [IncidentStatus.ACKNOWLEDGED, IncidentStatus.RESOLVED],
    acknowledged: [IncidentStatus.INVESTIGATING, IncidentStatus.RESOLVED],
    resolved: [IncidentStatus.REOPENED],
    reopened: [IncidentStatus.INVESTIGATING, IncidentStatus.ACKNOWLEDGED, IncidentStatus.RESOLVED],
  };
  return transitions[from]?.includes(to) ?? false;
}

export interface CorrelationCandidate { incident: IncidentRecord; alerts: readonly AlertRecord[] }
export type CorrelationDecision = { kind: 'none' }
  | { kind: 'create'; alertIds: string[] }
  | { kind: 'link'; incidentId: string; alertIds: string[] };

export function correlationPeers(alert: AlertRecord, unlinked: readonly AlertRecord[]): AlertRecord[] {
  const observed = Date.parse(alert.lastSeenAt);
  return unlinked.filter(peer => peer.id !== alert.id && peer.fingerprint !== alert.fingerprint
    && peer.spacecraftId === alert.spacecraftId && peer.status !== AlertStatus.RESOLVED
    && Math.abs(observed - Date.parse(peer.lastSeenAt)) <= CORRELATION_WINDOW_MS && relatedAlerts(alert, peer));
}

export function correlateAlert(alert: AlertRecord, candidates: readonly CorrelationCandidate[], unlinked: readonly AlertRecord[]): CorrelationDecision {
  const observed = Date.parse(alert.lastSeenAt);
  const peers = correlationPeers(alert, unlinked);
  const matching = candidates.filter(({ incident, alerts }) => incident.spacecraftId === alert.spacecraftId
    && incident.status !== IncidentStatus.RESOLVED
    && Math.abs(observed - Date.parse(incident.updatedAt ?? incident.createdAt)) <= CORRELATION_WINDOW_MS
    && alerts.some(peer => relatedAlerts(alert, peer)))
    .sort((a, b) => Date.parse(b.incident.updatedAt ?? b.incident.createdAt) - Date.parse(a.incident.updatedAt ?? a.incident.createdAt)
      || a.incident.incidentNumber - b.incident.incidentNumber || a.incident.id.localeCompare(b.incident.id));
  const alertIds = [...new Set([alert.id, ...peers.map(peer => peer.id)])].sort();
  if (matching.length > 0) return { kind: 'link', incidentId: matching[0].incident.id, alertIds };
  if (alert.severity === AlertSeverity.HIGH || alert.severity === AlertSeverity.CRITICAL
    || (alert.severity === AlertSeverity.WARNING && peers.some(peer => peer.severity !== AlertSeverity.INFO))) {
    return { kind: 'create', alertIds };
  }
  return { kind: 'none' };
}
