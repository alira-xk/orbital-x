// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTelemetrySocket } from './useTelemetrySocket';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close(): void {}

  emit(data: string): void {
    this.onmessage?.({ data });
  }
}

afterEach(() => {
  MockWebSocket.instances = [];
  vi.unstubAllGlobals();
});

describe('useTelemetrySocket', () => {
  it('stores the current frame from a telemetry:update event', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);

    const { result } = renderHook(() => useTelemetrySocket('ws://telemetry.test/ws'));

    act(() => {
      MockWebSocket.instances[0].emit(JSON.stringify({
        type: 'telemetry:update',
        payload: {
          timestamp: '2026-09-10T12:00:00.000Z',
          spacecraft_id: 'ORBITAL-X1',
          simulation_time: 1,
          scenario: 'NORMAL',
          fuel_pressure: 2.45,
        },
      }));
    });

    expect(result.current.telemetry?.fuel_pressure).toBe(2.45);
  });
});
