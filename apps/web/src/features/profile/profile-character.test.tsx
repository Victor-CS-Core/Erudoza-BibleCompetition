import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfileFields, SaveCharacterProfile } from '../../../shared/profileCharacter';
import { ProfilePage } from './ProfilePage';
import { ProfileAvatar } from './ProfileAvatar';
import { profileApi, type MyProfile } from './profile';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ me: { userId: 'self', organizationId: 'academy', organizationName: 'Academy', displayName: 'Anna Reed', userName: 'anna.reed', kind: 'Student', role: 'Student' } }) }));
const base: MyProfile & CharacterProfileFields = {
  userId: 'self', displayName: 'Anna Reed', avatarHonorKey: null,
  avatarKind: 'initials', characterVersion: 3, canUseMasterGuide: false,
  character: { bodyType: 'male', style: 'curls', hairColor: 'brown', skin: 'medium', eyes: 'brown', attire: 'student', background: 'sunrise', slots: [null, null, null] },
  shareOptions: { showName: true, showBrand: true, showQR: true }, sharePatches: [],
  honors: [
    { key: 'solo:exact-recall', title: 'Exact Recall', category: 'Scripture', requirement: 'Reach 90 on 12 distinct passages.', ruleVersion: 'mastery-v1', earnedAtUtc: '2026-09-11T12:00:00Z' },
    { key: 'solo:full-coverage', title: 'Full Coverage', category: 'Scripture', requirement: 'Master all 30 assigned passages.', ruleVersion: 'mastery-v1', earnedAtUtc: null },
  ],
};
function mount(value = structuredClone(base)) {
  vi.spyOn(profileApi, 'me').mockResolvedValue(value);
  vi.spyOn(profileApi, 'identities').mockResolvedValue([{ userId: 'self', avatarHonorKey: null }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><ProfileAvatar userId="self" displayName="Anna Reed"/><ProfilePage/></QueryClientProvider>);
  return { ...view, client };
}
async function page(name: string) {
  const nav = await screen.findByRole('navigation', { name: 'Profile pages' });
  fireEvent.click(within(nav).getByRole('button', { name }));
  await waitFor(() => expect(screen.queryByText('Loading your character editor…')).not.toBeInTheDocument());
}
beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('production character profile', () => {
  it('provides all four account pages and blocks unearned Honors and Student Master Guide', async () => {
    mount();
    const nav = await screen.findByRole('navigation', { name: 'Profile pages' });
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['Profile', 'Character', 'Honors', 'Share']);
    await page('Character');
    expect(screen.getByRole('button', { name: 'Master Guide · coach' })).toBeDisabled();
    await page('Honors');
    expect(screen.getByRole('button', { name: 'Use Full Coverage as profile image' })).toBeDisabled();
    expect(screen.getAllByRole('option', { name: /Full Coverage/ })[0]).toBeDisabled();
    expect(screen.getAllByLabelText('Empty Honor spot')).toHaveLength(3);
  });

  it('saves the real account appearance and separate avatar only on explicit Save changes', async () => {
    let received: SaveCharacterProfile | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      received = JSON.parse(String(init.body)) as SaveCharacterProfile;
      return new Response(JSON.stringify({ ...base, ...received, characterVersion: 4 }), { status: 200 });
    }));
    const view = mount();
    await page('Character');
    fireEvent.click(screen.getByRole('button', { name: 'Female' }));
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    await page('Profile');
    fireEvent.click(screen.getByRole('button', { name: 'Character', pressed: false }));
    expect(received).toBeUndefined();
    expect(view.container.querySelector('[data-profile-kind="character"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Profile changes saved.')).toBeVisible();
    expect(received).toMatchObject({ version: 3, avatarKind: 'character', avatarHonorKey: null, character: { bodyType: 'female', style: 'curly-bob', hairColor: 'red', slots: [null, null, null] } });
    await waitFor(() => expect(view.container.querySelector('[data-profile-kind="character"]')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('keeps edited appearance and its original revision when unlocks refresh in the background', async () => {
    const { client } = mount();
    await page('Character');
    fireEvent.click(screen.getByRole('button', { name: 'Female' }));
    await act(async () => { client.setQueryData(['profile', 'academy', 'self'], { ...base, characterVersion: 4, honors: base.honors.map(honor => ({ ...honor, earnedAtUtc: '2026-09-13T00:00:00Z' })) }); });
    expect(screen.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true');
    await page('Honors');
    expect(screen.getByRole('button', { name: 'Use Full Coverage as profile image' })).toBeEnabled();
    let received: SaveCharacterProfile | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => { received = JSON.parse(String(init.body)); return new Response(JSON.stringify({ detail: 'This profile changed in another session.' }), { status: 409 }); }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This profile changed in another session.');
    expect(received?.version).toBe(3);
    await page('Character');
    expect(screen.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Reload saved profile' })).toBeVisible();
  });

  it('remembers a hairstyle for each body while navigating between editor pages', async () => {
    mount();
    await page('Character');
    const maleStyles = screen.getByRole('group', { name: 'Male hairstyles' });
    fireEvent.click(within(maleStyles).getAllByRole('button')[1]);
    const chosen = within(maleStyles).getAllByRole('button')[1].textContent!;
    fireEvent.click(screen.getByRole('button', { name: 'Female' }));
    await page('Profile');
    await page('Character');
    fireEvent.click(screen.getByRole('button', { name: 'Male' }));
    expect(screen.getByRole('button', { name: chosen })).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows Master Guide based on server eligibility even while the account uses Student Mode', async () => {
    mount({ ...structuredClone(base), canUseMasterGuide: true });
    await page('Character');
    const guide = screen.getByRole('button', { name: 'Master Guide · coach' });
    expect(guide).toBeEnabled();
    fireEvent.click(guide);
    expect(guide).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a clean editor current when selecting the already selected choice before a refresh', async () => {
    const { client } = mount();
    await page('Character');
    fireEvent.click(screen.getByRole('button', { name: 'Male' }));
    await act(async () => { client.setQueryData(['profile', 'academy', 'self'], { ...base, characterVersion: 4, character: { ...base.character, bodyType: 'female', style: 'low-bun' } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('can remove newly unavailable Honor choices without discarding the rest of the draft', async () => {
    const saved = { ...structuredClone(base), avatarKind: 'honor' as const, avatarHonorKey: 'solo:exact-recall', sharePatches: [{ key: 'solo:exact-recall', x: 230, y: 1080, size: 216, rotation: 0 }] };
    saved.character.slots = ['solo:exact-recall', null, null];
    const { client } = mount(saved);
    await page('Character');
    fireEvent.click(screen.getByRole('button', { name: 'Female' }));
    await act(async () => { client.setQueryData(['profile', 'academy', 'self'], { ...base, honors: base.honors.map(honor => ({ ...honor, earnedAtUtc: null })) }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove unavailable choices' }));
    expect(screen.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true');
    let received: SaveCharacterProfile | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => { received = JSON.parse(String(init.body)) as SaveCharacterProfile; return new Response(JSON.stringify({ ...saved, ...received, characterVersion: 4 }), { status: 200 }); }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Profile changes saved.');
    expect(received).toMatchObject({ version: 3, avatarKind: 'initials', avatarHonorKey: null, character: { bodyType: 'female', slots: [null, null, null] }, sharePatches: [] });
  });

  it.each(['sash Honor', 'coach attire'])('blocks sharing a draft after its %s becomes unavailable, and resumes after recovery', async choice => {
    const saved = structuredClone(base);
    if (choice === 'sash Honor') saved.character.slots = ['solo:exact-recall', null, null];
    else { saved.canUseMasterGuide = true; saved.character.attire = 'coach'; }
    const { client } = mount(saved);
    await page('Character');
    fireEvent.click(screen.getByRole('button', { name: 'Female' }));
    await page('Share');
    expect(screen.getByRole('button', { name: 'Download image' })).toBeInTheDocument();
    await act(async () => { client.setQueryData(['profile', 'academy', 'self'], { ...base, honors: base.honors.map(honor => ({ ...honor, earnedAtUtc: null })) }); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Download image' })).not.toBeInTheDocument());
    expect(screen.queryByRole('switch', { name: 'Your username' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Update your choices before sharing' })).toBeVisible();
    await page('Character');
    expect(screen.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true');
    await page('Share');
    fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable choices' }));
    expect(await screen.findByRole('button', { name: 'Download image' })).toBeInTheDocument();
    await page('Character');
    expect(screen.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pathfinder' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('swaps the character preview between the 2D render and the animated 3D view in place', async () => {
    mount();
    await page('Character');
    const toggle = screen.getByRole('group', { name: 'Preview style' });
    expect(within(toggle).getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(toggle).getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(toggle).getByRole('button', { name: '3D' }));
    // The 3D view lazy-loads, so the panel remounts once it resolves; re-query.
    const reloaded = await screen.findByRole('group', { name: 'Preview style' });
    expect(within(reloaded).getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(reloaded).getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'false');
    // The animated canvas takes the same spot in the character panel.
    const panel = reloaded.closest('.character-panel') as HTMLElement;
    expect(within(panel).getByRole('img', { name: /^Animated preview/ })).toBeInTheDocument();
    fireEvent.click(within(reloaded).getByRole('button', { name: '2D' }));
    const back = await screen.findByRole('group', { name: 'Preview style' });
    expect(within(back).getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(back.closest('.character-panel') as HTMLElement).queryByRole('img', { name: /^Animated preview/ })).not.toBeInTheDocument();
  });

  it('backs the character preview with a blurred copy of the selected background in both preview modes', async () => {
    mount();
    await page('Character');
    const panelOf = () => screen.getByRole('group', { name: 'Preview style' }).closest('.character-panel') as HTMLElement;
    const fillSrc = () => panelOf().querySelector('.character-stage-fill')?.getAttribute('src');
    // 2D still view: the blurred backdrop matches the selected background.
    expect(fillSrc()).toContain('sunrise');
    // Changing the background follows the backdrop.
    fireEvent.click(screen.getByRole('button', { name: 'Woodland Basecamp' }));
    expect(fillSrc()).toContain('basecamp');
    // 3D animated view keeps the same blurred backdrop behind the canvas.
    fireEvent.click(within(screen.getByRole('group', { name: 'Preview style' })).getByRole('button', { name: '3D' }));
    const reloaded = await screen.findByRole('group', { name: 'Preview style' });
    expect(within(reloaded).getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
    expect(fillSrc()).toContain('basecamp');
  });
});
