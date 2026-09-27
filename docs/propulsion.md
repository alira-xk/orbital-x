# ORBITAL-X1 Propulsion System

## Overview

The propulsion system uses hypergolic propellants (MON-3/MMH) for orbital maneuvers and attitude control.

## Telemetry Reference

### Fuel Level (FULEVEL)
- **Unit**: Percent (%)
- **Normal Range**: 70-100%
- **Warning Threshold**: < 50%
- **Critical Threshold**: < 25%

### Fuel Pressure (FUELPRES)
- **Unit**: MPa
- **Normal Range**: 2.0-2.8 MPa
- **Warning Threshold**: < 1.7 MPa
- **Critical Threshold**: < 1.3 MPa
- **Alarm Threshold**: > 3.2 MPa

### Fuel Flow (FUELFLOW)
- **Unit**: kg/s
- **Normal Range**: 0.4-0.6 kg/s
- **Abnormal**: > 0.8 kg/s (indicates leak)

### Thrust (THRUST)
- **Unit**: Percent (%)
- **Normal Range**: 95-100%
- **Reduced Thrust**: < 90%

### Engine Temperature (ENGTEMP)
- **Unit**: Celsius
- **Normal Range**: 65-85°C
- **Warning**: > 90°C
- **Critical**: > 100°C (throttle back required)

## Failure Modes

### PROP-101: Low Fuel Pressure
**Symptoms**:
- Fuel pressure below 1.7 MPa
- Reduced thrust output
- Possible fuel leak

**Possible Causes**:
- Propellant leak
- Valve malfunction
- Pressure regulator failure
- Tank isolation

**Recovery**:
1. Check valve positions
2. Verify fuel level
3. Reduce thrust to conserve propellant
4. Plan evasive maneuvers

### PROP-201: High Fuel Consumption
**Symptoms**:
- Fuel flow > 0.8 kg/s
- Accelerating fuel depletion
- Pressure fluctuations

**Possible Causes**:
- Valve stuck open
- Regulator failure
- External leak

**Recovery**:
1. Close isolation valves
2. Isolate affected subsystem
3. Document leak rate for mission planning

### PROP-301: Engine Over Temperature
**Symptoms**:
- Temperature > 90°C
- Thrust degradation
- Possible combustion instability

**Possible Causes**:
- Coolant system failure
- Fuel valve malfunction
- Oxidizer imbalance

**Recovery**:
1. Reduce thrust immediately
2. Check cooling system
3. Monitor temperature trends

## Emergency Procedures

### EP-01: Propulsion System Emergency Shutdown
1. Close main fuel valve
2. Close oxidizer valve
3. Disable engine controller
4. Activate backup propulsion if available

### EP-02: Propellant Leak Response
1. Isolate leaking section
2. Calculate remaining propellant
3. Assess mission impact
4. Request ground support

## Maintenance

- Valve exercise: Every 24 hours
- Pressure check: Every orbit
- Full system diagnostic: Weekly
