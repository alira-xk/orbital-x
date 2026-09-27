# ORBITAL-X

**AI-Powered Spacecraft Mission Control Center**

A production-quality portfolio project demonstrating advanced software engineering, AI/ML, and real-time systems.

## Overview

ORBITAL-X is a simulated spacecraft mission control system that processes real-time telemetry, detects anomalies using ML, and enables AI-driven incident investigation with full end-to-end recovery workflows.

## Architecture

```
┌──────────────────────────────┐
│      SPACECRAFT SIMULATOR    │
└──────────────┬───────────────┘
               ↓
          TELEMETRY
               ↓
       ┌───────┴───────┐
       │  Redis Stream │
       └───────┬───────┘
               ↓
    ┌──────────┼──────────┐
    ↓          ↓          ↓
 Storage   Detection   Event
 Worker    Worker      Worker
    ↓          ↓
    ↓          ↓
┌───┴────┐    ↓    ┌────┴────┐
│  DB    │    ↓    │  Alert  │
└────────┘    ↓    │ Engine  │
                  └────┬─────┘
                       ↓
                  ┌────┴────┐
                  │Incident │
                  └────┬────┘
                       ↓
              ┌────────┴────────┐
              ↓                 ↓
        ┌─────┴─────┐    ┌──────┴──────┐
        │  AI/RAG   │    │  Recovery   │
        │Investgate │    │  Commands   │
        └─────┬─────┘    └──────┬──────┘
              ↓                 ↓
        ┌─────┴─────┐    ┌──────┴──────┐
        │Evidence   │    │ Authorization│
        │LLM Output │    │Safety Check │
        └─────┬─────┘    └──────┬──────┘
              ↓                 ↓
        ┌─────┴─────┐    ┌──────┴──────┐
        │ Root Cause│    │  Spacecraft │
        │  Report   │    │   Recovery   │
        └───────────┘    └─────────────┘
```

## Technology Stack

### Frontend
- **React 18** + TypeScript
- **Vite** - Build tooling
- **Tailwind CSS** - Styling
- **Three.js** + React Three Fiber - 3D visualization
- **Recharts** - Telemetry charts
- **TanStack Query** - Data fetching
- **Zustand** - State management
- **WebSockets** - Real-time updates

### Backend
- **Node.js** + Express
- **TypeScript** - Type safety
- **PostgreSQL** - Primary database
- **Redis** - Streams, queues, caching
- **BullMQ** - Job queues
- **WebSockets** - Real-time communication
- **JWT** - Authentication
- **Zod** - Validation

### AI/ML
- **Python** + FastAPI
- Deterministic bounded Isolation Forest in the TypeScript telemetry worker
- Configurable embedding and OpenAI/Ollama LLM providers
- **pgvector** - Durable semantic search

### Infrastructure
- Native Windows execution (no Docker)
- GitHub Actions - CI/CD
- PowerShell scripts - Dev tooling

## Project Structure

```
orbital-x/
├── frontend/          # React + TypeScript application
├── backend/           # Node.js + Express API
├── ai/                # Python + FastAPI AI service
├── simulator/         # Spacecraft simulator
├── database/          # SQL migrations
├── docs/              # Documentation
├── scripts/           # PowerShell scripts
└── .github/workflows/ # CI/CD pipelines
```

## Features

### Phase 1-2: Spacecraft Simulator
- [x] Realistic spacecraft state engine
- [x] Physics-based telemetry generation
- [x] Multiple failure scenarios
- [x] Configurable simulation speed

### Phase 3: Telemetry Pipeline
- [x] Redis stream-based telemetry ingestion
- [x] PostgreSQL persistence
- [x] WebSocket real-time streaming
- [x] Current live telemetry status panel
- [x] Local Redis + PostgreSQL end-to-end verification

