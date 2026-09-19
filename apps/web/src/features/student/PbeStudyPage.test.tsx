import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: 'memory', seasonId: 'season', mode: 'Practice', status: 'Active', targetCardCount: 8 }, card: { id: 'm-card', sessionId: 'memory', activityType: 'MissingWords', citation: 'GEN 1:1', prompt: 'Memory ____', tokens: [{ index: 0, display: 'Memory', hidden: false }, { index: 2, display: '____', hidden: true }], sequence: 1, total: 8 }, attempt: null, summary: null });
    mount('/student/study?sessionId=memory&format=Pbe');
    await screen.findByRole('textbox', { name: 'Blank 1 of 1' });
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
it('retries a guarded chapter action with the same selector and client start identity', async () => {
    vi.spyOn(trainingApi, 'today').mockResolvedValue({ format: 'Pbe', seasonId: 'season', seasonName: 'Season', mission: { status: 'Suggested' } } as never);
    vi.mocked(api.startSession).mockRejectedValueOnce(new ApiError('Connection lost', 503)).mockResolvedValueOnce(saved.session);
    mount('/student/study?seasonId=season&format=Pbe&mode=Review&startId=chapter-start&progressScopeKey=group%3Achapter%3Apack%3ADaniel%3A1%3As1%3As3&progressScopeVersion=scope-v1');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry start' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(2));
    const expectedTraining = { clientStartId: 'chapter-start', timeZone: expect.any(String) };
    const expectedSelection = { progressScope: { key: 'group:chapter:pack:Daniel:1:s1:s3', scopeVersion: 'scope-v1' } };
    expect(vi.mocked(api.startSession).mock.calls[0]).toEqual(['season', 'Review', expectedTraining, 'Pbe', undefined, expectedSelection]);
    expect(vi.mocked(api.startSession).mock.calls[1]).toEqual(vi.mocked(api.startSession).mock.calls[0]);
    expect(expectedTraining).not.toHaveProperty('missionId');
});
it.each(['PBE_CHAPTER_SCOPE_STALE', 'PBE_CHAPTER_CURSOR_STALE'])('returns a %s guarded action to current chapter progress instead of retrying the old selector', async code => {
    vi.spyOn(trainingApi, 'today').mockResolvedValue({ format: 'Pbe', seasonId: 'season', seasonName: 'Season', mission: { status: 'Suggested' } } as never);
    vi.mocked(api.startSession).mockRejectedValue(new ApiError(code, 409, undefined, code));
    mount('/student/study?seasonId=season&format=Pbe&mode=Practice&startId=stale-start&progressScopeKey=chapter%3Apack%3ADaniel%3A1&progressScopeVersion=old-scope');
    expect(await screen.findByRole('alert')).toHaveTextContent('This chapter action is out of date');
    expect(screen.queryByRole('button', { name: 'Retry start' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to chapter progress' })).toHaveAttribute('href', '/student/progress?seasonId=season');
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
it('starts PBE practice from the Learn card when PBE is the season default', async () => {
    vi.spyOn(trainingApi, 'today').mockResolvedValue({ format: 'Pbe', seasonId: 'season', seasonName: 'Season', mission: { status: 'Suggested' } } as never);
    vi.mocked(api.startSession).mockResolvedValue(saved.session);
    mount('/student/study?seasonId=season');
    expect(await screen.findByRole('heading', { name: 'Choose your training' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('start-learn'));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('season', 'Practice', expect.objectContaining({ clientStartId: expect.any(String) }), 'Pbe'));
    expect(api.nextCard).not.toHaveBeenCalled();
});

// --- PBE Review entry redesign ---
function mockSuggestedToday() {
    vi.spyOn(trainingApi, 'today').mockResolvedValue({ format: 'Pbe', seasonId: 'season', seasonName: 'Season', mission: { status: 'Suggested' } } as never);
}
function dueProgress() {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    return {
        seasonId: 'season', seasonName: 'Season', seasonStatus: 'Active', pbeEnabled: true, assignments: [],
        masteredCount: 0, reviewDueCount: 2, attemptCount: 2,
        mastery: [
            { knowledgeUnitId: 'k1', title: 'John 3:16', level: 'Strong', exactWordingScore: 90, recognitionScore: 80, reviewDueAtUtc: yesterday },
            { knowledgeUnitId: 'k2', title: 'John 4:1', level: 'Mastered', exactWordingScore: 100, recognitionScore: 100, reviewDueAtUtc: new Date().toISOString() },
        ],
        recentAttempts: [
            { id: 'a1', title: 'John 3:16', activityType: 'MissingWords', isCorrect: false, submittedAnswer: 'x', evaluationResult: 'Miss', createdAtUtc: yesterday },
        ],
    };
}
it('opens the review entry with the due-practice identity and visible review rules', async () => {
    mockSuggestedToday();
    vi.mocked(api.progress).mockResolvedValue(dueProgress() as never);
    mount('/student/study?seasonId=season&format=Pbe&mode=Review');
    expect(await screen.findByText('Review · due practice')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Protect what you’ve learned' })).toBeInTheDocument();
    const rules = within(screen.getByRole('list', { name: 'Review rules' })).getAllByRole('listitem');
    expect(rules.map(rule => rule.textContent)).toEqual(['Untimed', 'Immediate feedback', 'PBE questions']);
    expect(screen.getByText(/there is no timer/i)).toBeInTheDocument();
    expect(screen.getByText(/feedback right after each answer/i)).toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
});
it('lists each due passage with its plain-language return reason', async () => {
    mockSuggestedToday();
    vi.mocked(api.progress).mockResolvedValue(dueProgress() as never);
    mount('/student/study?seasonId=season&format=Pbe&mode=Review');
    const queue = await screen.findByRole('list', { name: 'Due passages' });
    const items = within(queue).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const count = document.querySelector('.pbe-review-count');
    expect(count).toHaveTextContent('2');
    expect(count).toHaveTextContent('passages due');
    expect(within(items[0]).getByText('John 3:16')).toBeInTheDocument();
    expect(within(items[0]).getByText('Recent miss')).toBeInTheDocument();
    expect(within(items[0]).getByText(/last practiced yesterday · last score 90%/)).toBeInTheDocument();
    expect(within(items[0]).getByText('Retry')).toBeInTheDocument();
    expect(within(items[1]).getByText('John 4:1')).toBeInTheDocument();
    expect(within(items[1]).getByText('Review window reached')).toBeInTheDocument();
    expect(within(items[1]).getByText(/last score 100%/)).toBeInTheDocument();
    expect(within(items[1]).getByText('Scheduled')).toBeInTheDocument();
});
it('starts due reviews from the single entry action instead of on mount', async () => {
    mockSuggestedToday();
    vi.mocked(api.progress).mockResolvedValue(dueProgress() as never);
    vi.mocked(api.startSession).mockResolvedValue(saved.session);
    mount('/student/study?seasonId=season&format=Pbe&mode=Review');
    const start = await screen.findByRole('button', { name: 'Start due reviews' });
    expect(api.startSession).not.toHaveBeenCalled();
    fireEvent.click(start);
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('season', 'Review', expect.objectContaining({ clientStartId: expect.any(String) }), 'Pbe'));
    expect(await screen.findByTestId('challenge-card')).toBeVisible();
});
it('shows the honest caught-up state with a disabled start when nothing is due', async () => {
    mockSuggestedToday();
    mount('/student/study?seasonId=season&format=Pbe&mode=Review');
    expect(await screen.findByRole('heading', { name: 'You’ve all caught up' })).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Nothing due to review' });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(api.startSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Start due reviews' })).not.toBeInTheDocument();
    expect(screen.getByText(/Review will become available again when a passage reaches its next review window/)).toBeInTheDocument();
    expect(screen.getByText(/Choose Learn for today’s assigned material/)).toBeInTheDocument();
});
it('explains when no PBE questions are published instead of offering a start', async () => {
    vi.spyOn(trainingApi, 'today').mockResolvedValue({ format: 'Pbe', seasonId: 'season', seasonName: 'Season', mission: { status: 'Unavailable', explanation: 'No eligible published questions are available.' } } as never);
    mount('/student/study?seasonId=season&format=Pbe&mode=Review');
    expect(await screen.findByRole('heading', { name: 'No PBE questions to review' })).toBeInTheDocument();
    expect(screen.getByText(/No eligible published questions are available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start due reviews' })).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Choose Memory' })).toHaveAttribute('href', expect.stringContaining('format=Memory'));
});
it('falls back to the caught-up state when the server reports nothing due at start', async () => {
    mockSuggestedToday();
    vi.mocked(api.progress).mockResolvedValue(dueProgress() as never);
    vi.mocked(api.startSession).mockRejectedValue(new ApiError('No targets are due. Choose Practice.', 409, undefined, 'PBE_NOTHING_DUE'));
    mount('/student/study?seasonId=season&format=Pbe&mode=Review');
    fireEvent.click(await screen.findByRole('button', { name: 'Start due reviews' }));
    expect(await screen.findByRole('heading', { name: 'You’ve all caught up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nothing due to review' })).toBeDisabled();
});
it('shows the no-questions state when the server reports no published questions at start', async () => {
    mockSuggestedToday();
    vi.mocked(api.progress).mockResolvedValue(dueProgress() as never);
    vi.mocked(api.startSession).mockRejectedValue(new ApiError('No published questions are available for your assignment.', 409, undefined, 'PBE_COVERAGE_UNAVAILABLE'));
    mount('/student/study?seasonId=season&format=Pbe&mode=Review');
    fireEvent.click(await screen.findByRole('button', { name: 'Start due reviews' }));
    expect(await screen.findByRole('heading', { name: 'No PBE questions to review' })).toBeInTheDocument();
});
it('still starts rehearsal automatically without a review entry screen', async () => {
    mockSuggestedToday();
    vi.mocked(api.startSession).mockResolvedValue(saved.session);
    mount('/student/study?seasonId=season&format=Pbe&mode=Simulation');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('season', 'Simulation', expect.objectContaining({ clientStartId: expect.any(String) }), 'Pbe'));
    expect(screen.queryByRole('heading', { name: 'Protect what you’ve learned' })).not.toBeInTheDocument();
});
