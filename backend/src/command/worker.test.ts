import { CommandResultWorker } from '../workers/command-result-worker.js';
const result={schemaVersion:1,commandId:'00000000-0000-4000-8000-000000000020',spacecraftId:'ORBITAL-X1',success:true,message:'Command applied',simulationTime:40,changedFields:['recovery.safe_mode']};
it('durably records a result before acknowledging it',async()=>{
  const order:string[]=[];
  const redis={xgroup:jest.fn(async()=>undefined),xreadgroup:jest.fn(async()=>[['command-results:stream',[['1-0',['command:result',JSON.stringify(result)]]]]]),xack:jest.fn(async()=>{order.push('ack');return 1;})};
  const service={recordResult:jest.fn(async()=>{order.push('store');})};
  const worker=new CommandResultWorker(redis as never,service as never);
  expect(await worker.pollOnce()).toBe(1); expect(order).toEqual(['store','ack']);
});

it('acknowledges malformed JSON without crashing the worker',async()=>{
  const redis={
    xgroup:jest.fn(async()=>undefined),
    xreadgroup:jest.fn(async()=>[['command-results:stream',[['2-0',['command:result','{broken']]]]]),
    xack:jest.fn(async()=>1),
  };
  const service={recordResult:jest.fn()};
  const worker=new CommandResultWorker(redis as never,service as never);
  await expect(worker.pollOnce()).resolves.toBe(0);
  expect(redis.xack).toHaveBeenCalledWith('command-results:stream','backend-command-results','2-0');
  expect(service.recordResult).not.toHaveBeenCalled();
});
