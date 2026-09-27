export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum AlertStatus {
  ACTIVE = 'active',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

export enum IncidentStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  REOPENED = 'reopened',
}

export interface AlertRecord {
  id: string;
  spacecraftId: string;
  subsystem: string;
  severity: AlertSeverity;
  metric: string;
  value: number;
  expectedRange: string | null;
  anomalyScore: number | null;
  detectionMethod: 'rule' | 'rate' | 'ml' | 'hybrid';
  fingerprint: string;
  occurrenceCount: number;
  status: AlertStatus;
  createdAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  updatedAt: string | null;
}

export interface IncidentRecord {
  id: string;
  incidentNumber: number;
  displayNumber: string;
  spacecraftId: string;
  title: string;
  description: string | null;
  severity: AlertSeverity;
  status: IncidentStatus;
  rootCause: string | null;
  affectedSubsystems: readonly string[];
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  updatedAt: string | null;
}

export interface TimelineEvent {
  id: number;
  incidentId: string;
  actorId: string | null;
  eventType: 'created' | 'observed_again' | 'acknowledged' | 'status_changed' | 'commented' | 'resolved' | 'reopened';
  description: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

export function formatIncidentDisplayNumber(incidentNumber: number): string {
  return `INC-${incidentNumber}`;
}
