// User roles
export enum UserRole {
  ADMIN = 'admin',
  MISSION_COMMANDER = 'mission_commander',
  FLIGHT_CONTROLLER = 'flight_controller',
  ENGINEER = 'engineer',
  VIEWER = 'viewer',
}

// Spacecraft subsystems
export enum Subsystem {
  PROPULSION = 'propulsion',
  POWER = 'power',
  THERMAL = 'thermal',
  COMMUNICATIONS = 'communications',
  FLIGHT_COMPUTER = 'flight_computer',
  NAVIGATION = 'navigation',
}

// Alert severity levels
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// Alert status
export enum AlertStatus {
  ACTIVE = 'active',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

// Incident status
export enum IncidentStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

// Command status
export enum CommandStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// Simulation scenarios
export enum SimulationScenario {
  NORMAL = 'normal',
  PROPULSION_LEAK = 'propulsion_leak',
  COOLING_FAILURE = 'cooling_failure',
  BATTERY_DEGRADATION = 'battery_degradation',
  COMMUNICATION_FAILURE = 'communication_failure',
  SENSOR_FAILURE = 'sensor_failure',
  FLIGHT_COMPUTER_FAILURE = 'flight_computer_failure',
  CASCADING_FAILURE = 'cascading_failure',
}

// Spacecraft telemetry interface
export interface TelemetryPoint {
  timestamp: Date;
  spacecraftId: string;
  fuelLevel: number;
  fuelPressure: number;
  fuelFlow: number;
  thrust: number;
  engineTemperature: number;
  batteryLevel: number;
  batteryVoltage: number;
  currentDraw: number;
  solarGeneration: number;
  powerConsumption: number;
  cpuTemperature: number;
  cabinTemperature: number;
  radiatorTemperature: number;
  signalStrength: number;
  packetLoss: number;
  latency: number;
  bandwidth: number;
  cpuUsage: number;
  memoryUsage: number;
  storageUsed: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  orientationRoll: number;
  orientationPitch: number;
  orientationYaw: number;
}

// User interface
export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Mission interface
export interface Mission {
  id: string;
  name: string;
  description: string;
  startDate: Date;
  endDate: Date;
  status: string;
  createdAt: Date;
}

// Spacecraft interface
export interface Spacecraft {
  id: string;
  name: string;
  missionId: string;
  status: string;
  launchDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Alert interface
export interface Alert {
  id: string;
  spacecraftId: string;
  subsystem: Subsystem;
  severity: AlertSeverity;
  metric: string;
  value: number;
  expectedRange: string;
  anomalyScore: number;
  status: AlertStatus;
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

// Incident interface
export interface Incident {
  id: string;
  spacecraftId: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  status: IncidentStatus;
  rootCause?: string;
  affectedSubsystems: Subsystem[];
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

// Command interface
export interface Command {
  id: string;
  spacecraftId: string;
  commandType: string;
  parameters: Record<string, unknown>;
  status: CommandStatus;
  requestedBy: string;
  approvedBy?: string;
  secondApprover?: string;
  executedAt?: Date;
  result?: Record<string, unknown>;
  createdAt: Date;
}

// AI Investigation interface
export interface AIInvestigation {
  id: string;
  incidentId: string;
  summary: string;
  rootCause: string;
  confidence: number;
  severity: AlertSeverity;
  affectedSubsystems: Subsystem[];
  evidence: Evidence[];
  alternativeCauses: string[];
  recommendedActions: RecommendedAction[];
  status: 'in_progress' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
}

export interface Evidence {
  type: 'telemetry' | 'alert' | 'historical' | 'documentation';
  description: string;
  data: unknown;
}

export interface RecommendedAction {
  action: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

// WebSocket event types
export type WSEventType =
  | 'telemetry:update'
  | 'alert:created'
  | 'alert:updated'
  | 'incident:created'
  | 'incident:updated'
  | 'ai:investigation_started'
  | 'ai:investigation_updated'
  | 'command:created'
  | 'command:executed'
  | 'simulation:status';

export interface WSEvent<T = unknown> {
  type: WSEventType;
  payload: T;
  timestamp: string;
  spacecraftId?: string;
}

// Simulation state
export interface SimulationState {
  spacecraftId: string;
  scenario: SimulationScenario;
  speed: number;
  isRunning: boolean;
  simulationTime: number;
}

// Request with user
export interface AuthenticatedRequest {
  user?: User;
}