### Phase 4: Mission Control Dashboard
- [x] Six selectable subsystem workspaces with synchronized 3D controls
- [x] Live and historical telemetry charts for 1m/5m/15m/1h/6h/24h ranges
- [x] Server-side time buckets with average/minimum/maximum envelopes
- [x] Procedural Earth, orbit, spacecraft, trajectory, and clickable subsystem markers
- [x] Responsive, keyboard-accessible, reduced-motion-aware operator interface

### Phase 5: Anomaly Detection
- [x] Deterministic bounded Isolation Forest trained on seeded nominal telemetry
- [x] Explainable engineering-band rules across all 31 catalog metrics
- [x] Unit-aware rate-of-change analysis with streaming frame history
- [x] Bounded deterministic synthetic dataset generation

### Phase 6: Incident Management
- [x] Durable alert engine with canonical-fingerprint deduplication and reopen behavior
- [x] Same-spacecraft incident correlation within a five-minute subsystem/causal-family window
- [x] Ordered, append-only incident timeline with alert, status, and operator events
- [x] Authenticated operator workflow: acknowledge, status change, comment, and resolve

Phase 6 uses bcrypt verification and HTTP-only, same-site access/refresh cookies (secure in production); only refresh-token hashes are persisted. `GET /api/alerts`, `GET /api/incidents`, and `GET /api/incidents/:id` are bounded read APIs. `POST /api/auth/login`, `/api/auth/refresh`, and `GET /api/auth/me` establish and inspect the session; authenticated incident mutations are available at `/:id/acknowledge`, `/:id/status`, `/:id/comments`, and `/:id/resolve` with optimistic expected-status checks.

Alert correlation and human triage stop at Phase 6. Phase 7 adds read-only AI investigation; Phase 8 turns validated recommendations into separately authorized, audited recovery commands.

### Phase 7: AI Investigation
- [x] Deterministic Markdown ingestion with fingerprinted, idempotent pgvector storage
- [x] Bounded semantic search over the operational knowledge base
- [x] Read-only incident, alert, timeline, and telemetry investigation tools
- [x] Configurable OpenAI/Ollama provider with strict schema validation
- [x] Durable attempts, safe failure states, citations, alternatives, and advisory actions
- [x] Authenticated backend routes and incident-console investigation panel

Phase 7 is implemented and passes the automated verification matrix. A real local provider/RAG completion still requires PostgreSQL with pgvector, valid database credentials, and either `OPENAI_API_KEY` or a running Ollama service. Without those dependencies, startup remains fail-soft and provider failures are recorded safely; no recovery command is executed.

### Phase 8: Recovery System
- [x] Allowlisted, parameter-validated recovery commands
- [x] Five-role RBAC enforcement and optimistic command state transitions
- [x] Two-distinct-operator approval for critical flight-computer restart
- [x] Durable command/audit/timeline persistence and Redis transport
- [x] Simulator-side idempotent execution with telemetry-visible recovery effects
- [x] Incident-console request, approval, rejection, cancellation, and result UI

Phase 8 is implemented and locally verified with PostgreSQL and Redis. A propulsion isolation command completed through the real API/stream/simulator/result path. A critical flight-computer restart remained pending after one approval and executed only after a second distinct authorized operator approved it. The simulator regression suite verifies gradual post-isolation pressure recovery. AI remains advisory and cannot dispatch commands.

### Phase 9: Mission Replay
- [x] Incident-scoped replay from persisted PostgreSQL telemetry
- [x] Play, pause, 1×/4×/16× speed, and timeline scrubbing
- [x] Recorded alert/timeline markers synchronized with the 3D orbital instrument
- [x] Strict bounded validation; replay remains read-only

### Phase 10: Polish
- [x] One-command lint, typecheck, test, build, and dependency-security gate
- [x] Isolated native PostgreSQL/Redis propulsion-leak recovery E2E
- [x] Fresh measured API latency evidence with no invented benchmark claims
- [x] Native-Windows setup, architecture, security, and verification documentation

## Local Setup

