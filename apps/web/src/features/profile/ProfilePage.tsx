import { lazy, Suspense, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AvatarKind, CharacterConfig, SaveCharacterProfile, ShareOptions } from '../../../shared/profileCharacter';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { trainingApi } from '../../api/training';
import { PatchDisplay, PlayerCard, nextLevelName } from '../../components/game/GameLayer';
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel, Select, useToast } from '../../components/ui';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { MasteryHonorArtwork } from './MasteryHonorArtwork';
import { ProfileSashStrip } from './ProfileSashStrip';
import { completeProfile, useMyProfile, useSaveCharacterProfile, type MyProfile } from './profile';
import { hairStyles, hairColors, type BodyType } from './character/hair';
import { PreviewModeToggle, type PreviewMode } from './character/PreviewModeToggle';
import { skinTones, eyeColors, backgrounds } from './character/appearance';
import { honorImageSrc } from './character/assets';
import type { ShareHistory, SharePatch } from './character/share';
import { requestTiltOnOpen } from './character/stageParallax';
import './profile.css';

const CharacterPreview = lazy(() => import('./character/CharacterPreview').then(module => ({ default: module.CharacterPreview })));
const AnimatedCharacterView = lazy(() => import('./character/AnimatedCharacterView').then(module => ({ default: module.AnimatedCharacterView })));
const CharacterFullscreen = lazy(() => import('./character/CharacterFullscreen').then(module => ({ default: module.CharacterFullscreen })));
const CharacterPortrait = lazy(() => import('./character/CharacterPreview').then(module => ({ default: module.CharacterPortrait })));
const ShareEditor = lazy(() => import('./character/ShareEditor').then(module => ({ default: module.ShareEditor })));
const pages = ['Profile', 'Character', 'Achievement patches', 'Share'] as const;
type Page = typeof pages[number];
type EditorDraft = Omit<SaveCharacterProfile, 'sharePatches'> & { history: ShareHistory };
function profileDraft(value: MyProfile): EditorDraft {
  const profile = completeProfile(value);
  return { version: profile.characterVersion, character: profile.character, avatarKind: profile.avatarKind, avatarHonorKey: profile.avatarHonorKey,
    shareOptions: profile.shareOptions, history: { past: [], present: profile.sharePatches, future: [] } };
}
function payload(draft: EditorDraft): SaveCharacterProfile {
  return { version: draft.version, character: draft.character, avatarKind: draft.avatarKind, avatarHonorKey: draft.avatarKind === 'honor' ? draft.avatarHonorKey : null,
    shareOptions: draft.shareOptions, sharePatches: draft.history.present };
}
function applyState<T>(next: SetStateAction<T>, current: T): T { return typeof next === 'function' ? (next as (previous: T) => T)(current) : next; }

