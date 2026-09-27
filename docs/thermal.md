# ORBITAL-X1 Thermal Control System

## Overview

Active thermal control maintains all spacecraft systems within operational temperature ranges using radiators, heaters, and heat pipes.

## Telemetry Reference

### CPU Temperature (CPUTEMP)
- **Unit**: Celsius
- **Normal Range**: 40-65°C
- **Warning**: > 75°C
- **Critical**: > 85°C (throttling begins)

### Cabin Temperature (CABINTEMP)
- **Unit**: Celsius
- **Normal Range**: 18-26°C
- **Limits**: 10-35°C

### Radiator Temperature (RADTEMP)
- **Unit**: Celsius
- **Normal Range**: -25 to -5°C
- **Ineffective**: > 0°C

## Failure Modes

### THERM-101: Cooling System Failure
**Symptoms**:
- Rising CPU temperature
- Radiator temperature increasing
- System throttling

**Recovery**:
1. Reduce computational load
2. Disable non-critical processors
3. Check coolant circulation

### THERM-201: Radiator Degradation
**Symptoms**:
- Inefficient heat dissipation
- Component temperatures rising
- Increased power consumption (fans/pumps)

**Recovery**:
1. Rotate spacecraft orientation
2. Maximize radiator exposure to cold
3. Reduce heat generation

## Temperature Management

| Component | Min | Optimal | Max |
|-----------|-----|---------|-----|
| CPU | 0°C | 45°C | 85°C |
| Battery | 5°C | 20°C | 40°C |
| Fuel Lines | 10°C | 25°C | 45°C |
| Payload | -20°C | 20°C | 50°C |
