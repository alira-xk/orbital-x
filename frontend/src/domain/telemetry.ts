export type SubsystemId =
  | 'propulsion'
  | 'power'
  | 'thermal'
  | 'communications'
  | 'flight_computer'
  | 'navigation';

export interface SubsystemDefinition {
  id: SubsystemId;
  label: string;
  shortLabel: string;
  color: string;
}

export interface MetricDefinition {
  key: string;
  label: string;
  unit: string;
  precision: number;
  subsystem: SubsystemId;
  color: string;
}

export interface TelemetryFrame {
  timestamp: string;
  spacecraft_id: string;
  simulation_time: number;
  scenario: string;
  [field: string]: string | number;
}

export interface HistoryPoint {
  timestamp: string;
  value: number;
  min?: number;
  max?: number;
}

export type TimeRangeId = '1m' | '5m' | '15m' | '1h' | '6h' | '24h';

export interface TimeRangeDefinition {
  id: TimeRangeId;
  label: string;
  durationMs: number;
  bucketSeconds?: 2 | 5 | 15 | 60 | 300;
  maxPoints: number;
}

export const SUBSYSTEMS: readonly SubsystemDefinition[] = [
  { id: 'propulsion', label: 'Propulsion', shortLabel: 'PROP', color: '#F97316' },
  { id: 'power', label: 'Power', shortLabel: 'PWR', color: '#F59E0B' },
  { id: 'thermal', label: 'Thermal', shortLabel: 'THRM', color: '#EF4444' },
  { id: 'communications', label: 'Communications', shortLabel: 'COMMS', color: '#22D3EE' },
  { id: 'flight_computer', label: 'Flight computer', shortLabel: 'FC', color: '#A78BFA' },
  { id: 'navigation', label: 'Navigation', shortLabel: 'NAV', color: '#38BDF8' },
];

const metric = (
  key: string,
  label: string,
  unit: string,
  precision: number,
  subsystem: SubsystemId,
): MetricDefinition => ({
  key,
  label,
  unit,
  precision,
  subsystem,
  color: SUBSYSTEMS.find(({ id }) => id === subsystem)?.color ?? '#E4E7EE',
});

export const METRICS: readonly MetricDefinition[] = [
  metric('fuel_level', 'Fuel level', '%', 1, 'propulsion'),
  metric('fuel_pressure', 'Fuel pressure', 'MPa', 2, 'propulsion'),
  metric('fuel_flow', 'Fuel flow', 'kg/s', 2, 'propulsion'),
  metric('thrust', 'Thrust', 'N', 0, 'propulsion'),
  metric('engine_temperature', 'Engine temperature', '°C', 1, 'propulsion'),
  metric('battery_level', 'Battery level', '%', 1, 'power'),
  metric('battery_voltage', 'Battery voltage', 'V', 2, 'power'),
  metric('current_draw', 'Current draw', 'A', 1, 'power'),
  metric('solar_generation', 'Solar generation', 'W', 0, 'power'),
  metric('power_consumption', 'Power consumption', 'W', 0, 'power'),
  metric('cpu_temperature', 'CPU temperature', '°C', 1, 'thermal'),
  metric('cabin_temperature', 'Cabin temperature', '°C', 1, 'thermal'),
  metric('radiator_temperature', 'Radiator temperature', '°C', 1, 'thermal'),
  metric('radiator_efficiency', 'Radiator efficiency', '%', 1, 'thermal'),
  metric('signal_strength', 'Signal strength', 'dBm', 1, 'communications'),
  metric('packet_loss', 'Packet loss', '%', 2, 'communications'),
  metric('latency', 'Latency', 'ms', 0, 'communications'),
  metric('bandwidth', 'Bandwidth', 'Mbps', 1, 'communications'),
  metric('cpu_usage', 'CPU usage', '%', 1, 'flight_computer'),
  metric('memory_usage', 'Memory usage', '%', 1, 'flight_computer'),
  metric('storage_used', 'Storage used', '%', 1, 'flight_computer'),
  metric('process_health', 'Process health', '%', 1, 'flight_computer'),
  metric('position_x', 'Position X', 'km', 2, 'navigation'),
  metric('position_y', 'Position Y', 'km', 2, 'navigation'),
  metric('position_z', 'Position Z', 'km', 2, 'navigation'),
  metric('velocity_x', 'Velocity X', 'km/s', 3, 'navigation'),
  metric('velocity_y', 'Velocity Y', 'km/s', 3, 'navigation'),
  metric('velocity_z', 'Velocity Z', 'km/s', 3, 'navigation'),
  metric('orientation_roll', 'Roll', '°', 1, 'navigation'),
  metric('orientation_pitch', 'Pitch', '°', 1, 'navigation'),
  metric('orientation_yaw', 'Yaw', '°', 1, 'navigation'),
];

export const TIME_RANGES: readonly TimeRangeDefinition[] = [
  { id: '1m', label: '1 min', durationMs: 60_000, maxPoints: 60 },
  { id: '5m', label: '5 min', durationMs: 300_000, bucketSeconds: 2, maxPoints: 150 },
  { id: '15m', label: '15 min', durationMs: 900_000, bucketSeconds: 5, maxPoints: 180 },
  { id: '1h', label: '1 hour', durationMs: 3_600_000, bucketSeconds: 15, maxPoints: 240 },
  { id: '6h', label: '6 hours', durationMs: 21_600_000, bucketSeconds: 60, maxPoints: 360 },
  { id: '24h', label: '24 hours', durationMs: 86_400_000, bucketSeconds: 300, maxPoints: 288 },
];

export function metricsForSubsystem(subsystem: SubsystemId): readonly MetricDefinition[] {
  return METRICS.filter((definition) => definition.subsystem === subsystem);
}

export function timeRangeById(id: TimeRangeId): TimeRangeDefinition {
  const range = TIME_RANGES.find((candidate) => candidate.id === id);
  if (range === undefined) {
    throw new Error(`Unsupported telemetry range: ${id}`);
  }
  return range;
}
