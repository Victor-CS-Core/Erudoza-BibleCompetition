import type {ChapterPage,ContinueChaptersRequest,ContinueChaptersResponse} from './pbeTypes';
import { request } from './client';
import type { TrainingToday, TrainingPreferences, WeeklyTarget, SessionRecap, BadgeProgress, PassageJourneyPage } from './trainingTypes';
export const trainingApi = {
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
