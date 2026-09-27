# ORBITAL-X1 Power System

## Overview

The power system combines solar arrays with Li-ion battery storage for continuous operation.

## Telemetry Reference

### Battery Level (BATLEVEL)
- **Unit**: Percent (%)
- **Normal Range**: 40-100%
- **Low Warning**: < 30%
- **Critical**: < 15% (enter safe mode)

### Battery Voltage (BATTVOLT)
- **Unit**: Volts (V)
- **Normal Range**: 26.0-29.0V
- **Discharged**: < 24.0V
- **Overcharged**: > 30.0V

### Current Draw (CURRENT)
- **Unit**: Amperes (A)
- **Normal Range**: 3.0-7.0A
- **High Draw**: > 10.0A (investigate)

### Solar Generation (SOLAR)
- **Unit**: Amperes (A)
- **Peak (Sun直视)**: 8.0-9.5A
- **Eclipse**: 0.0A
- **Degraded Panel**: < 6.0A

### Power Consumption (POWERCON)
- **Unit**: Kilowatts (kW)
- **Normal Range**: 5.0-6.0 kW
- **Peak Load**: 7.0 kW
- **Safe Mode**: < 2.0 kW

## Failure Modes

### POW-101: Battery Degradation
**Symptoms**:
- Reduced capacity
- Faster discharge rate
- Voltage sag under load

**Possible Causes**:
- Age-related degradation
- Thermal damage
- Deep discharge events

**Recovery**:
1. Reduce peak loads
2. Optimize power schedules
3. Plan for reduced capacity

### POW-201: Solar Array Failure
**Symptoms**:
- Reduced generation
- Panel temperature anomalies
- Output fluctuations

**Recovery**:
1. Switch to backup arrays
2. Reduce power consumption
3. Plan survival mode

### POW-301: Power Bus Fault
**Symptoms**:
- Voltage fluctuations
- Random system resets
- Inconsistent telemetry

**Recovery**:
1. Isolate affected bus section
2. Switch to backup power distribution
3. System-wide diagnostic

## Safe Mode Procedures

When battery drops below 15%:
1. Disable non-essential systems
2. Orient solar panels for maximum exposure
3. Minimize communication
4. Preserve critical systems only
