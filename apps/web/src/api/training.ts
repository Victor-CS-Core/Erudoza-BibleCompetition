import type {ChapterPage,ContinueChaptersRequest,ContinueChaptersResponse,CooperationSnapshot,ContinueCooperationRequest,ContinueCooperationResponse,CooperationStudentPage} from './pbeTypes';
import { request } from './client';
import type { TrainingToday, TrainingPreferences, WeeklyTarget, SessionRecap, BadgeProgress, PassageJourneyPage } from './trainingTypes';
const cooperationPath = (organizationId:string, seasonId:string) => `/api/v1/organizations/${encodeURIComponent(organizationId)}/seasons/${encodeURIComponent(seasonId)}/pbe-cooperation`;
export const trainingApi = {
    cooperation: (seasonId:string) => request<CooperationSnapshot>(`/api/v1/progress/me/pbe-cooperation?seasonId=${encodeURIComponent(seasonId)}`),
    continueCooperation: (input:ContinueCooperationRequest) => request<ContinueCooperationResponse>('/api/v1/progress/me/pbe-cooperation/continue',{method:'POST',body:JSON.stringify(input)}),
    coachCooperation: (organizationId:string,seasonId:string) => request<CooperationSnapshot>(cooperationPath(organizationId,seasonId)),
    continueCoachCooperation: (organizationId:string,seasonId:string,input:ContinueCooperationRequest) => request<ContinueCooperationResponse>(`${cooperationPath(organizationId,seasonId)}/continue`,{method:'POST',body:JSON.stringify(input)}),
    cooperationStudents: (organizationId:string,seasonId:string,options:{after?:string;limit?:number}={}) => {
        const query=new URLSearchParams();
        for(const [key,value] of Object.entries(options))if(value!==undefined)query.set(key,String(value));
        return request<CooperationStudentPage>(`${cooperationPath(organizationId,seasonId)}/students${query.size?`?${query}`:''}`);
    },
    chapters: (seasonId:string, options:{view?:'Chapters'|'Groups'|'Stamps';chapterKey?:string;after?:string;limit?:number}={}) => {
        const query=new URLSearchParams({seasonId});
        for(const [key,value] of Object.entries(options))if(value!==undefined)query.set(key,String(value));
        return request<ChapterPage>(`/api/v1/progress/me/chapters?${query}`);
    },
    continueChapters: (input:ContinueChaptersRequest) => request<ContinueChaptersResponse>('/api/v1/progress/me/chapters/continue',{method:'POST',body:JSON.stringify(input)}),
    today: (seasonId?: string) => request<TrainingToday>(`/api/v1/progress/me/today${seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''}`),
    savePreferences: (input: {
        weeklyTarget: WeeklyTarget;
        timeZone: string;
    }) => request<TrainingPreferences>('/api/v1/progress/me/preferences', { method: 'PUT', body: JSON.stringify(input) }),
    recap: (sessionId: string) => request<SessionRecap>(`/api/v1/study/sessions/${encodeURIComponent(sessionId)}/recap`),
    honors: (seasonId: string) => request<BadgeProgress[]>(`/api/v1/progress/me/honors?seasonId=${encodeURIComponent(seasonId)}`),
    journey: (seasonId: string, after?: string) => request<PassageJourneyPage>(`/api/v1/progress/me/journey?seasonId=${encodeURIComponent(seasonId)}${after ? `&after=${encodeURIComponent(after)}` : ''}`),
};
