import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {pbeDisputeApi,type PbeResultReview} from '../../api/practice';
import {Badge,Button,Notice} from '../../components/ui';
import {AppealForm} from './AppealForm';
export function PbeFlagAnswer({activity,sessionId,attemptId,review}:{activity:'Solo'|'Team';sessionId:string;attemptId:string;review?:PbeResultReview|null}){
 const cache=useQueryClient(),[open,setOpen]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState<PbeResultReview|null>(null);
 const current=review&&review.revision>=(saved?.revision??0)?review:saved;
 async function flag(reason:string){setPending(true);setError('');try{setSaved(await pbeDisputeApi.flag({activity,sessionId,attemptId,reason}));await Promise.all(['practice-room','practice','training-recap'].map(key=>cache.invalidateQueries({queryKey:[key]})));}catch(e){setError(e instanceof Error?e.message:'Review could not be saved. Retry your request.');}finally{setPending(false);}}
 return <div>{current?<><Badge tone={current.status==='Pending'?'warning':'success'}>{current.status==='Pending'?'Review pending':'Review resolved'}</Badge><p>{current.status==='Pending'?'Keep practicing. A coach can review this answer later.':'The saved score includes the coach’s rubric correction.'}</p></>:open?<AppealForm pending={pending} onRequest={reason=>void flag(reason)}/>:<Button variant="secondary" onClick={()=>setOpen(true)}>Flag answer</Button>}{error&&<Notice tone="danger">{error}</Notice>}</div>;
}
