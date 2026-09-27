// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./hooks/useTelemetrySocket", () => ({
  useTelemetrySocket: () => ({
    telemetry: {
      timestamp: "2026-09-10T12:00:00.000Z",
      spacecraft_id: "ORBITAL-X1",
      simulation_time: 42,
      scenario: "NORMAL",
      fuel_pressure: 2.45,
      battery_level: 91,
      position_x: 6800,
    },
    connectionStatus: "connected",
  }),
}));

vi.mock("./hooks/useTelemetryHistory", () => ({
  useTelemetryHistory: () => ({
    series: [],
    isLoading: false,
    isFetching: false,
    hasError: false,
    isStale: false,
    retry: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("./components/OrbitalScene", () => ({
  OrbitalScene: ({
    onSelectSubsystem,
  }: {
    onSelectSubsystem(subsystem: "power"): void;
  }) => (
    <section aria-label="ORBITAL-X1 orbital instrument">
      <button type="button" onClick={() => onSelectSubsystem("power")}>
        Select power from spacecraft
      </button>
    </section>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mission-control dashboard integration", () => {
  it("shares subsystem selection between the spacecraft and analytical workspace", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("services offline")),
    );
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "Select power from spacecraft" }),
    );

    expect(
      screen.getByRole("heading", { name: "Power telemetry" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Power/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("region", { name: "Incident console" }),
    ).toBeInTheDocument();
  });
});
