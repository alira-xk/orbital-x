from __future__ import annotations
from typing import Any

class CommandHandler:
    def __init__(self):
        self._applied:set[str]=set()

    def apply(self,envelope:dict[str,Any],state:Any,scenario:Any)->dict[str,Any]:
        command_id=envelope.get("commandId")
        result={"schemaVersion":1,"commandId":str(command_id or ""),"spacecraftId":state.spacecraft_id,"success":False,"message":"Command rejected","simulationTime":state.simulation_time,"changedFields":[]}
        if envelope.get("schemaVersion")!=1 or not isinstance(command_id,str) or envelope.get("spacecraftId")!=state.spacecraft_id or not isinstance(envelope.get("parameters"),dict):
            return result
        if command_id in self._applied:
            return {**result,"success":True,"message":"Command already applied"}
        kind=envelope.get("type"); params=envelope["parameters"]; changed=[]
        if kind=="CLOSE_ISOLATION_VALVE" and not params and getattr(scenario,"name","")=="PROPULSION_LEAK":
            state.recovery.isolation_valve_closed=True; state.recovery.isolated_fuel_pressure=state.propulsion.fuel_pressure; changed=["recovery.isolation_valve_closed","recovery.isolated_fuel_pressure"]
        elif kind=="REDUCE_THRUST" and set(params)=={"thrustPercent"} and isinstance(params["thrustPercent"],(int,float)) and 20<=params["thrustPercent"]<=90:
            state.recovery.thrust_ceiling=float(params["thrustPercent"]); changed=["recovery.thrust_ceiling"]
        elif kind=="ENTER_SAFE_MODE" and not params:
            state.recovery.safe_mode=True; state.recovery.thrust_ceiling=30.0; changed=["recovery.safe_mode","recovery.thrust_ceiling"]
        elif kind=="RESTART_FLIGHT_COMPUTER" and not params:
            state.recovery.flight_computer_restart_ticks=1; changed=["recovery.flight_computer_restart_ticks"]
        else:
            return result
        self._applied.add(command_id)
        return {**result,"success":True,"message":"Command applied","changedFields":changed}
