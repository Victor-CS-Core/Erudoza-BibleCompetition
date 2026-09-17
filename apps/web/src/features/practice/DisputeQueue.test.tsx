import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {pbeDisputeApi,type PbeDispute} from '../../api/practice';
import {DisputeQueue} from './DisputeQueue';
import { ToastProvider } from "../../components/ui";
vi.mock('../../auth/AuthContext',()=>({useAuth:()=>({me:{organizationId:'org',userId:'coach',kind:'Adult'}})}));
vi.mock('../../api/practice',()=>({pbeDisputeApi:{queue:vi.fn(),resolve:vi.fn(),replay:vi.fn()}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('reviews a Solo frozen rubric independently of room enablement and resumes bounded evidence updates',async()=>{
 const d:PbeDispute={id:'Solo:session:attempt',organizationId:'org',seasonId:'season',activity:'Solo',sessionId:'session',attemptId:'attempt',questionId:'q',questionVersion:1,team:null,status:'Pending',reason:'Please check the labels',revision:1,partPoints:[1,1],sourceEvidence:'Alpha and Beta',question:{schemaVersion:2,id:'q',version:1,contentPackId:'pack',sourceUnitId:'source',sourceUnitIds:['source'],sourceKind:'Scripture',reference:'Daniel1',evidence:'Alpha and Beta',kind:'List',prompt:'Name both labels',ordered:false,parts:[{targetId:'a',acceptedAnswers:['Alpha'],points:1},{targetId:'b',acceptedAnswers:['Beta'],points:1}]},answers:['Alpha','wrong'],originalPointsByPart:[1,0],acceptedAtUtc:'2026-09-12T00:00:00Z',resolution:null};
 vi.mocked(pbeDisputeApi.queue).mockResolvedValueOnce({items:[d],nextCursor:null}).mockResolvedValue({items:[{...d,status:'Resolved',revision:2}],nextCursor:null});vi.mocked(pbeDisputeApi.resolve).mockResolvedValue({...d,status:'Resolved',revision:2});vi.mocked(pbeDisputeApi.replay).mockResolvedValue({status:'Provisional'});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ToastProvider><DisputeQueue/></ToastProvider></MemoryRouter></QueryClientProvider>);
 expect(await screen.findByRole('heading',{name:'Name both labels'})).toBeInTheDocument();expect(screen.getByText(/Solo reviews remain available/)).toBeInTheDocument();expect(screen.getByText('Alpha and Beta')).toBeInTheDocument();const second=screen.getByLabelText(/Part 2 points/);expect(second).toHaveAttribute('max','1');fireEvent.change(second,{target:{value:'1'}});fireEvent.change(screen.getByLabelText('Reason for the correction'),{target:{value:'Both labels are supported'}});fireEvent.click(screen.getByRole('button',{name:'Save rubric correction'}));
 await waitFor(()=>expect(pbeDisputeApi.resolve).toHaveBeenCalledWith(d.id,{expectedRevision:1,pointsByPart:[1,1],reason:'Both labels are supported'}));expect(await screen.findByRole('button',{name:'Continue evidence update'})).toBeInTheDocument();expect(pbeDisputeApi.replay).toHaveBeenCalledTimes(20);vi.mocked(pbeDisputeApi.replay).mockResolvedValue({status:'Ready'});fireEvent.click(screen.getByRole('button',{name:'Continue evidence update'}));expect(await screen.findByText(/Practice evidence is up to date/)).toBeInTheDocument();expect(pbeDisputeApi.resolve).toHaveBeenCalledTimes(1);
});

it('rediscovers every saved correction after reload and keeps batches beyond twenty pages resumable',async()=>{
 const d:PbeDispute={id:'Solo:session:attempt',organizationId:'org',seasonId:'season',activity:'Solo',sessionId:'session',attemptId:'attempt',questionId:'q',questionVersion:1,team:null,status:'Pending',reason:'Please check the labels',revision:1,partPoints:[1,1],sourceEvidence:'Alpha and Beta',question:{schemaVersion:2,id:'q',version:1,contentPackId:'pack',sourceUnitId:'source',sourceUnitIds:['source'],sourceKind:'Scripture',reference:'Daniel1',evidence:'Alpha and Beta',kind:'List',prompt:'Name both labels',ordered:false,parts:[{targetId:'a',acceptedAnswers:['Alpha'],points:1},{targetId:'b',acceptedAnswers:['Beta'],points:1}]},answers:['Alpha','wrong'],originalPointsByPart:[1,0],acceptedAtUtc:'2026-09-12T00:00:00Z',resolution:null};
 const first={...d,status:'Resolved' as const,revision:2},second={...first,id:'Solo:session:second',question:{...d.question,prompt:'Second saved correction'}};
 vi.mocked(pbeDisputeApi.queue).mockResolvedValue({items:[first,second],nextCursor:null});vi.mocked(pbeDisputeApi.replay).mockResolvedValue({status:'Provisional'});
 const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ToastProvider><DisputeQueue/></ToastProvider></MemoryRouter></QueryClientProvider>);
 mount();expect(await screen.findAllByRole('button',{name:'Continue evidence update'})).toHaveLength(2);
 fireEvent.click(screen.getAllByRole('button',{name:'Continue evidence update'})[0]);await waitFor(()=>expect(pbeDisputeApi.replay).toHaveBeenCalledTimes(20));
 cleanup();mount();expect(await screen.findAllByRole('button',{name:'Continue evidence update'})).toHaveLength(2);
 fireEvent.click(screen.getAllByRole('button',{name:'Continue evidence update'})[1]);await waitFor(()=>expect(pbeDisputeApi.replay).toHaveBeenCalledTimes(40));expect(pbeDisputeApi.resolve).not.toHaveBeenCalled();
});

it('rediscovers a committed correction when the resolve response is lost',async()=>{
 const d:PbeDispute={id:'Solo:session:attempt',organizationId:'org',seasonId:'season',activity:'Solo',sessionId:'session',attemptId:'attempt',questionId:'q',questionVersion:1,team:null,status:'Pending',reason:'Please check the labels',revision:1,partPoints:[1,1],sourceEvidence:'Alpha and Beta',question:{schemaVersion:2,id:'q',version:1,contentPackId:'pack',sourceUnitId:'source',sourceUnitIds:['source'],sourceKind:'Scripture',reference:'Daniel1',evidence:'Alpha and Beta',kind:'List',prompt:'Name both labels',ordered:false,parts:[{targetId:'a',acceptedAnswers:['Alpha'],points:1},{targetId:'b',acceptedAnswers:['Beta'],points:1}]},answers:['Alpha','wrong'],originalPointsByPart:[1,0],acceptedAtUtc:'2026-09-12T00:00:00Z',resolution:null};
 vi.mocked(pbeDisputeApi.queue).mockResolvedValueOnce({items:[d],nextCursor:null}).mockResolvedValue({items:[{...d,status:'Resolved',revision:2}],nextCursor:null});
 vi.mocked(pbeDisputeApi.resolve).mockRejectedValue(new Error('Connection interrupted'));vi.mocked(pbeDisputeApi.replay).mockResolvedValue({status:'Ready'});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ToastProvider><DisputeQueue/></ToastProvider></MemoryRouter></QueryClientProvider>);
 fireEvent.change(await screen.findByLabelText('Reason for the correction'),{target:{value:'Frozen source correction'}});fireEvent.click(screen.getByRole('button',{name:'Save rubric correction'}));
 expect(await screen.findByRole('button',{name:'Continue evidence update'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Save rubric correction'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Continue evidence update'}));await waitFor(()=>expect(pbeDisputeApi.replay).toHaveBeenCalledWith(d.id));expect(pbeDisputeApi.resolve).toHaveBeenCalledTimes(1);
});
