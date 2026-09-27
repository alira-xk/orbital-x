// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

vi.mock('../hooks/useTelemetrySocket', () => ({
  useTelemetrySocket: () => ({
    telemetry: {
      timestamp: new Date().toISOString(),
      spacecraft_id: 'ORBITAL-X1',
      simulation_time: 42,
      scenario: 'NORMAL',
      fuel_pressure: 2.45,
      battery_level: 91.2,
      cpu_temperature: 43.1,
      signal_strength: -68.4,
      cpu_usage: 38.2,
      position_x: 6800,
    },
    connectionStatus: 'connected',
  }),
}));

vi.mock('../hooks/useTelemetryHistory', () => ({
  useTelemetryHistory: () => ({
    series: [],
    isLoading: false,
    isFetching: false,
    hasError: false,
    isStale: false,
    retry: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./OrbitalScene', () => ({
  OrbitalScene: () => <section aria-label="ORBITAL-X1 orbital instrument" />,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mission control shell', () => {
  it('synchronizes native subsystem controls with the analytical workspace', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('services offline')));
    render(<App />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('ORBITAL-X1')).toBeInTheDocument();
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /telemetry connection/i })).toHaveTextContent('Connected');

    const selector = screen.getByRole('group', { name: 'Spacecraft subsystems' });
    const subsystemButtons = selector.querySelectorAll('button');
    expect(subsystemButtons).toHaveLength(6);
    expect(screen.getByRole('button', { name: /Propulsion/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Navigation/ }));

    expect(screen.getByRole('button', { name: /Navigation/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Navigation telemetry' })).toBeInTheDocument();

    const missionDeck = screen.getByRole('region', { name: 'Mission data' });
    const diagnostics = screen.getByRole('region', { name: 'System diagnostics' });
    expect(missionDeck.compareDocumentPosition(diagnostics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
