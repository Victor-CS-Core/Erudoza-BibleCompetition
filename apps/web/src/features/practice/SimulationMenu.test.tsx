import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { practiceApi, type PracticeRoom } from '../../api/practice';
import { SimulationMenu, SimulationEditor } from './SimulationMenu';
vi.mock('../../auth/AuthContext',()=>({useAuth:()=>({me:{organizationId:'org',userId:'u',kind:'Student'}})}));
const material={seasonId:'s',translation:'NKJV',books:[{key:'MRK',label:'Mark',chapters:[1,2]}],introductionsAvailable:true};
describe('Simulation setup',()=>{
 it('keeps integrity settings fixed and saves explicit selected chapters',()=>{
 const save=vi.fn(); render(<SimulationEditor material={material} creatorId="u" onSave={save} pending={false}/>);
 fireEvent.click(screen.getByLabelText('Selected chapters')); fireEvent.click(screen.getByLabelText('Mark 2'));
 fireEvent.click(screen.getByRole('tab',{name:'Review'})); fireEvent.click(screen.getByRole('button',{name:'Save setup'}));
 expect(save).toHaveBeenCalledWith(expect.objectContaining({bookKeys:['MRK'],chapters:[{bookKey:'MRK',chapter:2}],preset:'FullEvent',halfTime:true,scope:'SelectedChapters'}),6,90);
 });
 it('tells a coach the audio presenter must be a team member once students join',()=>{
 render(<SimulationEditor material={material} creatorId="coach" onSave={vi.fn()} pending={false}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Team'}));
 expect(screen.getByText(/The audio presenter must be a team member/)).toBeInTheDocument();
 });
 it('hides the presenter note once the team roster has members',()=>{
 const cache=new QueryClient();
 render(<QueryClientProvider client={cache}><SimulationEditor material={material} creatorId="u" members={[{userId:'u',displayName:'You',team:1,captain:true,scribe:true,ready:false}]} onSave={vi.fn()} pending={false}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole('tab',{name:'Team'}));
 expect(screen.queryByText(/The audio presenter must be a team member/)).not.toBeInTheDocument();
 });
 it('explains that full-event team rehearsals count toward Simulation honors',()=>{
 const save=vi.fn(); render(<SimulationEditor material={material} creatorId="u" onSave={save} pending={false}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Review'}));
 expect(screen.getByText(/counts toward Simulation honors/)).toBeInTheDocument();
 expect(screen.getByText(/For XP and streak credit, use the solo timed rehearsal from Study instead/)).toBeInTheDocument();
 });
 it('blocks empty explicit chapters and locks full event count',()=>{
 render(<SimulationEditor material={material} creatorId="u" onSave={vi.fn()} pending={false}/>);
 fireEvent.click(screen.getByLabelText('Selected chapters')); expect(screen.getByRole('button',{name:'Save setup'})).toBeDisabled();
 fireEvent.click(screen.getByRole('tab',{name:'Timers'})); expect(screen.getByLabelText('Number of questions')).toBeDisabled();
 });
});

it('retains edits and freezes the opening revision until explicit reload after a roster change',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 vi.spyOn(practiceApi,'simulationMaterial').mockResolvedValue(material);
 const save=vi.fn(),baseline={seasonId:'s',coached:false,phase:'Lobby',questionIndex:0,serverNow:'2026-09-13T00:00:00Z',draft:[],submitted:false,messages:[],scores:[],results:[],achievements:[],isCoach:false,id:'room',revision:4,ownerId:'u',status:'Lobby',teamSize:6,questionCount:90,simulation:{version:1,scope:'AllAssigned',preset:'FullEvent',bookKeys:['MRK'],chapters:[],includeScripture:true,includeIntroductions:true,timeMultiplier:1,halfTime:true,discussion:'InPerson',audioPresenterId:'u'},members:[{userId:'u',displayName:'You',team:1,captain:true,scribe:true,ready:false}]} as PracticeRoom;
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const tree=(room:PracticeRoom)=><QueryClientProvider client={cache}><SimulationMenu org="org" seasonId="s" creatorId="u" open room={room} onClose={vi.fn()} onSave={save}/></QueryClientProvider>;
 const view=render(tree(baseline)); await screen.findByRole('button',{name:'Save setup'});
 fireEvent.click(screen.getByRole('tab',{name:'Timers'}));fireEvent.change(screen.getByLabelText('Preset'),{target:{value:'ShortPractice'}});
 view.rerender(tree({...baseline,revision:5,messages:[]}));
 fireEvent.click(screen.getByRole('button',{name:'Save setup'}));expect(save).toHaveBeenLastCalledWith(expect.objectContaining({preset:'ShortPractice'}),6,10,4);
 view.rerender(tree({...baseline,revision:6,members:[...baseline.members,{...baseline.members[0],userId:'v',displayName:'Other',scribe:false}]}));
 expect(screen.getByText(/Your edits are retained/)).toBeInTheDocument();expect(screen.getByLabelText('Preset')).toHaveValue('ShortPractice');expect(screen.getByRole('button',{name:'Save setup'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Reload latest setup'}));fireEvent.click(screen.getByRole('tab',{name:'Timers'}));
 await waitFor(()=>expect(screen.getByLabelText('Preset')).toHaveValue('FullEvent'));
 expect(practiceApi.simulationMaterial).toHaveBeenCalledWith('org','s','room');
});
