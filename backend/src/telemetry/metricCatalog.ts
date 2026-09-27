export type TelemetrySubsystem =
  | 'propulsion'
  | 'power'
  | 'thermal'
  | 'communications'
  | 'flight_computer'
  | 'navigation'
  | 'unknown';

export const telemetryMetadataFields = new Set([
  'timestamp',
  'spacecraft_id',
  'simulation_time',
  'scenario',
]);

const metricSubsystems: Readonly<Record<string, Exclude<TelemetrySubsystem, 'unknown'>>> = {
  fuel_level: 'propulsion',
  fuel_pressure: 'propulsion',
  fuel_flow: 'propulsion',
  thrust: 'propulsion',
  engine_temperature: 'propulsion',
  battery_level: 'power',
  battery_voltage: 'power',
  current_draw: 'power',
  solar_generation: 'power',
  power_consumption: 'power',
  cpu_temperature: 'thermal',
  cabin_temperature: 'thermal',
  radiator_temperature: 'thermal',
  radiator_efficiency: 'thermal',
  signal_strength: 'communications',
  packet_loss: 'communications',
  latency: 'communications',
  bandwidth: 'communications',
  cpu_usage: 'flight_computer',
  memory_usage: 'flight_computer',
  storage_used: 'flight_computer',
  process_health: 'flight_computer',
  position_x: 'navigation',
  position_y: 'navigation',
  position_z: 'navigation',
  velocity_x: 'navigation',
  velocity_y: 'navigation',
  velocity_z: 'navigation',
  orientation_roll: 'navigation',
  orientation_pitch: 'navigation',
  orientation_yaw: 'navigation',
};

export function subsystemForMetric(metric: string): TelemetrySubsystem {
  return metricSubsystems[metric] ?? 'unknown';
}
