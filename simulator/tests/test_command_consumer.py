import json
from src.command_consumer import CommandConsumer
from src.command_handler import CommandHandler
from src.simulator import Simulator

class Redis:
    def __init__(self,payload): self.payload=payload; self.added=[]; self.acked=[]
    def xgroup_create(self,*args,**kwargs): pass
    def xreadgroup(self,*args,**kwargs): return [("commands:stream",[("1-0",{"command:request":json.dumps(self.payload)})])]
    def xadd(self,stream,fields): self.added.append((stream,fields))
    def xack(self,stream,group,message): self.acked.append((stream,group,message))

def test_publishes_result_before_acknowledging(tmp_path):
    payload={"schemaVersion":1,"commandId":"c1","spacecraftId":"ORBITAL-X1","type":"ENTER_SAFE_MODE","parameters":{}}
    redis=Redis(payload); sim=Simulator(output_path=str(tmp_path/"t.jsonl"),real_sleep=False)
    consumer=CommandConsumer(redis,CommandHandler())
    assert consumer.poll(sim.state,sim.scenario)==1
    assert redis.added[0][0]=="command-results:stream" and redis.acked==[("commands:stream","simulator-commands","1-0")]
