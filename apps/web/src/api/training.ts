import { request } from './client';
import type { TrainingToday, TrainingPreferences, WeeklyTarget, SessionRecap, BadgeProgress, PassageJourneyPage } from './trainingTypes';
export const trainingApi = {
    today: (seasonId?: string) => request<TrainingToday>(`/api/v1/progress/me/today${seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''}`),
    savePreferences: (input: {
        weeklyTarget: WeeklyTarget;
        timeZone: string;
    }) => request<TrainingPreferences>('/api/v1/progress/me/preferences', { method: 'PUT', body: JSON.stringify(input) }),
    recap: (sessionId: string) => request<SessionRecap>(`/api/v1/study/sessions/${encodeURIComponent(sessionId)}/recap`),
    honors: (seasonId: string) => request<BadgeProgress[]>(`/api/v1/progress/me/honors?seasonId=${encodeURIComponent(seasonId)}`),
    journey: (seasonId: string, after?: string) => request<PassageJourneyPage>(`/api/v1/progress/me/journey?seasonId=${encodeURIComponent(seasonId)}${after ? `&after=${encodeURIComponent(after)}` : ''}`),
};
