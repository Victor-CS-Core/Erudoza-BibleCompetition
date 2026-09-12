import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import { trainingApi } from '../../api/training';
import { StudyPage } from './StudyPage';
import type { PbePresentationState, PbeResumedSession } from '../../api/pbeTypes';
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ me: { organizationId: 'org', userId: 'student' } }) }));
const saved: PbeResumedSession = { session: { id: 'pbe-session', seasonId: 'season', format: 'Pbe', mode: 'Practice', status: 'Active', targetCardCount: 2 }, card: { id: 'card', sessionId: 'pbe-session', format: 'Pbe', sequence: 1, total: 2, assisted: false, question: { id: 'question', version: 1, prompt: 'Name both labels.', reference: 'GEN 1:1', kind: 'List', partPoints: [1, 1], points: 2, durationSeconds: 30 } }, attempt: null, summary: null };
const result = { attemptId: 'attempt', earnedPoints: 1, availablePoints: 2, expectedParts: ['Alpha', 'Beta'], sourceEvidence: 'Alpha and Beta', citation: 'GEN 1:1', unaided: false, acceptedAtUtc: '2026-09-12T00:00:00.000Z', acceptedSequence: 1, alreadyProcessed: false };
function mount(path: string) { const router = createMemoryRouter([{ path: '/student/study', element: <StudyPage /> }, { path: '/student/sessions/:sessionId/recap', element: <p>Saved recap</p> }], { initialEntries: [path] }); render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router}/></QueryClientProvider>); return router; }
beforeEach(() => {
    vi.spyOn(api, 'progress').mockResolvedValue({ seasonId: 'season', seasonName: 'Season', seasonStatus: 'Active', pbeEnabled: true, assignments: [], masteredCount: 0, reviewDueCount: 0, attemptCount: 0, mastery: [] });
    vi.spyOn(api, 'resumeSession').mockResolvedValue(saved as never);
    vi.spyOn(api, 'startSession');
    vi.spyOn(api, 'nextCard');
    vi.spyOn(api, 'nextPbeCard').mockResolvedValue(saved.card!);
    vi.spyOn(api, 'completeSession');
    vi.spyOn(api, 'submitPbeAttempt').mockResolvedValue(result);
    vi.spyOn(api, 'pbeTimed');
    vi.spyOn(api, 'pbeTimedStatus');
    vi.spyOn(api, 'pbeSource').mockResolvedValue({ assisted: true, sources: [{ citation: 'GEN 1:1', canonicalText: 'Alpha and Beta' }] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); sessionStorage.clear(); });
it('uses the saved PBE format despite a Memory URL and preserves server-recorded aid and partial feedback', async () => {
    mount('/student/study?sessionId=pbe-session&format=Memory');
    await screen.findByLabelText('Answer 1');
    expect(api.startSession).not.toHaveBeenCalled();
    expect(api.nextCard).not.toHaveBeenCalled();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Answer 1'), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read source with assistance' }));
    await screen.findByText('Source assistance is recorded for this card.');
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    await screen.findByText('1 / 2 points');
    expect(screen.getByTestId('feedback-source')).toHaveTextContent('Alpha and Beta');
    expect(api.submitPbeAttempt).toHaveBeenCalledWith('pbe-session', expect.objectContaining({ answers: ['Alpha', ''], hintsUsed: true }));
});
it('uses saved Memory despite enabled PBE and a contradictory URL without running PBE effects', async () => {
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: 'memory', seasonId: 'season', mode: 'Practice', status: 'Active', targetCardCount: 8 }, card: { id: 'm-card', sessionId: 'memory', activityType: 'MissingWords', citation: 'GEN 1:1', prompt: 'Memory prompt', tokens: [], sequence: 1, total: 8 }, attempt: null, summary: null });
    mount('/student/study?sessionId=memory&format=Pbe');
    await screen.findByTestId('missing-words-answer');
    expect(api.nextPbeCard).not.toHaveBeenCalled();
    expect(api.startSession).not.toHaveBeenCalled();
});
it('restores and retries the exact pending text without permitting a changed answer', async () => {
    sessionStorage.setItem('erudoza:pbe-attempt:pbe-session', JSON.stringify({ clientSubmissionId: 'pending', challengeCardId: 'card', answers: ['Alpha', 'wrong'], hintsUsed: false }));
    vi.mocked(api.submitPbeAttempt).mockRejectedValueOnce(new ApiError('Offline', 503));
    mount('/student/study?sessionId=pbe-session');
    const input = await screen.findByLabelText('Answer 1');
    expect(input).toHaveValue('Alpha');
    expect(input).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved answer' }));
    await screen.findByText('Offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved answer' }));
    await screen.findByText('1 / 2 points');
    expect(vi.mocked(api.submitPbeAttempt).mock.calls[0]).toEqual(vi.mocked(api.submitPbeAttempt).mock.calls[1]);
});
it('starts PBE Simulation as shortened timed practice', async () => {
    vi.spyOn(trainingApi, 'today').mockResolvedValue({ format: 'Pbe', seasonId: 'season', seasonName: 'Season', mission: { status: 'Suggested' } } as never);
    vi.mocked(api.startSession).mockResolvedValue({ ...saved.session, mode: 'Simulation' });
    mount('/student/study?seasonId=season&format=Pbe&mode=Simulation');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('season', 'Simulation', expect.objectContaining({ clientStartId: expect.any(String) }), 'Pbe'));
});
it('shows a terminal interrupted rehearsal with an independent restart instead of requesting the old card',async()=>{
    vi.mocked(api.resumeSession).mockResolvedValue({...saved,session:{...saved.session,mode:'Simulation',status:'Interrupted'},card:null,summary:{sessionId:'pbe-session',format:'Pbe',mode:'Simulation',attempted:1,status:'Interrupted',earnedPoints:1,availablePoints:2,results:[result]},interruption:{status:'Interrupted',restartAllowed:true}} as never);
    mount('/student/study?sessionId=pbe-session&format=Pbe');
    expect(await screen.findByText(/Earlier accepted answers are retained/)).toBeInTheDocument();
    expect(screen.getByText('1 / 2 points')).toBeVisible();
    expect(screen.getByRole('link',{name:'View partial recap'})).toHaveAttribute('href',expect.stringContaining('/student/sessions/pbe-session/recap'));
    expect(screen.getByRole('link',{name:'Start another shortened timed practice'})).toHaveAttribute('href',expect.stringContaining('mode=Simulation'));
    expect(api.nextPbeCard).not.toHaveBeenCalled();
});
it('rejects an initial receipt for another card instead of advancing',async()=>{
    vi.mocked(api.resumeSession).mockResolvedValue({...saved,session:{...saved.session,mode:'Simulation'}} as never);
    vi.mocked(api.pbeTimedStatus).mockResolvedValue({attemptId:'old',acceptedAtUtc:new Date().toISOString(),acceptedSequence:1,alreadyProcessed:true,feedbackDeferred:true,questionId:'previous'});
    mount('/student/study?sessionId=pbe-session&format=Pbe');await waitFor(()=>expect(api.pbeTimedStatus).toHaveBeenCalled());
    expect(api.nextPbeCard).not.toHaveBeenCalled();expect(api.completeSession).not.toHaveBeenCalled();
});
it('restores an armed Simulation window on refresh without presenting or acknowledging again',async()=>{
    vi.mocked(api.resumeSession).mockResolvedValue({...saved,session:{...saved.session,mode:'Simulation'}} as never);
    vi.mocked(api.pbeTimedStatus).mockResolvedValue({questionId:'card',revision:1,delivery:'TextFallback',requiredScribeIds:['student'],readyScribeIds:['student'],responseStartsAtMs:Date.now()-1000,responseEndsAtMs:Date.now()+30000,status:'Armed',serverNow:new Date().toISOString(),feedbackDeferred:true});
    mount('/student/study?sessionId=pbe-session&format=Pbe');
    expect(await screen.findByTestId('challenge-card')).toBeVisible();
    expect(api.pbeTimed).not.toHaveBeenCalled();
});
it('retries a lost acknowledgement response without opening a replacement card',async()=>{
    vi.mocked(api.resumeSession).mockResolvedValue({...saved,session:{...saved.session,mode:'Simulation'}} as never);
    vi.mocked(api.pbeTimedStatus).mockResolvedValue({status:'NotPresented',questionId:'card',revision:0,serverNow:new Date().toISOString(),feedbackDeferred:true} as never);
    const presented:PbePresentationState={questionId:'card',revision:1,delivery:'TextFallback',requiredScribeIds:['student'],readyScribeIds:[],responseStartsAtMs:null,responseEndsAtMs:null,status:'Presenting',serverNow:new Date().toISOString(),feedbackDeferred:true};
    const armed:PbePresentationState={...presented,readyScribeIds:['student'],responseStartsAtMs:Date.now()+3000,responseEndsAtMs:Date.now()+33000,status:'Armed'};
    vi.mocked(api.pbeTimed).mockResolvedValueOnce(presented).mockRejectedValueOnce(new ApiError('Connection lost',503)).mockResolvedValueOnce(presented).mockResolvedValueOnce(armed);
    mount('/student/study?sessionId=pbe-session&format=Pbe');
    fireEvent.click(await screen.findByRole('button',{name:/ready to hear/i}));
    fireEvent.click(await screen.findByRole('button',{name:/finished first reading/i}));fireEvent.click(screen.getByRole('button',{name:/finished second reading/i}));
    expect(await screen.findByText('Connection lost')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:/finished second reading/i}));
    expect(await screen.findByTestId('challenge-card')).toBeVisible();
    expect(vi.mocked(api.pbeTimed).mock.calls.map(call=>(call[1] as {action:string}).action)).toEqual(['present','ack','present','ack']);
});
it('reconciles a blank expired window and advances from the server receipt',async()=>{
    vi.useFakeTimers();
    vi.mocked(api.resumeSession).mockResolvedValue({...saved,session:{...saved.session,mode:'Simulation'}} as never);
    vi.mocked(api.pbeTimedStatus).mockResolvedValueOnce({questionId:'card',revision:1,delivery:'TextFallback',requiredScribeIds:['student'],readyScribeIds:['student'],responseStartsAtMs:Date.now()-40000,responseEndsAtMs:Date.now()-1000,status:'Armed',serverNow:new Date().toISOString(),feedbackDeferred:true}).mockResolvedValueOnce({attemptId:'attempt',acceptedAtUtc:new Date().toISOString(),acceptedSequence:1,alreadyProcessed:true,feedbackDeferred:true,responseLockedAtUtc:new Date().toISOString(),questionId:'card'});
    mount('/student/study?sessionId=pbe-session&format=Pbe');
    await vi.waitFor(()=>expect(api.pbeTimedStatus).toHaveBeenCalledTimes(1));
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
    expect(api.nextPbeCard).toHaveBeenCalledWith('pbe-session');
});
it('keeps polling Settled, NotPresented and transient failures until the final-card receipt completes',async()=>{
    vi.useFakeTimers();const finalCard={...saved.card!,sequence:1,total:1};
    vi.mocked(api.resumeSession).mockResolvedValue({...saved,session:{...saved.session,mode:'Simulation'},card:finalCard} as never);
    const base:PbePresentationState={questionId:'card',revision:1,delivery:'TextFallback',requiredScribeIds:['student'],readyScribeIds:['student'],responseStartsAtMs:Date.now()-40000,responseEndsAtMs:Date.now()-1000,status:'Armed',serverNow:new Date().toISOString(),feedbackDeferred:true};
    vi.mocked(api.pbeTimedStatus).mockResolvedValueOnce(base).mockResolvedValueOnce({...base,status:'Settled'}).mockResolvedValueOnce({...base,status:'NotPresented',responseStartsAtMs:null,responseEndsAtMs:null}).mockRejectedValueOnce(new ApiError('Still delivering',503)).mockResolvedValueOnce({attemptId:'attempt',acceptedAtUtc:new Date().toISOString(),acceptedSequence:1,alreadyProcessed:true,feedbackDeferred:true,questionId:'card'});
    vi.mocked(api.completeSession).mockResolvedValue({} as never);mount('/student/study?sessionId=pbe-session&format=Pbe');await vi.waitFor(()=>expect(api.pbeTimedStatus).toHaveBeenCalledTimes(1));
    await act(async()=>{await vi.advanceTimersByTimeAsync(2500);});
    expect(api.completeSession).toHaveBeenCalledWith('pbe-session');expect(api.nextPbeCard).not.toHaveBeenCalled();
});
it('defaults an eligible new season to PBE and does not run Memory start or next', async () => {
    vi.spyOn(trainingApi, 'today').mockResolvedValue({ format: 'Pbe', seasonId: 'season', seasonName: 'Season', mission: { status: 'Suggested' } } as never);
    vi.mocked(api.startSession).mockResolvedValue(saved.session);
    mount('/student/study?seasonId=season');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('season', 'Practice', expect.objectContaining({ clientStartId: expect.any(String) }), 'Pbe'));
    expect(api.nextCard).not.toHaveBeenCalled();
});
