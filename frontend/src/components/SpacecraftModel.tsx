import { Html } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';
import { MathUtils } from 'three';
import { SUBSYSTEMS, type SubsystemId, type TelemetryFrame } from '../domain/telemetry';

const markerPositions: Record<SubsystemId, [number, number, number]> = {
  propulsion: [-0.62, 0, 0],
  power: [0, -0.38, 0.1],
  thermal: [0.08, 0.38, 0],
  communications: [0.45, 0.24, 0],
  flight_computer: [0.12, 0, 0.34],
  navigation: [0.58, 0, 0],
};

function finiteOrientation(telemetry: TelemetryFrame | null, field: string): number {
  const value = telemetry?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? MathUtils.degToRad(value) : 0;
}

export function SpacecraftModel({
  telemetry,
  position,
  selectedSubsystem,
  onSelectSubsystem,
}: {
  telemetry: TelemetryFrame | null;
  position: [number, number, number];
  selectedSubsystem: SubsystemId;
  onSelectSubsystem(subsystem: SubsystemId): void;
}) {
  const rotation: [number, number, number] = [
    finiteOrientation(telemetry, 'orientation_pitch'),
    finiteOrientation(telemetry, 'orientation_yaw'),
    finiteOrientation(telemetry, 'orientation_roll'),
  ];

  return (
    <group position={position} rotation={rotation} scale={0.32}>
      <mesh>
        <cylinderGeometry args={[0.35, 0.48, 1.15, 8]} />
        <meshStandardMaterial color="#C9D2E3" metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <coneGeometry args={[0.35, 0.42, 8]} />
        <meshStandardMaterial color="#E4E7EE" metalness={0.6} roughness={0.3} />
      </mesh>
      <group rotation={[0, 0, Math.PI / 2]}>
        <mesh position={[0, 0.9, 0]}>
          <boxGeometry args={[0.06, 1.25, 0.44]} />
          <meshStandardMaterial color="#1D4F77" metalness={0.4} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.9, 0]}>
          <boxGeometry args={[0.06, 1.25, 0.44]} />
          <meshStandardMaterial color="#1D4F77" metalness={0.4} roughness={0.35} />
        </mesh>
      </group>
      {SUBSYSTEMS.map((subsystem) => {
        const selected = subsystem.id === selectedSubsystem;
        return (
          <mesh
            key={subsystem.id}
            position={markerPositions[subsystem.id]}
            scale={selected ? 1.45 : 1}
            onClick={(event: ThreeEvent<MouseEvent>) => {
              event.stopPropagation();
              onSelectSubsystem(subsystem.id);
            }}
          >
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshStandardMaterial
              color={subsystem.color}
              emissive={subsystem.color}
              emissiveIntensity={selected ? 1.4 : 0.45}
            />
            {selected && (
              <Html position={[0, 0.2, 0]} center distanceFactor={7}>
                <span className="scene-marker-label">{subsystem.shortLabel}</span>
              </Html>
            )}
          </mesh>
        );
      })}
    </group>
  );
}