### Prerequisites
- Node.js 18+
- Python 3.10+
- PostgreSQL 15+
- Redis 7+

### 1. Clone and Install

```powershell
git clone <repository>
cd orbital-x

# JavaScript workspaces
npm install

# AI Service
cd ai
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Simulator
cd ../simulator
pip install -r requirements.txt
```

### 2. Database Setup

```powershell
# Create database
psql -U postgres -c "CREATE DATABASE orbital_x;"

# Run migrations
psql -U postgres -d orbital_x -f database/init.sql
```

### 3. Redis Setup

```powershell
# Install and start a Redis 7-compatible Windows service, then verify it
redis-cli ping
```

## Telemetry History API

The dashboard reads bounded history from:

```text
GET /api/telemetry/history/:spacecraftId?metric=fuel_pressure&from=<ISO>&to=<ISO>&bucketSeconds=15
```

`bucketSeconds` is optional and allowlisted to `2`, `5`, `15`, `60`, or `300`. When supplied, each row contains the bucket average in `value` plus `min` and `max`; omitting it preserves raw telemetry reads.

### 4. Configuration

```powershell
# Copy environment files
Copy-Item .env.example .env

# Edit .env with your settings
```

### 5. Run Services

```powershell
# Terminal 1: Backend
.\scripts\start-backend.ps1

# Terminal 2: Frontend
.\scripts\start-frontend.ps1

# Terminal 3: AI Service
.\scripts\start-ai.ps1

# Terminal 4: Simulator
.\scripts\start-simulator.ps1
```

## Scripts

| Script | Description |
|---------|-------------|
| `start-backend.ps1` | Start backend API server |
| `start-frontend.ps1` | Start React dev server |
| `start-ai.ps1` | Start AI FastAPI service |
| `start-simulator.ps1` | Start spacecraft simulator |
| `verify.ps1` | Run lint, types, tests, builds, and the production dependency audit |
| `verify.ps1 -IncludeE2E` | Also run the isolated live propulsion-leak recovery |

## End-to-End Flow

```
Spacecraft Simulator → Telemetry → Anomaly Detection
    → Alert → Incident → AI Investigation
    → Root Cause + Evidence → Recovery Recommendation
    → Human Approval → Command Execution → Spacecraft Recovery
```

## Demo Scenario

1. Start all services
2. Select "Propulsion Leak" scenario
3. Watch telemetry evolve over ~60 seconds
4. ML detects anomaly at T+35s
5. Alert and incident created
6. AI investigates and identifies root cause
7. Recovery command recommended
8. Operator approves and executes
9. Spacecraft stabilizes
10. Incident resolved

## Testing

```powershell
# Complete automated matrix
.\scripts\verify.ps1

# Complete matrix plus real PostgreSQL/Redis recovery flow
.\scripts\verify.ps1 -IncludeE2E
```

The E2E creates uniquely tagged records and Redis streams and removes only those records in `finally`. It writes fresh counts and health latency measurements to `docs/evidence/phase10-verification.json`. Measurements describe that run on that machine, not production capacity.

## Security boundaries

- Secrets come from environment variables; production rejects template JWT secrets.
- Authentication uses HTTP-only, same-site cookies and stores only refresh-token hashes.
- External payloads, LLM responses, and command envelopes are schema validated.
- Recovery commands are allowlisted, role checked, audited, idempotent, and require two distinct operators when critical.
- SQL is parameterized and reads are bounded; reverse-proxy trust is opt-in.
- The quality gate audits production dependencies for high-severity findings.

## CI/CD

GitHub Actions runs the same lint, typecheck, build, JavaScript, AI, simulator, and isolated E2E checks using native PostgreSQL and Redis services—no Docker.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests locally
5. Submit a pull request

## License

MIT

## Acknowledgments

- NASA mission control systems for inspiration
- SpaceX Starlink telemetry for reference
- ISS mission data for realistic values
