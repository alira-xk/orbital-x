import { useEffect, useState } from "react";
import { MissionHeader } from "./components/MissionHeader";
import { OrbitalScene } from "./components/OrbitalScene";
import { SubsystemSelector } from "./components/SubsystemSelector";
import { SystemDiagnostics } from "./components/SystemDiagnostics";
import { TelemetryWorkspace } from "./components/TelemetryWorkspace";
import type { SubsystemId } from "./domain/telemetry";
import { useTelemetrySocket } from "./hooks/useTelemetrySocket";
import { METRICS } from "./domain/telemetry";
import { IncidentRail } from "./components/IncidentRail";

function App() {
  const [selectedSubsystem, setSelectedSubsystem] =
    useState<SubsystemId>("propulsion");
  const { telemetry, connectionStatus } = useTelemetrySocket();

  useEffect(() => {
    document.title = "ORBITAL-X1 Mission Control";
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#mission-content">
        Skip to mission data
      </a>
      <MissionHeader
        telemetry={telemetry}
        connectionStatus={connectionStatus}
      />
      <main id="mission-content">
        <div className="mission-overview">
          <section className="mission-brief" aria-label="Mission overview">
            <p className="eyebrow">Flight operations / ORBITAL-X1</p>
            <h2>
              Mission
              <br />
              overview<span>.</span>
            </h2>
            <p className="brief-description">
              Spacecraft telemetry, trajectory and subsystem performance.
            </p>
            <dl className="overview-readings">
              {["fuel_level", "battery_level", "signal_strength"].map((key) => {
                const metric = METRICS.find((item) => item.key === key)!;
                const value = telemetry?.[key];
                return (
                  <div key={key}>
                    <dt>{metric.label}</dt>
                    <dd>
                      {typeof value === "number" && Number.isFinite(value)
                        ? value.toFixed(metric.precision)
                        : "—"}{" "}
                      <span>{metric.unit}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="brief-footnote">
              {telemetry
                ? "Latest received frame · see frame age above"
                : "Awaiting live measurements. Browse recorded history below."}
            </p>
          </section>
          <OrbitalScene
            telemetry={telemetry}
            selectedSubsystem={selectedSubsystem}
            onSelectSubsystem={setSelectedSubsystem}
          />
        </div>
        <SubsystemSelector
          selected={selectedSubsystem}
          onSelect={setSelectedSubsystem}
          telemetry={telemetry}
        />

        <section className="mission-deck" aria-label="Mission data">
          <TelemetryWorkspace
            spacecraftId="ORBITAL-X1"
            selectedSubsystem={selectedSubsystem}
            telemetry={telemetry}
            connectionStatus={connectionStatus}
          />
        </section>

        <IncidentRail />
        <SystemDiagnostics />
      </main>
    </div>
  );
}

export default App;
