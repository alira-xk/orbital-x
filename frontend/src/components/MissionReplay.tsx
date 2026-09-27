import { useEffect, useState } from "react";
import { fetchIncidentReplay } from "../api/incidents";
import type { IncidentReplay } from "../domain/replay";
import type { SubsystemId } from "../domain/telemetry";
import { utcTime } from "../domain/incidents";
import { OrbitalScene } from "./OrbitalScene";

export function MissionReplay({ incidentId }: { incidentId: string }) {
  const [data, setData] = useState<IncidentReplay | null>(null);
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [subsystem, setSubsystem] = useState<SubsystemId>("propulsion");

  useEffect(() => { setData(null); setIndex(0); setPlaying(false); setError(""); }, [incidentId]);
  useEffect(() => {
    if (!playing || !data || index >= data.frames.length - 1) { if (playing && data && index >= data.frames.length - 1) setPlaying(false); return; }
    const timer = window.setTimeout(() => setIndex(value => Math.min(value + 1, data.frames.length - 1)), 1000 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, data, index, speed]);

  async function load() {
    const controller = new AbortController();
    setLoading(true); setError("");
    try { const replay = await fetchIncidentReplay(incidentId, controller.signal); setData(replay); setIndex(0); }
    catch { setError("Replay unavailable. Check backend storage and retry."); }
    finally { setLoading(false); }
  }

  const frame = data?.frames[index] ?? null;
  const reached = data && frame ? data.markers.filter(marker => Date.parse(marker.timestamp) <= Date.parse(frame.timestamp)) : [];
  return (
    <section className="mission-replay" aria-label="Mission replay">
      <div className="replay-heading"><div><p className="eyebrow">Recorded operations</p><h4>Mission replay</h4></div>
        {!data && <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Loading replay…" : error ? "Retry mission replay" : "Load mission replay"}</button>}
      </div>
      {error && <p className="incident-error" role="alert">{error}</p>}
      {data && data.frames.length === 0 && <p>No telemetry was recorded in this incident window.</p>}
      {data && frame && <>
        <div className="replay-stage"><OrbitalScene telemetry={frame} selectedSubsystem={subsystem} onSelectSubsystem={setSubsystem} /></div>
        <div className="replay-controls">
          <button type="button" onClick={() => { if (index >= data.frames.length - 1) setIndex(0); setPlaying(value => !value); }}>{playing ? "Pause replay" : "Play replay"}</button>
          <label>Speed <select aria-label="Replay speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={16}>16×</option></select></label>
          <label className="replay-scrubber">Replay position<input aria-label="Replay position" type="range" min={0} max={Math.max(0, data.frames.length - 1)} value={index} onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} /></label>
          <output>{index + 1} / {data.frames.length} · {utcTime(frame.timestamp)}</output>
        </div>
        <div className="replay-markers"><h5>Events reached</h5>{reached.length === 0 ? <p>No incident events at this point.</p> : <ol>{reached.map(marker => <li key={marker.id}><time dateTime={marker.timestamp}>{utcTime(marker.timestamp)}</time><span data-severity={marker.severity ?? undefined}>{marker.label}</span></li>)}</ol>}</div>
      </>}
    </section>
  );
}
