import { useEffect, useRef, useState } from "react";
import { STATUS_LABELS, utcTime } from "../domain/incidents";
import { useIncidents } from "../hooks/useIncidents";
import { IncidentDetail } from "./IncidentDetail";

export function IncidentRail() {
  const state = useIncidents();
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const identityRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const hasDraft = Object.values(drafts).some(Boolean);
  useEffect(() => {
    if (!hasDraft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDraft]);
  const disabled =
    !state.operator ||
    state.pending ||
    state.detailLoading ||
    Boolean(state.detailError || state.listError) ||
    state.needsRefresh;
  return (
    <section className="incident-console" aria-label="Incident console">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Operator workflow</p>
          <h2>Incidents</h2>
        </div>
        <button
          type="button"
          disabled={state.listLoading || state.detailLoading || state.pending}
          onClick={state.refresh}
        >
          Refresh incidents
        </button>
      </div>
      <div className="incident-session">
        <p role="status" aria-label="Operator session">
          {state.authLoading
            ? "Checking operator session…"
            : state.operator
              ? `Signed in as ${state.operator.username}`
              : "Sign in to triage incidents. Read-only inspection is available."}
        </p>
        {!state.authLoading && !state.operator && (
          <form
            noValidate
            className="incident-login"
            onSubmit={async (event) => {
              event.preventDefault();
              if (state.pending) return;
              if (
                !identity.trim() ||
                identity.trim().length > 255 ||
                !password ||
                password.length > 72
              ) {
                setLoginError(
                  "Enter a username or email (up to 255 characters) and password (up to 72 characters).",
                );
                if (!identity.trim() || identity.trim().length > 255)
                  identityRef.current?.focus();
                else passwordRef.current?.focus();
                return;
              }
              setLoginError("");
              if (await state.login(identity, password)) {
                setPassword("");
                setShowPassword(false);
              }
            }}
          >
            <div>
              <label htmlFor="incident-identity">Username or email</label>
              <input
                ref={identityRef}
                id="incident-identity"
                autoComplete="username"
                value={identity}
                disabled={state.pending}
                aria-invalid={Boolean(loginError && !identity.trim())}
                aria-describedby="incident-login-help"
                onChange={(event) => setIdentity(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="incident-password">Password</label>
              <input
                ref={passwordRef}
                id="incident-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                disabled={state.pending}
                aria-invalid={Boolean(
                  loginError && (!password || password.length > 72),
                )}
                aria-describedby="incident-login-help"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={state.pending}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? "Hide password" : "Show password"}
            </button>
            <button
              type="submit"
              disabled={state.pending}
              aria-busy={state.pending}
            >
              Sign in
            </button>
          </form>
        )}
        <p
          id="incident-login-help"
          className="incident-feedback incident-error"
          role="status"
        >
          {loginError || state.authError}
        </p>
      </div>
      <div className="incident-workspace">
        <div className="incident-list-panel">
          <p
            className="incident-feedback"
            role="status"
            aria-label="Incident list status"
          >
            {state.listError
              ? state.incidents
                ? "Showing retained incidents; refresh failed. Refresh to retry."
                : state.listError
              : state.listLoading
                ? state.incidents
                  ? "Refreshing incidents…"
                  : "Loading incidents…"
                : state.incidents?.length === 0
                  ? "No incidents recorded on this page."
                  : `Rows ${state.offset + 1}–${state.offset + (state.incidents?.length ?? 0)} · Refresh every 15s`}
          </p>
          <ul className="incident-list" aria-label="Incidents">
            {state.incidents?.map((incident) => (
              <li key={incident.id}>
                <button
                  type="button"
                  aria-pressed={state.selectedId === incident.id}
                  disabled={state.pending}
                  onClick={() => state.select(incident.id)}
                >
                  <span className="incident-number">
                    {incident.displayNumber}
                  </span>
                  <span>{incident.title}</span>
                  <span className="incident-meta">
                    <span data-severity={incident.severity}>
                      {incident.severity}
                    </span>{" "}
                    · {STATUS_LABELS[incident.status]} · {incident.alertCount}{" "}
                    alerts
                  </span>
                  <time dateTime={incident.updatedAt ?? incident.createdAt}>
                    {utcTime(incident.updatedAt ?? incident.createdAt)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
          <div className="incident-actions" aria-label="Incident pages">
            <button
              type="button"
              disabled={
                state.offset === 0 || state.pending || state.listLoading
              }
              onClick={() => state.page(Math.max(0, state.offset - 50))}
            >
              Previous incidents
            </button>
            <button
              type="button"
              disabled={
                state.incidents?.length !== 50 ||
                state.pending ||
                state.listLoading ||
                Boolean(state.listError)
              }
              onClick={() => state.page(state.offset + 50)}
            >
              Next incidents
            </button>
          </div>
        </div>
        <div className="incident-detail-panel">
          <p
            className={`incident-feedback ${state.actionError || state.detailError ? "incident-error" : ""}`}
            role="status"
            aria-label="Incident detail status"
          >
            {state.detailError
              ? state.detail
                ? `Showing retained detail. ${state.detailError}`
                : state.detailError
              : state.detailLoading
                ? "Loading incident detail…"
                : state.actionMessage ||
                  (!state.selectedId
                    ? "Select an incident to inspect evidence and timeline."
                    : "")}
          </p>
          {state.detail && (
            <IncidentDetail
              key={state.detail.incident.id}
              data={state.detail}
              disabled={disabled}
              pending={state.pending}
              comment={drafts[state.detail.incident.id] ?? ""}
              onComment={(value) =>
                setDrafts((previous) => ({
                  ...previous,
                  [state.detail!.incident.id]: value,
                }))
              }
              onMutate={state.mutate}
              onRefresh={state.refresh}
              operatorRole={state.operator?.role ?? null}
            />
          )}
        </div>
      </div>
    </section>
  );
}
