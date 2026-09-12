import {afterEach,expect,it,vi} from 'vitest';
import {api,request} from './client';
afterEach(()=>vi.unstubAllGlobals());
it.each([{detail:'PBE_CHAPTER_CURSOR_STALE'},{title:'Conflict',detail:'Try again',code:'PBE_COOPERATION_WORK_STALE'},{message:'PBE_CHAPTER_SCOPE_STALE'}])('preserves the actual server problem code with existing fields: %j',async(problem)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(problem),{status:409,headers:{'Retry-After':'3'}})));
 await expect(request('/api/v1/progress/me/chapters')).rejects.toMatchObject({status:409,retryAfterSeconds:3,code:'code' in problem?problem.code:'detail' in problem?problem.detail:problem.message});
});
it('forwards a chapter progress selector without changing legacy start bodies',async()=>{
 const fetch=vi.fn().mockImplementation(async()=>new Response('{}'));vi.stubGlobal('fetch',fetch);
 await api.startSession('season');expect(fetch.mock.calls[0][1].body).toBe('{"seasonId":"season","mode":"Practice","format":"Memory"}');
 await api.startSession('season','Review',{clientStartId:'action'},'Pbe',undefined,{progressScope:{key:'group',scopeVersion:'v'}});
 expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({seasonId:'season',mode:'Review',format:'Pbe',training:{clientStartId:'action'},progressScope:{key:'group',scopeVersion:'v'}});
});
it('does not promote prose or malformed code fields to a machine code',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'Please retry.',code:123}),{status:409})));
 await expect(request('/api/v1/progress/me/chapters')).rejects.toMatchObject({message:'Please retry.',status:409,code:undefined});
});
it('forwards the existing chapter and target-ID selector together',async()=>{
 const fetch=vi.fn().mockImplementation(async()=>new Response('{}'));vi.stubGlobal('fetch',fetch);
 await api.startSession('s','Practice',undefined,'Pbe',undefined,{chapter:{contentPackId:'p',chapter:2},targetIds:['target']});
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({chapter:{contentPackId:'p',chapter:2},targetIds:['target']});
});
it('uses the authorized student and organization cooperation route families with encoded cursors',async()=>{
 const {trainingApi}=await import('./training');
 const fetch=vi.fn().mockImplementation(async()=>new Response('{}'));vi.stubGlobal('fetch',fetch);
 await trainingApi.cooperation('season?');
 await trainingApi.continueCooperation({seasonId:'season',workId:'work'});
 await trainingApi.coachCooperation('org','season');
 await trainingApi.continueCoachCooperation('org','season',{seasonId:'season'});
 await trainingApi.cooperationStudents('org','season',{after:'x/y?',limit:32});
 expect(fetch.mock.calls.map(call=>call[0])).toEqual(['/api/v1/progress/me/pbe-cooperation?seasonId=season%3F','/api/v1/progress/me/pbe-cooperation/continue','/api/v1/organizations/org/seasons/season/pbe-cooperation','/api/v1/organizations/org/seasons/season/pbe-cooperation/continue','/api/v1/organizations/org/seasons/season/pbe-cooperation/students?after=x%2Fy%3F&limit=32']);
 expect(fetch.mock.calls[1][1]).toMatchObject({method:'POST',body:'{"seasonId":"season","workId":"work"}'});
 expect(fetch.mock.calls[3][1]).toMatchObject({method:'POST',body:'{"seasonId":"season"}'});
});
