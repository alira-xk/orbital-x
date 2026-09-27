import { correlateAlert, canTransitionIncident, normalizeDetectionMethod, normalizeSeverity } from './incidentCorrelator.js';
import { AlertSeverity, AlertStatus, IncidentStatus, type AlertRecord, type IncidentRecord } from './types.js';

const at = '2026-09-14T00:00:00.000Z';
function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return { id: 'a', spacecraftId: 'ORBITAL-X1', metric: 'fuel_pressure', subsystem: 'propulsion',
    severity: AlertSeverity.HIGH, value: 1, expectedRange: '2–2.8', anomalyScore: 0.8,
    detectionMethod: 'rule', fingerprint: 'a', occurrenceCount: 1, status: AlertStatus.ACTIVE,
    createdAt: at, lastSeenAt: at, updatedAt: at, acknowledgedAt: null, acknowledgedBy: null,
    resolvedAt: null, resolvedBy: null, ...overrides };
}
function incident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return { id: 'i', incidentNumber: 1000, displayNumber: 'INC-1000', spacecraftId: 'ORBITAL-X1',
    title: 'Propulsion', description: null, severity: AlertSeverity.HIGH, status: IncidentStatus.OPEN,
    rootCause: null, affectedSubsystems: ['propulsion'], createdAt: at, updatedAt: at,
    acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolvedBy: null, ...overrides };
}

describe('pure incident correlation', () => {
  it.each([['00:05:00.000', 'link'], ['00:05:00.001', 'create']] as const)(
    'uses an inclusive five-minute boundary at %s', (time, kind) => {
      expect(correlateAlert(alert({ lastSeenAt: `2026-09-14T${time}Z` }),
        [{ incident: incident(), alerts: [alert()] }], []).kind).toBe(kind);
    });
  it('isolates spacecraft and resolved incidents', () => {
    for (const changes of [{ spacecraftId: 'OTHER' }, { status: IncidentStatus.RESOLVED }]) {
      expect(correlateAlert(alert(), [{ incident: incident(changes), alerts: [alert()] }], []).kind).toBe('create');
    }
  });
  it('groups by an explicit metric family even across subsystem labels', () => {
    const result = correlateAlert(alert({ id: 'flow', metric: 'fuel_flow', subsystem: 'power' }),
      [{ incident: incident(), alerts: [alert()] }], []);
    expect(result).toMatchObject({ kind: 'link', incidentId: 'i', alertIds: ['flow'] });
  });
  it('does not correlate unrelated unknown metrics just because both are unknown', () => {
    expect(correlateAlert(alert({ metric: 'other', subsystem: 'unknown' }),
      [{ incident: incident({ affectedSubsystems: ['unknown'] }), alerts: [alert({ metric: 'telemetry_profile', subsystem: 'unknown' })] }], []).kind).toBe('create');
  });
  it('requires a distinct fingerprint for warning creation and excludes stale or other-spacecraft peers', () => {
    const warning = alert({ severity: AlertSeverity.WARNING });
    for (const peer of [alert(), alert({ id: 'b', fingerprint: 'b', spacecraftId: 'OTHER' }),
      alert({ id: 'b', fingerprint: 'b', lastSeenAt: '2026-09-13T23:54:59Z' }),
      alert({ id: 'b', fingerprint: 'b', severity: AlertSeverity.INFO })]) {
      expect(correlateAlert(warning, [], [peer]).kind).toBe('none');
    }
    expect(correlateAlert(warning, [], [alert({ id: 'b', fingerprint: 'b', metric: 'fuel_flow', severity: AlertSeverity.WARNING })]))
      .toEqual({ kind: 'create', alertIds: ['a', 'b'] });
  });
  it('keeps info alone but includes related info when a high alert creates an incident', () => {
    expect(correlateAlert(alert({ severity: AlertSeverity.INFO }), [], []).kind).toBe('none');
    expect(correlateAlert(alert(), [], [alert({ id: 'info', fingerprint: 'info', severity: AlertSeverity.INFO })]))
      .toEqual({ kind: 'create', alertIds: ['a', 'info'] });
  });
  it('deterministically prefers latest activity then lowest incident number', () => {
    const candidates = [
      { incident: incident({ id: 'later-number', incidentNumber: 1002 }), alerts: [alert()] },
      { incident: incident({ id: 'earlier-number', incidentNumber: 1001 }), alerts: [alert()] },
    ];
    expect(correlateAlert(alert(), candidates, [])).toMatchObject({ incidentId: 'earlier-number' });
    expect(correlateAlert(alert(), candidates.reverse(), [])).toMatchObject({ incidentId: 'earlier-number' });
  });
  it('accepts reopened incidents as active', () => {
    expect(correlateAlert(alert(), [{ incident: incident({ status: IncidentStatus.REOPENED }), alerts: [alert()] }], []).kind).toBe('link');
  });
  it.each([
    ['battery_voltage', 'current_draw', 'power'], ['cpu_temperature', 'radiator_efficiency', 'thermal'],
    ['packet_loss', 'latency', 'communications'], ['cpu_usage', 'memory_usage', 'flight_computer'],
    ['velocity_x', 'orientation_roll', 'navigation'], ['fuel_pressure', 'thrust', 'propulsion'],
  ])('correlates the explicit family of %s and %s', (metric, peerMetric, subsystem) => {
    expect(correlateAlert(alert({ metric, subsystem: 'unknown' }), [{
      incident: incident({ affectedSubsystems: [subsystem] }), alerts: [alert({ metric: peerMetric, subsystem })],
    }], []).kind).toBe('link');
  });
  it.each([
    [['rule'], 'rule'], [['rate_of_change'], 'rate'], [['isolation_forest'], 'ml'],
    [['rule', 'rate_of_change'], 'hybrid'], [['hybrid'], 'hybrid'], [['rule', 'rule'], 'rule'],
  ])('normalizes detector methods %j', (methods, expected) => {
    expect(normalizeDetectionMethod(methods as string[])).toBe(expected);
  });
  it('normalizes severity and rejects unsupported evidence', () => {
    expect(normalizeSeverity('CRITICAL')).toBe('critical');
    expect(normalizeSeverity('Info')).toBe('info');
    expect(() => normalizeSeverity('broken')).toThrow();
    expect(() => normalizeDetectionMethod(['broken'])).toThrow();
  });
  it('enforces the transition graph including reopening', () => {
    expect(canTransitionIncident(IncidentStatus.OPEN, IncidentStatus.INVESTIGATING)).toBe(true);
    expect(canTransitionIncident(IncidentStatus.INVESTIGATING, IncidentStatus.ACKNOWLEDGED)).toBe(true);
    expect(canTransitionIncident(IncidentStatus.ACKNOWLEDGED, IncidentStatus.INVESTIGATING)).toBe(true);
    expect(canTransitionIncident(IncidentStatus.RESOLVED, IncidentStatus.REOPENED)).toBe(true);
    expect(canTransitionIncident(IncidentStatus.REOPENED, IncidentStatus.RESOLVED)).toBe(true);
    expect(canTransitionIncident(IncidentStatus.RESOLVED, IncidentStatus.OPEN)).toBe(false);
    expect(canTransitionIncident(IncidentStatus.OPEN, IncidentStatus.REOPENED)).toBe(false);
    expect(canTransitionIncident(IncidentStatus.OPEN, IncidentStatus.OPEN)).toBe(false);
  });
});
