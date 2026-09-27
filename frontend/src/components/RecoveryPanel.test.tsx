// @vitest-environment jsdom
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RecoveryPanel} from './RecoveryPanel';
import {expect,it,vi} from 'vitest';
import {StrictMode} from 'react';
const id='00000000-0000-4000-8000-000000000010';
it('shows role-aware recovery controls and refreshes after request',async()=>{
  const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:[]}))).mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:{id:'00000000-0000-4000-8000-000000000020',incidentId:id,spacecraftId:'ORBITAL-X1',commandType:'CLOSE_ISOLATION_VALVE',parameters:{},status:'pending_approval',riskLevel:'high',requestedBy:'u',expiresAt:'2026-09-22T01:05:00.000Z',createdAt:'2026-09-22T01:00:00.000Z',updatedAt:'2026-09-22T01:00:00.000Z',result:null,errorMessage:null}}))).mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:[]})));
  const refresh=vi.fn();render(<RecoveryPanel incidentId={id} incidentStatus="open" role="flight_controller" disabled={false} onCompleted={refresh}/>);
  await screen.findByText('No recovery commands recorded.');
  await userEvent.click(screen.getByRole('button',{name:'Request command'}));
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(3));expect(refresh).toHaveBeenCalled();fetchMock.mockRestore();
});

it('ignores the intentional Strict Mode request abort',async()=>{
  const fetchMock=vi.spyOn(globalThis,'fetch')
    .mockRejectedValueOnce(new DOMException('Aborted','AbortError'))
    .mockResolvedValue(new Response(JSON.stringify({success:true,data:[]})));
  render(<StrictMode><RecoveryPanel incidentId={id} incidentStatus="open" role="admin" disabled={false} onCompleted={()=>{}}/></StrictMode>);
  await screen.findByText('No recovery commands recorded.');
  expect(screen.queryByText('Could not load recovery commands.')).toBeNull();
  fetchMock.mockRestore();
});
