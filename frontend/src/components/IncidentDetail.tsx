import { useRef, useState } from "react";
import type { IncidentAction } from "../api/incidents";
import {
  STATUS_LABELS,
  TRANSITIONS,
  utcTime,
  type IncidentDetailData,
  type IncidentStatus,
} from "../domain/incidents";
import { METRICS, SUBSYSTEMS } from "../domain/telemetry";
import { InvestigationPanel } from "./InvestigationPanel";
import {RecoveryPanel} from "./RecoveryPanel";
import { MissionReplay } from "./MissionReplay";

export function IncidentDetail({
  data,
  disabled,
  pending,
  comment,
  onComment,
  onMutate,
  onRefresh,
  operatorRole,
}: {
  data: IncidentDetailData;
  disabled: boolean;
  pending: boolean;
  comment: string;
  onComment(value: string): void;
  onMutate(action: IncidentAction, value?: string): Promise<boolean>;
  onRefresh(): void;
  operatorRole: string | null;
}) {
  const { incident, alerts, timeline } = data;
  const [status, setStatus] = useState<IncidentStatus | "">("");
  const [commentError, setCommentError] = useState("");
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const transitions = TRANSITIONS[incident.status];
  const statusValue = status && transitions.includes(status) ? status : "";
  return (
    <section
      className="incident-detail"
      aria-label="Incident detail"
      aria-busy={pending}
    >
      <h3>
        {incident.displayNumber} · {incident.title}
      </h3>
      <p className="incident-meta">
        <span data-severity={incident.severity}>{incident.severity}</span> ·{" "}
        <strong>{STATUS_LABELS[incident.status]}</strong> ·{" "}
        {incident.affectedSubsystems
          .map((id) => SUBSYSTEMS.find((item) => item.id === id)?.label ?? id)
          .join(", ")}
      </p>
      <InvestigationPanel incidentId={incident.id} disabled={disabled} onCompleted={onRefresh} />
      <RecoveryPanel incidentId={incident.id} incidentStatus={incident.status} role={operatorRole} disabled={disabled} onCompleted={onRefresh}/>
      <MissionReplay incidentId={incident.id} />
      {incident.description && <p>{incident.description}</p>}
      <p className="incident-meta">
        Opened{" "}
        <time dateTime={incident.createdAt}>{utcTime(incident.createdAt)}</time>
      </p>
      <div className="incident-actions">
        <button
          type="button"
          disabled={disabled || !transitions.includes("acknowledged")}
          onClick={() => void onMutate("acknowledge")}
        >
          Acknowledge
        </button>
        <button
          type="button"
          disabled={disabled || !transitions.includes("resolved")}
          onClick={() => void onMutate("resolve")}
        >
          Resolve
        </button>
      </div>
      <form
        noValidate
        className="incident-status-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (statusValue && !disabled) void onMutate("status", statusValue);
        }}
      >
        <label htmlFor="incident-status">Incident status</label>
        {/* Native select: platform-owned popup geometry and keyboard behavior are accepted. */}
        <select
          id="incident-status"
          value={statusValue}
          disabled={disabled}
          onChange={(event) => setStatus(event.target.value as IncidentStatus)}
        >
          <option value="">Choose next status</option>
          {transitions.map((next) => (
            <option key={next} value={next}>
              {STATUS_LABELS[next]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={disabled || !statusValue}>
          Change status
        </button>
      </form>
      <h4>Linked alerts</h4>
      {alerts.length === 0 ? (
        <p>No linked alerts.</p>
      ) : (
        <ul className="incident-alerts" aria-label="Linked alerts">
          {alerts.map((alert) => {
            const metric = METRICS.find((item) => item.key === alert.metric);
            return (
              <li key={alert.id}>
                <strong>{metric?.label ?? alert.metric}</strong>
                <p>
                  <span data-severity={alert.severity}>{alert.severity}</span> ·{" "}
                  {alert.value} {metric?.unit} · {alert.detectionMethod}{" "}
                  detection · {alert.occurrenceCount} observations
                </p>
                {alert.expectedRange && <p>Expected: {alert.expectedRange}</p>}
                <time dateTime={alert.lastSeenAt}>
                  {utcTime(alert.lastSeenAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
      {alerts.length === 1000 && <p>Showing up to 1000 linked alerts.</p>}
      <h4>Timeline</h4>
      <p className="incident-meta">
        Chronological · UTC
        {timeline.length === 1000 ? " · Latest 1000 events" : ""}
      </p>
      {timeline.length === 0 ? (
        <p>No timeline events recorded.</p>
      ) : (
        <ol className="incident-timeline" aria-label="Incident timeline">
          {timeline.map((event) => (
            <li key={event.id}>
              <time dateTime={event.timestamp}>{utcTime(event.timestamp)}</time>
              <p className="incident-meta">
                {event.eventType.replaceAll("_", " ")} ·{" "}
                {event.actorId ? `Operator ${event.actorId}` : "System"}
              </p>
              <p className="incident-comment-text">{event.description}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        noValidate
        className="incident-comment-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (disabled) return;
          if (!comment.trim() || comment.trim().length > 2000) {
            setCommentError("Enter a comment between 1 and 2000 characters.");
            commentRef.current?.focus();
            return;
          }
          setCommentError("");
          if (await onMutate("comments", comment.trim())) onComment("");
        }}
      >
        <label htmlFor="incident-comment">Comment</label>
        <textarea
          ref={commentRef}
          id="incident-comment"
          className="resize-none"
          rows={5}
          value={comment}
          disabled={disabled}
          aria-invalid={Boolean(commentError)}
          aria-describedby="incident-comment-help"
          onChange={(event) => {
            onComment(event.target.value);
            setCommentError("");
          }}
        />
        <p
          id="incident-comment-help"
          className={commentError ? "incident-error" : "incident-meta"}
        >
          {commentError ||
            `${comment.trim().length}/2000 characters · Text only. Draft retained while switching incidents.`}
        </p>
        <button type="submit" disabled={disabled}>
          Add comment
        </button>
      </form>
    </section>
  );
}
