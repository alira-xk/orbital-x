import type { AnomalyResult } from '../telemetry/anomalyDetection.js';
import type { TelemetryDatabase } from '../telemetry/repository.js';
import type { TelemetryFrame } from '../telemetry/schema.js';
import { correlateAlert, correlationPeers, normalizeDetectionMethod, normalizeSeverity } from './incidentCorrelator.js';
import { inIncidentTransaction, lockSpacecraft, PostgresAlertRepository, PostgresIncidentRepository } from './repository.js';

export class AlertService {
  private readonly alerts: PostgresAlertRepository;
  private readonly incidents: PostgresIncidentRepository;
  constructor(private readonly database: TelemetryDatabase) {
    this.alerts = new PostgresAlertRepository(database);
    this.incidents = new PostgresIncidentRepository(database);
  }

  async handleEvidence(frame: TelemetryFrame, result: AnomalyResult): Promise<void> {
    if (result.severity.toLowerCase() === 'nominal' || result.anomalies.length === 0) return;
    const severity = normalizeSeverity(result.severity);
    await inIncidentTransaction(this.database, async client => {
      await lockSpacecraft(client, frame.spacecraft_id);
      const observations = [];
      for (const finding of result.anomalies) {
        const observation = await this.alerts.observe(client, {
          spacecraftId: frame.spacecraft_id, timestamp: frame.timestamp, metric: finding.metric,
          subsystem: finding.subsystem, severity, value: finding.value, expectedRange: finding.expectedRange,
          anomalyScore: finding.score, detectionMethod: normalizeDetectionMethod(finding.methods),
        });
        if (observation) observations.push(observation);
      }

      // Persist the whole frame and renew existing incident activity before any
      // new correlation decision. A finding's input position must not hide a
      // related incident that another finding in this frame is renewing.
      observations.sort((a, b) => a.alert.fingerprint.localeCompare(b.alert.fingerprint));
      for (const { alert } of observations) {
        const candidates = await this.incidents.candidates(client, alert);
        for (const candidate of candidates) {
          if (candidate.alerts.some(peer => peer.id === alert.id)) {
            await this.incidents.link(client, candidate.incident.id, [alert.id], alert.lastSeenAt);
          }
        }
      }

      for (const observation of observations) {
        const { alert, kind } = observation;
        const candidates = await this.incidents.candidates(client, alert);
        const unlinked = await this.alerts.unlinked(client, alert);
        // Once linked, later observations continue that active incident even after a quiet gap.
        const linked = candidates.find(candidate => candidate.alerts.some(peer => peer.id === alert.id));
        const decision = linked ? {
          kind: 'link' as const, incidentId: linked.incident.id,
          alertIds: [...new Set([alert.id, ...correlationPeers(alert, unlinked).map(peer => peer.id)])].sort(),
        } : correlateAlert(alert, candidates, unlinked);
        if (decision.kind === 'none') continue;
        const incidentId = decision.kind === 'create' ? (await this.incidents.create(client, alert)).id : decision.incidentId;
        await this.incidents.link(client, incidentId, decision.alertIds, alert.lastSeenAt);
        if (decision.kind === 'create' && kind !== 'created') {
          await this.incidents.appendEvent(client, incidentId, 'created', `Created incident for ${alert.metric}`,
            { alertIds: decision.alertIds }, alert.lastSeenAt);
        }
        await this.incidents.appendEvent(client, incidentId, kind,
          kind === 'observed_again' ? `Observed ${alert.metric} again` : `${kind === 'reopened' ? 'Reopened' : 'Created'} alert for ${alert.metric}`,
          { alertId: alert.id, alertIds: decision.alertIds, fingerprint: alert.fingerprint, occurrenceCount: alert.occurrenceCount }, alert.lastSeenAt);
      }
    });
  }
}
