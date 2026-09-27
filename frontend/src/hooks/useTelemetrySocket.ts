import { useEffect, useState } from 'react';
import type { TelemetryFrame } from '../domain/telemetry';

export type { TelemetryFrame } from '../domain/telemetry';

export type TelemetryConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface TelemetryUpdateEvent {
  type: 'telemetry:update';
  payload: TelemetryFrame;
}

const DEFAULT_SOCKET_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws';
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

function isTelemetryUpdateEvent(value: unknown): value is TelemetryUpdateEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;
  const payload = event.payload;
  if (event.type !== 'telemetry:update' || typeof payload !== 'object' || payload === null) {
    return false;
  }

  const frame = payload as Record<string, unknown>;
  return typeof frame.timestamp === 'string'
    && typeof frame.spacecraft_id === 'string'
    && typeof frame.simulation_time === 'number'
    && Number.isFinite(frame.simulation_time)
    && typeof frame.scenario === 'string';
}

export function useTelemetrySocket(socketUrl = DEFAULT_SOCKET_URL): {
  telemetry: TelemetryFrame | null;
  connectionStatus: TelemetryConnectionStatus;
} {
  const [telemetry, setTelemetry] = useState<TelemetryFrame | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<TelemetryConnectionStatus>('connecting');

  useEffect(() => {
    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | undefined;
    let socket: WebSocket | undefined;

    const connect = () => {
      setConnectionStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
      const currentSocket = new WebSocket(socketUrl);
      socket = currentSocket;

      currentSocket.onopen = () => {
        reconnectAttempt = 0;
        setConnectionStatus('connected');
      };

      currentSocket.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data) as unknown;
          if (isTelemetryUpdateEvent(event)) {
            setTelemetry(event.payload);
          }
        } catch {
          // Ignore malformed messages and retain the last valid telemetry frame.
        }
      };

      currentSocket.onerror = () => {
        currentSocket.close();
      };

      currentSocket.onclose = () => {
        if (disposed) {
          return;
        }
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
          MAX_RECONNECT_DELAY_MS,
        );
        reconnectAttempt += 1;
        setConnectionStatus('reconnecting');
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
      setConnectionStatus('disconnected');
    };
  }, [socketUrl]);

  return { telemetry, connectionStatus };
}
