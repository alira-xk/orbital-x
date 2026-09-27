import { z } from 'zod';
import { telemetryMetadataFields } from './metricCatalog.js';

const finiteNumber = z.number().finite();

export const TelemetryPayloadSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  spacecraft_id: z.string().trim().min(1),
  simulation_time: finiteNumber,
  scenario: z.string().trim().min(1),
}).catchall(finiteNumber);

export const TelemetryFrameSchema = z.object({
  schema_version: z.literal(1),
  event_type: z.literal('telemetry.frame'),
  payload: TelemetryPayloadSchema,
});

export interface TelemetryFrame {
  timestamp: string;
  spacecraft_id: string;
  simulation_time: number;
  scenario: string;
}

export type TelemetryMetricMap = Readonly<Record<string, number>>;
export type TelemetryEnvelope = z.infer<typeof TelemetryFrameSchema>;

export function toTelemetryFrame(payload: z.output<typeof TelemetryPayloadSchema>): TelemetryFrame {
  return payload as unknown as TelemetryFrame;
}

export function telemetryMetricValues(frame: TelemetryFrame): TelemetryMetricMap {
  const metrics: Record<string, number> = {};
  for (const [name, value] of Object.entries(frame as unknown as Record<string, unknown>)) {
    if (!telemetryMetadataFields.has(name) && typeof value === 'number' && Number.isFinite(value)) {
      metrics[name] = value;
    }
  }
  return metrics;
}
