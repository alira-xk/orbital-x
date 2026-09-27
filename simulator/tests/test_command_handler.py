from src.command_handler import CommandHandler
from src.simulator import Simulator

def envelope(kind, params=None, command_id="cmd-1"):
    return {"schemaVersion":1,"commandId":command_id,"spacecraftId":"ORBITAL-X1","type":kind,"parameters":params or {}}

def test_rejects_unknown_payload_without_mutation(tmp_path):
    sim=Simulator(output_path=str(tmp_path/"t.jsonl"),real_sleep=False)
    result=CommandHandler().apply(envelope("DELETE_SPACECRAFT"),sim.state,sim.scenario)
    assert not result["success"] and not sim.state.recovery.isolation_valve_closed

def test_commands_are_idempotent_and_bounded(tmp_path):
    sim=Simulator(output_path=str(tmp_path/"t.jsonl"),real_sleep=False)
    handler=CommandHandler()
    first=handler.apply(envelope("REDUCE_THRUST",{"thrustPercent":55}),sim.state,sim.scenario)
    second=handler.apply(envelope("REDUCE_THRUST",{"thrustPercent":55}),sim.state,sim.scenario)
    assert first["success"] and second["message"]=="Command already applied"
    assert sim.state.recovery.thrust_ceiling==55
    assert not handler.apply(envelope("REDUCE_THRUST",{"thrustPercent":99},"cmd-2"),sim.state,sim.scenario)["success"]

def test_isolation_valve_stabilizes_a_real_leak(tmp_path):
    sim=Simulator(output_path=str(tmp_path/"t.jsonl"),scenario="PROPULSION_LEAK",real_sleep=False,seed=7)
    sim.run(30); before=sim.state.propulsion.fuel_pressure
    result=CommandHandler().apply(envelope("CLOSE_ISOLATION_VALVE"),sim.state,sim.scenario)
    sim.run(1); first_after=sim.state.propulsion.fuel_pressure
    sim.run(19); after=sim.state.propulsion.fuel_pressure
    assert result["success"] and sim.state.recovery.isolation_valve_closed
    assert first_after <= before+0.05
    assert after >= before-0.05
