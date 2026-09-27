import {parseCommandList} from './commands';
import {expect,it} from 'vitest';
const valid={id:'00000000-0000-4000-8000-000000000020',incidentId:'00000000-0000-4000-8000-000000000010',spacecraftId:'ORBITAL-X1',commandType:'CLOSE_ISOLATION_VALVE',parameters:{},status:'pending_approval',riskLevel:'high',requestedBy:'00000000-0000-4000-8000-000000000001',expiresAt:'2026-09-22T01:05:00.000Z',createdAt:'2026-09-22T01:00:00.000Z',updatedAt:'2026-09-22T01:00:00.000Z',result:null,errorMessage:null};
it('strictly parses bounded command lists',()=>{expect(parseCommandList([valid])).toHaveLength(1);expect(()=>parseCommandList([{...valid,status:'magic'}])).toThrow();expect(()=>parseCommandList(new Array(51).fill(valid))).toThrow();});
it('rejects malformed execution results',()=>{
  expect(()=>parseCommandList([{...valid,result:{success:'false',message:'bad',changedFields:[]}}])).toThrow();
  expect(()=>parseCommandList([{...valid,result:{success:true,message:'ok',changedFields:[1]}}])).toThrow();
});
