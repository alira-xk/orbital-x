import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import {
  attachTelemetryWebSocketServer,
  WebSocketTelemetryBroadcaster,
} from './broadcaster.js';
import type { TelemetryFrame } from './schema.js';
import { logger } from '../utils/logger.js';

class RecordingClient {
  readonly frames: string[] = [];
  readonly readyState: number = 1;
  terminated = false;

  send(frame: string): void {
    this.frames.push(frame);
  }

  terminate(): void {
    this.terminated = true;
  }
}

class BrokenClient extends RecordingClient {
  override send(_frame: string): void {
    throw new Error('socket closed during send');
  }
}

class UnterminableClient extends BrokenClient {
  override terminate(): void {
    throw new Error('socket termination failed');
  }
}

class CallbackFailureClient extends RecordingClient {
  override send(_frame: string, callback?: (error?: Error) => void): void {
    callback?.(new Error('socket write failed'));
  }
}

class CallbackSuccessClient extends RecordingClient {
  override send(frame: string, callback?: (error?: Error) => void): void {
    super.send(frame);
    callback?.(null as unknown as Error);
  }
}

class StaleClient extends RecordingClient {
  override readonly readyState = 0;
}

class RecordingWebSocketServer {
  readonly clients = new Set<RecordingClient>();
  closed = false;

  close(callback: (error?: Error) => void): void {
    this.closed = true;
    callback();
  }
}

const frame: TelemetryFrame & { fuel_pressure: number } = {
  timestamp: '2026-09-10T12:00:00.000Z',
  spacecraft_id: 'ORBITAL-X1',
  simulation_time: 1,
  scenario: 'NORMAL',
  fuel_pressure: 2.45,
};

describe('WebSocketTelemetryBroadcaster', () => {
  beforeAll(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('sends a telemetry:update envelope containing the original frame', async () => {
    const server = new RecordingWebSocketServer();
    const client = new RecordingClient();
    server.clients.add(client);
    const broadcaster = new WebSocketTelemetryBroadcaster(
      server,
      () => new Date('2026-09-10T12:00:01.000Z'),
    );

    await broadcaster.broadcast(frame);

    expect(client.frames).toHaveLength(1);
    expect(JSON.parse(client.frames[0])).toEqual({
      type: 'telemetry:update',
      payload: frame,
      timestamp: '2026-09-10T12:00:01.000Z',
      spacecraftId: 'ORBITAL-X1',
    });
  });

  it('rejects an invalid telemetry envelope before sending it', async () => {
    const server = new RecordingWebSocketServer();
    const client = new RecordingClient();
    server.clients.add(client);
    const broadcaster = new WebSocketTelemetryBroadcaster(server);
    const invalidFrame = { ...frame, fuel_pressure: Number.POSITIVE_INFINITY };

    await expect(broadcaster.broadcast(invalidFrame))
      .rejects.toThrow();

    expect(client.frames).toEqual([]);
  });

  it('isolates a broken client so the next healthy client receives the frame', async () => {
    const server = new RecordingWebSocketServer();
    const brokenClient = new BrokenClient();
    const healthyClient = new RecordingClient();
    server.clients.add(brokenClient);
    server.clients.add(healthyClient);
    const broadcaster = new WebSocketTelemetryBroadcaster(server);

    await expect(broadcaster.broadcast(frame)).resolves.toBeUndefined();

    expect(brokenClient.terminated).toBe(true);
    expect(healthyClient.frames).toHaveLength(1);
  });

  it('continues delivery even when failed-client termination also throws', async () => {
    const server = new RecordingWebSocketServer();
    const brokenClient = new UnterminableClient();
    const healthyClient = new RecordingClient();
    server.clients.add(brokenClient);
    server.clients.add(healthyClient);
    const broadcaster = new WebSocketTelemetryBroadcaster(server);

    await expect(broadcaster.broadcast(frame)).resolves.toBeUndefined();

    expect(healthyClient.frames).toHaveLength(1);
  });

  it('removes a client whose send callback reports failure', async () => {
    const server = new RecordingWebSocketServer();
    const failedClient = new CallbackFailureClient();
    server.clients.add(failedClient);
    const broadcaster = new WebSocketTelemetryBroadcaster(server);

    await broadcaster.broadcast(frame);

    expect(failedClient.terminated).toBe(true);
  });

  it('keeps a client when its send callback reports null success', async () => {
    const server = new RecordingWebSocketServer();
    const healthyClient = new CallbackSuccessClient();
    server.clients.add(healthyClient);
    const broadcaster = new WebSocketTelemetryBroadcaster(server);

    await broadcaster.broadcast(frame);

    expect(healthyClient.frames).toHaveLength(1);
    expect(healthyClient.terminated).toBe(false);
  });

  it('terminates a stale client without attempting to send', async () => {
    const server = new RecordingWebSocketServer();
    const staleClient = new StaleClient();
    server.clients.add(staleClient);
    const broadcaster = new WebSocketTelemetryBroadcaster(server);

    await broadcaster.broadcast(frame);

    expect(staleClient.frames).toEqual([]);
    expect(staleClient.terminated).toBe(true);
  });

  it('owns shutdown of every client and its WebSocket server', async () => {
    const server = new RecordingWebSocketServer();
    const firstClient = new RecordingClient();
    const secondClient = new RecordingClient();
    server.clients.add(firstClient);
    server.clients.add(secondClient);
    const broadcaster = new WebSocketTelemetryBroadcaster(server);

    await broadcaster.close();

    expect(firstClient.terminated).toBe(true);
    expect(secondClient.terminated).toBe(true);
    expect(server.closed).toBe(true);
  });

  it('continues shutdown when one client cannot be terminated', async () => {
    const server = new RecordingWebSocketServer();
    const brokenClient = new UnterminableClient();
    const healthyClient = new RecordingClient();
    server.clients.add(brokenClient);
    server.clients.add(healthyClient);
    const broadcaster = new WebSocketTelemetryBroadcaster(server);

    await expect(broadcaster.close()).resolves.toBeUndefined();

    expect(healthyClient.terminated).toBe(true);
    expect(server.closed).toBe(true);
  });

  it('attaches the /ws endpoint to the existing HTTP server', async () => {
    const httpServer = createServer();
    const broadcaster = attachTelemetryWebSocketServer(httpServer, '/ws');
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP address');
    }
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);

    try {
      await once(client, 'open');
      const message = once(client, 'message');

      await broadcaster.broadcast(frame);

      const [data] = await message;
      expect(JSON.parse(data.toString()).type).toBe('telemetry:update');
    } finally {
      client.terminate();
      await broadcaster.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });
});