export function ProfilePage() {
  const { me } = useAuth();
  const profile = useMyProfile();
  const refreshProfile = profile.refetch;
  useEffect(() => {
    // New activity evidence can publish after navigation. Only this page polls,
    // on a bounded schedule; refreshes must never replace an active draft.
    const timers = [2000, 5000, 10000, 20000].map(delay => window.setTimeout(() => {
      if (document.visibilityState === 'visible') void refreshProfile();
    }, delay));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [refreshProfile]);
  if (!profile.data || profile.data.userId !== me?.userId) return <div className="training-page profile-page"><PageHeader title="Your profile"/>{profile.isError
    ? <Panel><Notice tone="danger">Unable to load your profile.</Notice><Button variant="secondary" onClick={() => void refreshProfile()}>Try again</Button></Panel>
    : <LoadingState label="Loading your profile…"/>}</div>;
  return <ProfileEditor key={`${me.organizationId}:${me.userId}`} profile={profile.data} refreshing={profile.isFetching} refresh={refreshProfile}/>;
}
function ProfileEditor({ profile: value, refreshing, refresh }: { profile: MyProfile; refreshing: boolean; refresh: ReturnType<typeof useMyProfile>['refetch'] }) {
  const { me } = useAuth();
  const profile = completeProfile(value), save = useSaveCharacterProfile();
  // Identity header data: the same today() read HQ uses. Failure just leaves
  // the PlayerCard identity-only — the profile editor never blocks on it.
  const today = useQuery({ queryKey: ["training-today", undefined, me?.organizationId, me?.userId], queryFn: () => trainingApi.today(undefined), retry: false, staleTime: 60_000 });
  const [page, setPage] = useState<Page>('Profile');
  // Null follows fresh saved data. The first edit captures its revision, and
  // subsequent query refreshes update the collection without replacing it.
  const [session, setSession] = useState<EditorDraft | null>(null);
  const draft = session ?? profileDraft(profile), config = draft.character;
  const dirty = session !== null && JSON.stringify(payload(session)) !== JSON.stringify(payload(profileDraft(profile)));
  const rememberedHair = useRef<Record<BodyType, string>>({ male: 'curls', female: 'curly-bob', [config.bodyType]: config.style });
  const [renderError, setRenderError] = useState('');
  const toast = useToast();
  const [previewMode, setPreviewMode] = useState<PreviewMode>('still');
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const openFullscreen = () => {
    setFullscreenOpen(true);
    // The tap IS the iOS user gesture DeviceOrientationEvent.requestPermission()
    // needs: ask for motion access on the way in so tilting the phone drives
    // the parallax without a second tap. Silent after a denial (the fullscreen
    // "Enable tilt" button stays as the manual retry) and a no-op elsewhere.
    void requestTiltOnOpen();
  };
  const [rendererVersion, setRendererVersion] = useState(0);
  const [confirmReload, setConfirmReload] = useState(false), [reloadError, setReloadError] = useState('');
  const [reloading, setReloading] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  function navigate(next: Page) { setPage(next); requestAnimationFrame(() => heading.current?.focus()); }
  function change(update: (current: EditorDraft) => EditorDraft) {
    setSession(previous => {
      const current = previous ?? profileDraft(profile), next = update(current);
      return JSON.stringify(payload(current)) === JSON.stringify(payload(next)) ? previous : next;
    });
  }
  function update<K extends keyof CharacterConfig>(key: K, next: CharacterConfig[K]) { change(current => ({ ...current, character: { ...current.character, [key]: next } })); }
  function selectBody(bodyType: BodyType) {
    rememberedHair.current[config.bodyType] = config.style;
    change(current => ({ ...current, character: { ...current.character, bodyType, style: rememberedHair.current[bodyType] } }));
  }
  function chooseSlot(index: number, key: string | null) {
    if (key && (!profile.honors.some(honor => honor.key === key && honor.earnedAtUtc) || config.slots.some((slot, i) => slot === key && i !== index))) return;
    const slots: CharacterConfig['slots'] = [...config.slots]; slots[index] = key; update('slots', slots);
  }
  function chooseAvatar(avatarKind: AvatarKind, avatarHonorKey = draft.avatarHonorKey) {
    if (avatarKind === 'honor' && !profile.honors.some(honor => honor.key === avatarHonorKey && honor.earnedAtUtc)) return;
    change(current => ({ ...current, avatarKind, avatarHonorKey }));
  }
  function saveChanges() {
    if (!dirty || save.isPending) return;
    save.mutate(payload(draft), { onSuccess: () => { setSession(null); toast.success('Profile changes saved.'); } });
  }
  async function reloadSaved() {
    setReloadError(''); setReloading(true);
    const result = await refresh();
    setReloading(false);
    if (result.isError) { setReloadError(result.error.message || 'Unable to reload your profile. Your draft is still here.'); return; }
    setSession(null); save.reset(); setConfirmReload(false); toast.success('Saved profile reloaded.');
  }
  const earned = profile.honors.filter(honor => honor.earnedAtUtc);
  const earnedKeys = new Set(earned.map(honor => honor.key));
  // Gamification Phase 3 §5: cosmetic IDs mirror the worker's `<slot>:<value>` scheme.
  const cosmeticLock = (id: string) => profile.cosmeticLocks?.find(lock => lock.id === id)?.requirement ?? null;
  const FREE_DEFAULTS = { background: 'sunrise', hairColor: 'brown', style: { male: 'curls', female: 'curly-bob' } } as const;
  function lockedCosmeticIds(character: CharacterConfig): string[] {
    const ids = [`background:${character.background}`, `hair:${character.hairColor}`, `style:${character.style}`];
    if (character.slots[1]) ids.push('sash:2');
    if (character.slots[2]) ids.push('sash:3');
    return ids.filter(id => cosmeticLock(id));
  }
  const unavailable = config.slots.some(key => key !== null && !earnedKeys.has(key)) || draft.history.present.some(patch => !earnedKeys.has(patch.key))
    || (draft.avatarKind === 'honor' && !earnedKeys.has(draft.avatarHonorKey ?? '')) || (config.attire === 'coach' && !profile.canUseMasterGuide)
    || lockedCosmeticIds(config).length > 0;
  function removeUnavailable() {
    change(current => {
      const locked = new Set(lockedCosmeticIds(current.character));
      const bodyType = current.character.bodyType;
      return { ...current,
      avatarKind: current.avatarKind === 'honor' && !earnedKeys.has(current.avatarHonorKey ?? '') ? 'initials' : current.avatarKind,
      avatarHonorKey: current.avatarHonorKey && earnedKeys.has(current.avatarHonorKey) ? current.avatarHonorKey : null,
      character: { ...current.character, attire: current.character.attire === 'coach' && !profile.canUseMasterGuide ? 'student' : current.character.attire,
        background: locked.has(`background:${current.character.background}`) ? FREE_DEFAULTS.background : current.character.background,
        hairColor: locked.has(`hair:${current.character.hairColor}`) ? FREE_DEFAULTS.hairColor : current.character.hairColor,
        style: locked.has(`style:${current.character.style}`) ? FREE_DEFAULTS.style[bodyType] : current.character.style,
        slots: current.character.slots.map((key, index) => key && earnedKeys.has(key) && !locked.has(`sash:${index + 1}`) ? key : null) as CharacterConfig['slots'] },
      history: { past: [], present: current.history.present.filter(patch => earnedKeys.has(patch.key)), future: [] },
    };});
  }
  const slotSummary = <div className="slot-grid">{config.slots.map((key, index) => <div className="slot-option" key={index}>
    <span>Slot {index + 1}</span><span className="patch-preview">{key ? <MasteryHonorArtwork honorKey={key} size={110}/> : <span className="empty-ring" role="img" aria-label="Empty Achievement patch spot"/>}</span>
    <span className="help">{key ? profile.honors.find(honor => honor.key === key)?.title ?? '' : 'Empty'}</span>
  </div>)}</div>;
  const selectedHonor = profile.honors.find(honor => honor.key === draft.avatarHonorKey);
  const defaultHonor = selectedHonor?.earnedAtUtc ? selectedHonor.key : earned[0]?.key;
  const initials = profile.displayName.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() || '?';
  const collection: SharePatch[] = profile.honors.flatMap(honor => {
    const src = honorImageSrc(honor.key); return src ? [{ key: honor.key, title: honor.title, src, earnedAtUtc: honor.earnedAtUtc }] : [];
  });
  const saveError = save.isError ? save.error.message || 'Unable to save your profile. Your draft is still here.' : '';
  const conflict = save.isError && save.error instanceof ApiError && save.error.status === 409;
  const honorSlots = <div className="slot-grid">{config.slots.map((key, index) => { const sashLock = index === 0 ? null : cosmeticLock(`sash:${index + 1}`); return <div className="slot-option" key={index}>
    <span>Slot {index + 1}</span><span className="patch-preview">{key ? <MasteryHonorArtwork honorKey={key} size={110}/> : <span className="empty-ring" role="img" aria-label="Empty Achievement patch spot"/>}</span>
    {sashLock ? <p className="locked-reason">Locked · {sashLock}</p>
    : <Select aria-label={`Achievement patch in spot ${index + 1}`} value={key ?? ''} onChange={event => chooseSlot(index, event.target.value || null)}>
      <option value="">Empty · dotted</option>{profile.honors.map(honor => <option key={honor.key} value={honor.key} disabled={!honor.earnedAtUtc || config.slots.some((slot, i) => i !== index && slot === honor.key)}>{honor.title}{honor.earnedAtUtc ? '' : ' · Locked'}</option>)}
    </Select>}
  </div>; })}</div>;
  // Avatar dedupe (Nov 23): the character's face has exactly one sash home
  // per tab — the combined header's sash row, identical on all four tabs
  // (thumbnail, count, Edit + Share), with the sash strip as its collapsed
  // state on scroll. The first pass split the tabs (header thumbnail only
  // on Profile/Share; Character/Achievement patches relied on the stage
  // plus a mini sash card), but at phone widths the stage is display:none
  // and the mini card rendered as a SECOND sash row under the header —
  // the duplication the user reported. The mini card is gone and the
  // header is uniform; the desktop stage keeps its own figure caption.
  return <div className="training-page profile-page">
    <div className="profile-navigation"><span className="breadcrumb">Account <span aria-hidden="true">/</span> {page}</span><nav aria-label="Profile pages">{pages.map(item => <Button key={item} variant="ghost" aria-current={page === item ? 'page' : undefined} onClick={() => navigate(item)}>{item}</Button>)}</nav></div>
    <div ref={heading} tabIndex={-1} className="profile-heading"><PageHeader title={page === 'Profile' ? 'Your profile' : page === 'Character' ? 'Make your Pathfinder' : page === 'Achievement patches' ? 'Your displayed Achievement patches' : 'Share your character'} description={`${profile.displayName} · ${me?.organizationName ?? ''}`}/></div>
    {/* Combined header card (Nov 23): the player card and the sash card
        are one card — identity up top (level spelled out in text beside
        the name, no crest; no avatar slot, the HQ hero treatment) and
        the sash row beneath it. */}
    <PlayerCard
      className="profile-header-card"
      name={profile.displayName}
      avatar={null}
      xp={today.data ? { total: today.data.xp.total, xpIntoLevel: today.data.xp.xpIntoLevel, xpForNext: today.data.xp.xpForNext, nextLevelName: nextLevelName(today.data.xp.level), level: today.data.xp.level, levelName: today.data.xp.levelName } : null}
      streak={today.data?.streak?.current}
      streakState={today.data ? (today.data.streakNudge || today.data.streak?.state === "paused" ? "paused" : today.data.streak?.state === "active" ? "active" : "none") : undefined}
      seasonLabel={today.data?.seasonName || undefined}
    >
      <div className="profile-sash-row">
        <button type="button" className="profile-sash-thumb" onClick={openFullscreen} aria-label="View your character fullscreen"><CharacterPortrait appearance={config} onError={setRenderError}/></button>
        <p className="figure-caption">Sash · {config.slots.filter(Boolean).length} of 3 Achievement patches selected</p>
        <div className="figure-actions"><Button size="compact" onClick={() => navigate('Character')}>Edit</Button><Button size="compact" variant="secondary" onClick={() => navigate('Share')}>Share</Button></div>
      </div>
    </PlayerCard>
    <ProfileSashStrip appearance={config} name={profile.displayName} level={today.data ? `Level ${today.data.xp.level} · ${today.data.xp.levelName}` : null} onEdit={() => navigate('Character')} onShare={() => navigate('Share')} onOpenFullscreen={openFullscreen} onError={setRenderError}/>
    {unavailable && <Notice><p>Some selected Achievement patches, attire, or character options are no longer available to your account. Remove those choices to keep editing the rest of your profile.</p><Button variant="secondary" disabled={save.isPending || reloading} onClick={removeUnavailable}>Remove unavailable choices</Button></Notice>}
    {saveError && <Notice tone="danger"><p>{saveError}</p><p>Your changes are still here.{conflict ? ' Reload the saved profile before making a new save.' : ' Review your choices and try again.'}</p>{conflict && <Button variant="secondary" disabled={save.isPending} onClick={() => setConfirmReload(true)}>Reload saved profile</Button>}</Notice>}
    {renderError && <Notice tone="danger"><p>{renderError}</p><Button variant="secondary" onClick={() => { setRenderError(''); setRendererVersion(version => version + 1); }}>Retry artwork</Button></Notice>}
    <Suspense key={rendererVersion} fallback={<LoadingState label="Loading your character editor…"/>}>
      <fieldset className="profile-editor-controls" disabled={save.isPending || reloading}>
        {page === 'Share' && unavailable ? <Panel><h2>Update your choices before sharing</h2><p>Choose Remove unavailable choices above to remove restricted Achievement patches or attire. Your other appearance and card changes will stay in your draft.</p><Button variant="secondary" onClick={() => navigate('Character')}>Review character</Button></Panel>
          : page === 'Share' ? <ShareEditor config={config} profile={{ userName: me?.userName ?? '' }} collection={collection} history={draft.history}
          setHistory={next => change(current => ({ ...current, history: applyState(next, current.history) }))}
          options={draft.shareOptions} setOptions={(next: SetStateAction<ShareOptions>) => change(current => ({ ...current, shareOptions: applyState(next, current.shareOptions) }))}
          onEdit={() => navigate('Character')} onBrowseHonors={() => navigate('Achievement patches')} onError={setRenderError}/>
          : <div className={page === 'Profile' ? 'creator-layout creator-layout--solo' : 'creator-layout'}>
            {page !== 'Profile' && <Panel className="character-panel"><div className="character-panel-full"><PreviewModeToggle mode={previewMode} onChange={setPreviewMode}/>{previewMode === 'animated' ? <AnimatedCharacterView config={config} onError={setRenderError} onActivate={openFullscreen}/> : <CharacterPreview config={config} onError={setRenderError} onActivate={openFullscreen}/>}<p className="figure-caption">Sash · {config.slots.filter(Boolean).length} of 3 Achievement patches selected</p><div className="figure-actions"><Button onClick={() => navigate(page === 'Character' ? 'Profile' : 'Character')}>{page === 'Character' ? 'Back to profile' : 'Edit character'}</Button><Button variant="secondary" onClick={() => navigate('Share')}>Share character</Button></div></div></Panel>}
            <div className="editor-panels">
              {page === 'Profile' && <><Panel><h2>Profile image</h2><p className="help">Choose how you appear across Erudoza.</p><div className="avatar-options">
                <Button variant={draft.avatarKind === 'honor' ? 'primary' : 'secondary'} aria-label="Achievement patch" aria-pressed={draft.avatarKind === 'honor'} disabled={!defaultHonor} onClick={() => chooseAvatar('honor', defaultHonor)}>{defaultHonor ? <MasteryHonorArtwork honorKey={defaultHonor} size={145}/> : <span className="avatar-empty"><span className="empty-ring"/></span>}<span>Achievement patch</span></Button>
                <Button variant={draft.avatarKind === 'character' ? 'primary' : 'secondary'} aria-label="Character" aria-pressed={draft.avatarKind === 'character'} onClick={() => chooseAvatar('character')}><CharacterPortrait appearance={config} onError={setRenderError}/><span>Character</span></Button>
                <Button variant={draft.avatarKind === 'initials' ? 'primary' : 'secondary'} aria-label="Use initials" aria-pressed={draft.avatarKind === 'initials'} onClick={() => chooseAvatar('initials')}><span className="initials-preview">{initials}</span><span>Initials</span></Button>
              </div>{draft.avatarKind === 'honor' && <label className="avatar-select">Achievement patch profile image<Select value={draft.avatarHonorKey ?? ''} onChange={event => chooseAvatar('honor', event.target.value)}>{profile.honors.map(honor => <option key={honor.key} value={honor.key} disabled={!honor.earnedAtUtc}>{honor.title}{honor.earnedAtUtc ? '' : ' · Locked'}</option>)}</Select></label>}{!earned.length && <p className="help">Earn an Achievement patch to use it as your profile image.</p>}</Panel>
                <Panel><h2>Displayed Achievement patches</h2>{slotSummary}<Button className="wide-action" variant="secondary" onClick={() => navigate('Achievement patches')}>Manage Achievement patches</Button><p className="help">Your profile image and displayed Achievement patches are separate.</p></Panel>
                {me?.kind === "Adult" && (me?.role === "Owner" || me?.role === "Admin") && <Panel><h2>My study books</h2><p className="help">Choose the passages you study as a participant.</p><LinkButton variant="secondary" to="/student/assignments">Choose study books</LinkButton></Panel>}</>}
              {page === 'Character' && <><Panel><h2>Appearance</h2>
                <fieldset><legend>Body type</legend><div className="choice-row">{(['male', 'female'] as const).map(body => <Button key={body} variant={config.bodyType === body ? 'primary' : 'secondary'} aria-pressed={config.bodyType === body} onClick={() => selectBody(body)}>{body === 'male' ? 'Male' : 'Female'}</Button>)}</div></fieldset>
                <fieldset><legend>Skin tone</legend><div className="choice-row">{skinTones.map(tone => <Button key={tone.key} variant={config.skin === tone.key ? 'primary' : 'secondary'} aria-pressed={config.skin === tone.key} onClick={() => update('skin', tone.key)}><span className="color-swatch" style={{ background: tone.color }}/>{tone.name}</Button>)}</div></fieldset>
                <fieldset><legend>{config.bodyType === 'male' ? 'Male hairstyles' : 'Female hairstyles'}</legend><div className="style-options">{hairStyles[config.bodyType].map(hair => { const lock = cosmeticLock(`style:${hair.key}`); return <Button key={hair.key} variant={config.style === hair.key ? 'primary' : 'secondary'} aria-pressed={config.style === hair.key} disabled={!!lock} title={lock ?? undefined} onClick={() => update('style', hair.key)}><CharacterPortrait appearance={{ ...config, style: hair.key }} className="hair-thumbnail" onError={setRenderError}/>{hair.name}{lock && <small className="locked-reason">Locked · {lock}</small>}</Button>; })}</div></fieldset>
                <fieldset><legend>Hair color</legend><div className="choice-row hair-colors">{hairColors.map(hair => { const lock = cosmeticLock(`hair:${hair.key}`); return <Button key={hair.key} variant={config.hairColor === hair.key ? 'primary' : 'secondary'} aria-pressed={config.hairColor === hair.key} disabled={!!lock} title={lock ?? undefined} onClick={() => update('hairColor', hair.key)}><span className="color-swatch" style={{ background: hair.color }}/>{hair.name}{lock && <small className="locked-reason">Locked · {lock}</small>}</Button>; })}</div></fieldset>
                <fieldset><legend>Eye color</legend><div className="choice-row">{eyeColors.map(eyes => <Button key={eyes.key} variant={config.eyes === eyes.key ? 'primary' : 'secondary'} aria-pressed={config.eyes === eyes.key} onClick={() => update('eyes', eyes.key)}><span className="color-swatch" style={{ background: eyes.color }}/>{eyes.name}</Button>)}</div></fieldset>
              </Panel><Panel><h2>Attire</h2><div className="choice-row"><Button variant={config.attire === 'student' ? 'primary' : 'secondary'} aria-pressed={config.attire === 'student'} onClick={() => update('attire', 'student')}>Pathfinder</Button><Button variant={config.attire === 'coach' ? 'primary' : 'secondary'} aria-pressed={config.attire === 'coach'} disabled={!profile.canUseMasterGuide} onClick={() => update('attire', 'coach')}>Master Guide · coach</Button></div>{!profile.canUseMasterGuide && <p className="help">Master Guide attire is available to coaches.</p>}</Panel>
                <Panel><h2>Background</h2><div className="background-options">{backgrounds.map(background => { const lock = cosmeticLock(`background:${background.key}`); return <Button key={background.key} variant={config.background === background.key ? 'primary' : 'secondary'} aria-pressed={config.background === background.key} disabled={!!lock} title={lock ?? undefined} onClick={() => update('background', background.key)}><img src={background.thumbnail} alt=""/>{background.name}{lock && <small className="locked-reason">Locked · {lock}</small>}</Button>; })}</div></Panel></>}
              {page === 'Achievement patches' && <><Panel><h2>Three spots on your sash</h2><p className="help">Slots run from shoulder to waist. Choose an earned Achievement patch for each spot, or leave it dotted.</p>{honorSlots}<Button variant="ghost" onClick={() => update('slots', [null, null, null])}>Clear all three spots</Button></Panel>
                <Panel><div className="profile-collection-heading"><h2>Achievement patch collection</h2><Button variant="secondary" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing patches…' : 'Refresh patches'}</Button></div><p className="help">{earned.length} of {profile.honors.length} unlocked. Earn an Achievement patch to wear it.</p>
                  {(['Scripture', 'Team Practice', 'Simulation'] as const).filter(category => profile.honors.some(honor => honor.category === category)).map(category => <section key={category} className="profile-category" aria-label={`${category} profile images`}><h3>{category}</h3><div className="honor-patch-grid">{profile.honors.filter(honor => honor.category === category).map(honor => {
                    const selected = draft.avatarKind === 'honor' && draft.avatarHonorKey === honor.key;
                    return <PatchDisplay key={honor.key}
                      title={honor.title}
                      artwork={<MasteryHonorArtwork honorKey={honor.key} size={208} muted={!honor.earnedAtUtc} />}
                      earnedAtUtc={honor.earnedAtUtc}
                      status={<><Badge tone={honor.earnedAtUtc ? 'info' : 'neutral'}>{honor.earnedAtUtc ? 'Unlocked' : 'Locked'}</Badge>{config.slots.includes(honor.key) && <Badge>On sash</Badge>}{selected && <Badge tone="success">Profile image</Badge>}</>}
                      detail={close => <><MasteryHonorArtwork honorKey={honor.key} size={192} muted={!honor.earnedAtUtc} /><p>{honor.category}</p><h3>How to unlock</h3><p>{honor.requirement}</p>{selected ? <p>Worn as your profile image.</p> : honor.earnedAtUtc ? <Button variant="secondary" aria-label={`Use ${honor.title} as profile image`} onClick={() => { chooseAvatar('honor', honor.key); close(); }}>Use as profile image</Button> : <p>This patch is locked. Meet every requirement to unlock it for your profile.</p>}</>}
                    />;
                  })}</div></section>)}<p className="help">Practice milestones stay in your history and do not provide profile images.</p>
                </Panel></>}
            </div>
          </div>}
        {fullscreenOpen && <CharacterFullscreen config={config} mode={previewMode} onModeChange={setPreviewMode} onClose={() => setFullscreenOpen(false)} onError={setRenderError}/>}
      </fieldset>
    </Suspense>
    <Panel className="profile-save-actions"><p>{dirty ? 'You have unsaved changes.' : 'Your saved profile is up to date.'}</p><Button variant="secondary" disabled={!dirty || save.isPending || reloading} onClick={() => setConfirmReload(true)}>Discard changes</Button><Button disabled={!dirty || save.isPending || reloading} onClick={saveChanges}>{save.isPending ? 'Saving…' : 'Save changes'}</Button></Panel>
    {confirmReload && <ConfirmationDialog title="Reload your saved profile?" description="This replaces your unsaved appearance, Achievement patch and share changes with the latest saved profile." confirmLabel="Reload saved profile" pending={reloading} pendingLabel="Reloading…" error={reloadError} onCancel={() => setConfirmReload(false)} onConfirm={() => void reloadSaved()}/>}
  </div>;
}
