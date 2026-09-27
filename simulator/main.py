"""
ORBITAL-X1 Simulator — CLI entry point

Runs the spacecraft simulator, writes JSONL telemetry to a file, and
prints a brief status line every few ticks.

Usage
-----
    python main.py                          # run forever, 1x speed
    python main.py --ticks 60               # run for 60 ticks
    python main.py --speed 10               # 10x speed
    python main.py --output telemetry.jsonl # custom output path
    python main.py --seed 42                # deterministic run
"""
from __future__ import annotations

import argparse
import signal
import sys
import time

from src.simulator import Simulator
from src.clock import ALLOWED_SPEEDS
from src.scenarios import SCENARIOS
from src.telemetry_publisher import create_telemetry_publisher_from_env
from src.command_consumer import create_command_consumer_from_env


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="ORBITAL-X1 Spacecraft Simulator")
    p.add_argument("--ticks", type=int, default=None,
                   help="Number of ticks to run (default: forever)")
    p.add_argument("--speed", type=int, default=1, choices=sorted(ALLOWED_SPEEDS),
                   help="Simulation speed multiplier (1/10/100/1000)")
    p.add_argument("--scenario", type=str.upper, default="NORMAL", choices=sorted(SCENARIOS),
                   help="Failure scenario to simulate (default: NORMAL)")
    p.add_argument("--output", type=str, default="telemetry.jsonl",
                   help="Output JSONL file path")
    p.add_argument("--spacecraft-id", type=str, default="ORBITAL-X1",
                   help="Spacecraft identifier stamped on each frame")
    p.add_argument("--seed", type=int, default=None,
                   help="Seed the noise RNG for a deterministic run")
    p.add_argument("--real-dt", type=float, default=1.0,
                   help="Real-world seconds between ticks (default: 1.0)")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    sim = Simulator(
        spacecraft_id=args.spacecraft_id,
        output_path=args.output,
        speed=args.speed,
        scenario=args.scenario,
        seed=args.seed,
        telemetry_publisher=create_telemetry_publisher_from_env(),
        command_consumer=create_command_consumer_from_env(),
    )

    # Graceful shutdown on Ctrl-C
    stop = {"flag": False}

    def _on_sigint(sig, frame):
        stop["flag"] = True

    signal.signal(signal.SIGINT, _on_sigint)

    print("=" * 60)
    print(" ORBITAL-X1 Spacecraft Simulator")
    print("=" * 60)
    print(f"  Spacecraft:   {sim.state.spacecraft_id}")
    print(f"  Speed:        {args.speed}x")
    print(f"  Scenario:     {args.scenario}")
    print(f"  Output:       {args.output}")
    print(f"  Seed:         {args.seed}")
    print(f"  Ticks:        {args.ticks if args.ticks else 'infinite'}")
    print("=" * 60)

    ticks_run = 0
    status_every = max(1, 10 // args.speed)  # print status line regularly

    try:
        while True:
            if stop["flag"]:
                print("\n[interrupted]")
                break
            if args.ticks is not None and ticks_run >= args.ticks:
                break

            sim.run(ticks=1, real_dt=args.real_dt)
            ticks_run += 1

            if ticks_run % status_every == 0:
                f = sim.current_telemetry()
                print(
                    f"T+{f['simulation_time']:>8.1f}s | "
                    f"Fuel: {f['fuel_pressure']:.2f}MPa | "
                    f"Temp: {f['engine_temperature']:.1f}°C | "
                    f"Battery: {f['battery_level']:.1f}% | "
                    f"Signal: {f['signal_strength']:.0f}dBm"
                )
    except KeyboardInterrupt:
        print("\n[interrupted]")

    print(f"\nWrote {ticks_run} telemetry frames to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
