import { Line, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useLoader } from "@react-three/fiber";
import { SRGBColorSpace, TextureLoader } from "three";
import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { RotateCcw } from "lucide-react";
import type { SubsystemId, TelemetryFrame } from "../domain/telemetry";
import { normalizeNavigation } from "../lib/telemetrySeries";
import { SpacecraftModel } from "./SpacecraftModel";

class OrbitalErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {}

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function OrbitalFallback({ telemetry }: { telemetry: TelemetryFrame | null }) {
  const navigation = normalizeNavigation(telemetry);
  return (
    <div
      className="orbital-fallback"
      role="status"
      aria-label="Orbital view unavailable"
    >
      <div>
        <p className="eyebrow">WebGL unavailable</p>
        <h3>Orbital renderer could not start</h3>
        <p>Telemetry analytics and subsystem controls remain operational.</p>
      </div>
      <dl>
        <div>
          <dt>Position</dt>
          <dd>
            {navigation.rawPosition
              .map((value) => value.toFixed(2))
              .join(" / ")}{" "}
            km
          </dd>
        </div>
        <div>
          <dt>Velocity</dt>
          <dd>{navigation.velocityMagnitude.toFixed(3)} km/s</dd>
        </div>
      </dl>
    </div>
  );
}

function Earth() {
  const surface = useLoader(TextureLoader, "/textures/earth-blue-marble.png");
  surface.colorSpace = SRGBColorSpace;
  surface.anisotropy = 4;
  return (
    <mesh rotation={[0, -1.4, 0]}>
      <sphereGeometry args={[2.05, 64, 48]} />
      <meshStandardMaterial map={surface} roughness={0.85} metalness={0} />
    </mesh>
  );
}

function Scene({
  telemetry,
  selectedSubsystem,
  onSelectSubsystem,
  trail,
}: {
  telemetry: TelemetryFrame | null;
  selectedSubsystem: SubsystemId;
  onSelectSubsystem(subsystem: SubsystemId): void;
  trail: [number, number, number][];
}) {
  const navigation = normalizeNavigation(telemetry);
  const orbit = useMemo<[number, number, number][]>(
    () =>
      Array.from({ length: 129 }, (_, index) => {
        const angle = (index / 128) * Math.PI * 2;
        return [
          Math.cos(angle) * 3.2,
          Math.sin(angle) * 3.2,
          Math.sin(angle) * 0.58,
        ];
      }),
    [],
  );

  return (
    <>
      <color attach="background" args={["#101315"]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[-4, 5, 7]} intensity={2.2} color="#FFFFFF" />
      <Stars
        radius={45}
        depth={18}
        count={160}
        factor={0.8}
        saturation={0}
        fade
        speed={0}
      />
      <Suspense fallback={null}>
        <Earth />
      </Suspense>
      <mesh scale={1.015}>
        <sphereGeometry args={[2.05, 32, 24]} />
        <meshBasicMaterial
          color="#79BFFF"
          transparent
          opacity={0.055}
          side={2}
        />
      </mesh>
      <Line
        points={orbit}
        color="#D7DEE3"
        lineWidth={1}
        transparent
        opacity={0.55}
      />
      {trail.length > 1 && (
        <Line
          points={trail}
          color="#38BDF8"
          lineWidth={2}
          transparent
          opacity={0.75}
        />
      )}
      <SpacecraftModel
        telemetry={telemetry}
        position={navigation.position}
        selectedSubsystem={selectedSubsystem}
        onSelectSubsystem={onSelectSubsystem}
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={5.3}
        maxDistance={10}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI - 0.35}
      />
    </>
  );
}

export function OrbitalScene({
  telemetry,
  selectedSubsystem,
  onSelectSubsystem,
}: {
  telemetry: TelemetryFrame | null;
  selectedSubsystem: SubsystemId;
  onSelectSubsystem(subsystem: SubsystemId): void;
}) {
  const [resetKey, setResetKey] = useState(0);
  const [trail, setTrail] = useState<[number, number, number][]>([]);

  useEffect(() => {
    if (telemetry === null) return;
    const next = normalizeNavigation(telemetry).position;
    setTrail((current) => [...current, next].slice(-80));
  }, [telemetry]);

  return (
    <section
      className="instrument-panel orbital-panel"
      aria-label="ORBITAL-X1 orbital instrument"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Orbital instrument</p>
          <h2>Orbital trajectory</h2>
        </div>
        <div className="instrument-actions">
          <button
            type="button"
            onClick={() => setResetKey((key) => key + 1)}
            aria-label="Reset orbital view"
          >
            <RotateCcw size={14} aria-hidden="true" /> Reset
          </button>
        </div>
      </div>
      <div className="orbital-stage">
        <OrbitalErrorBoundary
          key={resetKey}
          fallback={<OrbitalFallback telemetry={telemetry} />}
        >
          <Canvas
            key={resetKey}
            camera={{ position: [0, 3.8, 8.8], fov: 50 }}
            dpr={[1, 1.75]}
          >
            <Scene
              telemetry={telemetry}
              selectedSubsystem={selectedSubsystem}
              onSelectSubsystem={onSelectSubsystem}
              trail={trail}
            />
          </Canvas>
        </OrbitalErrorBoundary>
      </div>
      <div className="orbital-readout" aria-label="Latest navigation readout">
        <span>Visualization normalizes telemetry coordinates for display</span>
        <strong>
          {telemetry === null
            ? "Awaiting navigation frame"
            : `T+ ${telemetry.simulation_time.toFixed(0)} s`}
        </strong>
      </div>
    </section>
  );
}
