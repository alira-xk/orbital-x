import { Cpu, Database, Server, Waves } from 'lucide-react';
import { useEffect, useState } from 'react';

type DiagnosticState = 'checking' | 'healthy' | 'degraded' | 'unavailable';

interface ReadinessResponse {
  status?: string;
  checks?: Record<string, boolean>;
}

const diagnosticLabels: Record<DiagnosticState, string> = {
  checking: 'Checking',
  healthy: 'Ready',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
};

function Diagnostic({
  icon: Icon,
  label,
  state,
}: {
  icon: typeof Server;
  label: string;
  state: DiagnosticState;
}) {
  return (
    <div className="diagnostic-item">
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
      <strong data-state={state}>{diagnosticLabels[state]}</strong>
    </div>
  );
}

export function SystemDiagnostics() {
  const [backend, setBackend] = useState<DiagnosticState>('checking');
  const [redis, setRedis] = useState<DiagnosticState>('checking');
  const [postgres, setPostgres] = useState<DiagnosticState>('checking');
  const [ai, setAi] = useState<DiagnosticState>('checking');

  useEffect(() => {
    let disposed = false;
    let controller = new AbortController();

    const check = async () => {
      controller.abort();
      controller = new AbortController();
      const [readiness, aiHealth] = await Promise.allSettled([
        fetch('http://localhost:3000/health/ready', { signal: controller.signal }),
        fetch('http://localhost:8000/health', { signal: controller.signal }),
      ]);
      if (disposed) return;

      if (readiness.status === 'fulfilled') {
        try {
          const body = await readiness.value.json() as ReadinessResponse;
          if (disposed) return;
          setBackend(readiness.value.ok ? 'healthy' : 'degraded');
          setRedis(body.checks?.redis ? 'healthy' : 'degraded');
          setPostgres(body.checks?.database ? 'healthy' : 'degraded');
        } catch {
          setBackend('unavailable');
          setRedis('unavailable');
          setPostgres('unavailable');
        }
      } else if (readiness.reason?.name !== 'AbortError') {
        setBackend('unavailable');
        setRedis('unavailable');
        setPostgres('unavailable');
      }

      if (aiHealth.status === 'fulfilled') {
        setAi(aiHealth.value.ok ? 'healthy' : 'degraded');
      } else if (aiHealth.reason?.name !== 'AbortError') {
        setAi('unavailable');
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), 5_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="diagnostics" aria-label="System diagnostics">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Pipeline readiness</p>
          <h2>System diagnostics</h2>
        </div>
        <p>Live checks · 5s cadence</p>
      </div>
      <div className="diagnostic-grid">
        <Diagnostic icon={Server} label="Backend" state={backend} />
        <Diagnostic icon={Waves} label="Redis stream" state={redis} />
        <Diagnostic icon={Database} label="PostgreSQL" state={postgres} />
        <Diagnostic icon={Cpu} label="AI service" state={ai} />
      </div>
    </section>
  );
}
