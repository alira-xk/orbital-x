// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { METRICS } from '../domain/telemetry';
import type { TelemetryHistoryState } from '../hooks/useTelemetryHistory';
import { TelemetryWorkspace } from './TelemetryWorkspace';

const retry = vi.fn().mockResolvedValue(undefined);
let historyState: TelemetryHistoryState;

vi.mock('../hooks/useTelemetryHistory', () => ({
  useTelemetryHistory: () => historyState,
}));

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const metric = METRICS.find(({ key }) => key === 'fuel_pressure')!;

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

afterAll(() => vi.unstubAllGlobals());

function state(overrides: Partial<TelemetryHistoryState> = {}): TelemetryHistoryState {
  return {
    series: [{ metric, points: [{ timestamp: '2026-09-10T12:00:00.000Z', value: 2.45 }] }],
    isLoading: false,
    isFetching: false,
    hasError: false,
    isStale: false,
    retry,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  retry.mockClear();
});

describe('TelemetryWorkspace', () => {
  it('offers all bounded ranges as native single-selection controls', () => {
    historyState = state();
    render(<TelemetryWorkspace
      spacecraftId="ORBITAL-X1"
      selectedSubsystem="propulsion"
      telemetry={null}
      connectionStatus="connected"
    />);

    const ranges = screen.getByRole('group', { name: 'Telemetry time range' });
    expect(ranges.querySelectorAll('button')).toHaveLength(6);
    expect(screen.getByRole('button', { name: '15 min' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '1 hour' }));

    expect(screen.getByRole('button', { name: '1 hour' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Selected range: 1 hour')).toBeInTheDocument();
  });

  it('reserves chart geometry while initial history is loading', () => {
    historyState = state({ isLoading: true, series: [] });
    render(<TelemetryWorkspace
      spacecraftId="ORBITAL-X1"
      selectedSubsystem="propulsion"
      telemetry={null}
      connectionStatus="connecting"
    />);

    expect(screen.getByRole('status', { name: 'Telemetry history status' })).toHaveTextContent(
      'Loading recorded telemetry',
    );
    expect(screen.getByTestId('chart-loading-grid')).toBeInTheDocument();
  });

  it('distinguishes empty, failed, stale, and disconnected states', () => {
    historyState = state({ series: [{ metric, points: [] }], hasError: true });
    const { rerender } = render(<TelemetryWorkspace
      spacecraftId="ORBITAL-X1"
      selectedSubsystem="propulsion"
      telemetry={null}
      connectionStatus="connected"
    />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load recorded telemetry');
    fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
    expect(retry).toHaveBeenCalledTimes(1);

    historyState = state({ hasError: true, isStale: true });
    rerender(<TelemetryWorkspace
      spacecraftId="ORBITAL-X1"
      selectedSubsystem="propulsion"
      telemetry={null}
      connectionStatus="connected"
    />);
    expect(screen.getByRole('status', { name: 'Telemetry history status' })).toHaveTextContent(
      'Showing retained telemetry',
    );

    historyState = state();
    rerender(<TelemetryWorkspace
      spacecraftId="ORBITAL-X1"
      selectedSubsystem="propulsion"
      telemetry={null}
      connectionStatus="reconnecting"
    />);
    expect(screen.getByRole('status', { name: 'Live telemetry status' })).toHaveTextContent(
      'Live telemetry reconnecting',
    );
  });
});
