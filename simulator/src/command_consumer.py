from __future__ import annotations
import json,logging,os
from typing import Any
from src.command_handler import CommandHandler
LOGGER=logging.getLogger(__name__)

class CommandConsumer:
    def __init__(self,client:Any,handler:CommandHandler,stream="commands:stream",result_stream="command-results:stream",group="simulator-commands",consumer="ORBITAL-X1"):
        self.client=client;self.handler=handler;self.stream=stream;self.result_stream=result_stream;self.group=group;self.consumer=consumer
        try:self.client.xgroup_create(stream,group,id="0",mkstream=True)
        except Exception as error:
            if "BUSYGROUP" not in str(error):LOGGER.warning("Command group unavailable: %s",error)
    def poll(self,state:Any,scenario:Any)->int:
        try: batches=self.client.xreadgroup(self.group,self.consumer,{self.stream:">"},count=10,block=1)
        except Exception as error: LOGGER.warning("Command read failed: %s",error);return 0
        count=0
        for _,messages in batches:
            for message_id,fields in messages:
                try:
                    payload=json.loads(fields["command:request"])
                    result=self.handler.apply(payload,state,scenario)
                    self.client.xadd(self.result_stream,{"command:result":json.dumps(result,separators=(",",":"))})
                    self.client.xack(self.stream,self.group,message_id);count+=1
                except Exception as error: LOGGER.warning("Command message rejected: %s",error);self.client.xack(self.stream,self.group,message_id)
        return count

def create_command_consumer_from_env()->CommandConsumer|None:
    if os.environ.get("COMMAND_REDIS_ENABLED","true").lower() not in {"1","true","yes","on"}:return None
    try:
        import redis
        client=redis.Redis(host=os.environ.get("REDIS_HOST","localhost"),port=int(os.environ.get("REDIS_PORT","6379")),password=os.environ.get("REDIS_PASSWORD") or None,decode_responses=True)
        return CommandConsumer(
            client,
            CommandHandler(),
            stream=os.environ.get("COMMAND_REDIS_STREAM", "commands:stream"),
            result_stream=os.environ.get("COMMAND_RESULT_REDIS_STREAM", "command-results:stream"),
            group=os.environ.get("COMMAND_REDIS_GROUP", "simulator-commands"),
            consumer=os.environ.get("SPACECRAFT_ID", "ORBITAL-X1"),
        )
    except Exception as error: LOGGER.warning("Redis command consumption unavailable: %s",error);return None
