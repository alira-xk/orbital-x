// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryFrame } from '../domain/telemetry';
import { OrbitalScene } from './OrbitalScene';

let canvasShouldThrow = false;

vi.mock('@react-three/fiber', () => ({
  Canvas: () => {
    if (canvasShouldThrow) throw new Error('WebGL unavailable');
    return <div data-testid="orbital-canvas" />;
  },
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Line: () => null,
  OrbitControls: () => null,
  Stars: () => null,
}));

const telemetry: TelemetryFrame = {
  timestamp: '2026-09-10T12:00:00.000Z',
  spacecraft_id: 'ORBITAL-X1',
  simulation_time: 10,
  scenario: 'NORMAL',
  position_x: 6800,
  position_y: 120,
  position_z: -42,
  velocity_x: 0.2,
  velocity_y: 7.6,
  velocity_z: 0.1,
};

afterEach(() => {
  cleanup();
  canvasShouldThrow = false;
  vi.restoreAllMocks();
});

describe('OrbitalScene', () => {
  it('provides a named instrument and a native reset control', () => {
    render(<OrbitalScene
      telemetry={telemetry}
      selectedSubsystem="propulsion"
      onSelectSubsystem={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'ORBITAL-X1 orbital instrument' })).toBeInTheDocument();
    expect(screen.getByTestId('orbital-canvas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset orbital view' }));
    expect(screen.getByTestId('orbital-canvas')).toBeInTheDocument();
  });

  it('keeps navigation data available when WebGL initialization fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    canvasShouldThrow = true;

    render(<OrbitalScene
      telemetry={telemetry}
      selectedSubsystem="navigation"
      onSelectSubsystem={vi.fn()}
    />);

    expect(screen.getByRole('status', { name: 'Orbital view unavailable' })).toHaveTextContent(
      'Position6800.00 / 120.00 / -42.00 km',
    );
    expect(screen.getByRole('status', { name: 'Orbital view unavailable' })).toHaveTextContent(
      'Velocity7.603 km/s',
    );
  });
});
