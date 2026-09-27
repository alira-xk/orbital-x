// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { METRICS } from '../domain/telemetry';
import { TelemetryChart } from './TelemetryChart';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Line: () => null,
    Tooltip: ({ content }: { content?: (props: unknown) => React.ReactNode }) => {
      if (typeof content !== 'function') {
        return <div data-testid="default-chart-tooltip">min: 2.459999999 value: 2.663333333</div>;
      }

      return content({
        active: true,
        label: '2026-09-10T12:00:00.000Z',
        payload: [
          { dataKey: 'min', value: 2.459999999 },
          { dataKey: 'max', value: 2.719999999 },
          { dataKey: 'value', value: 2.663333333 },
        ],
      });
    },
  };
});

const pressureMetric = METRICS.find(({ key }) => key === 'fuel_pressure')!;

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe('TelemetryChart', () => {
  it('exposes current and envelope summaries without requiring hover', () => {
    render(<TelemetryChart
      metric={pressureMetric}
      points={[
        { timestamp: '2026-09-10T11:55:00.000Z', value: 2.4, min: 2.3, max: 2.5 },
        { timestamp: '2026-09-10T12:00:00.000Z', value: 2.45, min: 2.35, max: 2.55 },
      ]}
    />);

    expect(screen.getByRole('figure', { name: 'Fuel pressure telemetry chart' })).toBeInTheDocument();
    expect(screen.getByText('2.45', { selector: '.chart-current' })).toHaveTextContent('2.45MPa');
    expect(screen.getByText('2.30')).toBeInTheDocument();
    expect(screen.getByText('2.55')).toBeInTheDocument();
  });

  it('keeps the chart footprint and explains an empty series', () => {
    render(<TelemetryChart metric={pressureMetric} points={[]} />);

    expect(screen.getByRole('figure', { name: 'Fuel pressure telemetry chart' })).toHaveTextContent(
      'No recorded telemetry',
    );
  });

  it('shows one compact, precision-formatted hover reading instead of every envelope series', () => {
    render(<TelemetryChart
      metric={pressureMetric}
      points={[{ timestamp: '2026-09-10T12:00:00.000Z', value: 2.663333333, min: 2.459999999, max: 2.719999999 }]}
    />);

    const tooltip = screen.getByTestId('telemetry-tooltip');
    expect(tooltip).toHaveTextContent('12:00:00');
    expect(tooltip).toHaveTextContent('2.66 MPa');
    expect(tooltip).not.toHaveTextContent('min');
    expect(tooltip).not.toHaveTextContent('max');
    expect(screen.queryByTestId('default-chart-tooltip')).not.toBeInTheDocument();
  });
});
