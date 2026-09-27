import type { TelemetryBroadcaster } from '../workers/telemetry-worker.js';
import type { Server as HttpServer } from 'node:http';
import { z } from 'zod';
import { WebSocket, WebSocketServer } from 'ws';
import { TelemetryPayloadSchema, type TelemetryFrame } from './schema.js';
import { logger } from '../utils/logger.js';

export const TelemetryUpdateEventSchema = z.object({
  type: z.literal('telemetry:update'),
  payload: TelemetryPayloadSchema,
  timestamp: z.string().datetime({ offset: true }),
  spacecraftId: z.string().trim().min(1),
}).strict();

export interface BroadcastClient {
  readonly readyState: number;
  send(frame: string, callback?: (error?: Error | null) => void): void;
  terminate(): void;
}

export interface BroadcastServer {
  readonly clients: ReadonlySet<BroadcastClient>;
  close(callback: (error?: Error) => void): void;
}

export function attachTelemetryWebSocketServer(
  httpServer: HttpServer,
  path = '/ws',
): WebSocketTelemetryBroadcaster {
  return new WebSocketTelemetryBroadcaster(new WebSocketServer({ server: httpServer, path }));
}

export class WebSocketTelemetryBroadcaster implements TelemetryBroadcaster {
  constructor(
    private readonly server: BroadcastServer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async broadcast(frame: TelemetryFrame): Promise<void> {
    const event = TelemetryUpdateEventSchema.parse({
      type: 'telemetry:update',
      payload: frame,
      timestamp: this.clock().toISOString(),
      spacecraftId: frame.spacecraft_id,
    });
    const serializedEvent = JSON.stringify(event);

    for (const client of this.server.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        this.terminateClient(client);
        continue;
      }
      try {
        client.send(serializedEvent, (error) => {
          if (error !== undefined && error !== null) {
            logger.warn({ err: error }, 'Removing failed telemetry WebSocket client');
            this.terminateClient(client);
          }
        });
      } catch (error) {
        logger.warn({ err: error }, 'Removing failed telemetry WebSocket client');
        this.terminateClient(client);
      }
    }
  }

  async close(): Promise<void> {
    for (const client of this.server.clients) {
      this.terminateClient(client);
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private terminateClient(client: BroadcastClient): void {
    try {
      client.terminate();
    } catch (error) {
      logger.warn({ err: error }, 'Failed to terminate telemetry WebSocket client');
    }
  }
}
