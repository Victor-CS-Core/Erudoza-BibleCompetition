import { lazy, Suspense, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { AvatarKind, CharacterConfig, SaveCharacterProfile, ShareOptions } from '../../../shared/profileCharacter';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { Badge, Button, LoadingState, Notice, PageHeader, Panel, Select } from '../../components/ui';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { MasteryHonorArtwork } from './MasteryHonorArtwork';
import { completeProfile, useMyProfile, useSaveCharacterProfile, type MyProfile } from './profile';
import { hairStyles, hairColors, type BodyType } from './character/hair';
import { skinTones, eyeColors, backgrounds } from './character/appearance';
import { honorImageSrc } from './character/assets';
import type { ShareHistory, SharePatch } from './character/share';
import './profile.css';

const CharacterPreview = lazy(() => import('./character/CharacterPreview').then(module => ({ default: module.CharacterPreview })));
const CharacterPortrait = lazy(() => import('./character/CharacterPreview').then(module => ({ default: module.CharacterPortrait })));
const ShareEditor = lazy(() => import('./character/ShareEditor').then(module => ({ default: module.ShareEditor })));
const pages = ['Profile', 'Character', 'Honors', 'Share'] as const;
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
  const [page, setPage] = useState<Page>('Profile');
  // Null follows fresh saved data. The first edit captures its revision, and
  // subsequent query refreshes update the collection without replacing it.
  const [session, setSession] = useState<EditorDraft | null>(null);
  const draft = session ?? profileDraft(profile), config = draft.character;
  const dirty = session !== null && JSON.stringify(payload(session)) !== JSON.stringify(payload(profileDraft(profile)));
  const rememberedHair = useRef<Record<BodyType, string>>({ male: 'curls', female: 'curly-bob', [config.bodyType]: config.style });
  const [status, setStatus] = useState(''), [renderError, setRenderError] = useState('');
  const [rendererVersion, setRendererVersion] = useState(0);
  const [confirmReload, setConfirmReload] = useState(false), [reloadError, setReloadError] = useState('');
  const [reloading, setReloading] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  function navigate(next: Page) { setPage(next); requestAnimationFrame(() => heading.current?.focus()); }
  function change(update: (current: EditorDraft) => EditorDraft) {
    setStatus('');
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
    save.mutate(payload(draft), { onSuccess: () => { setSession(null); setStatus('Profile changes saved.'); } });
  }
  async function reloadSaved() {
    setReloadError(''); setReloading(true);
    const result = await refresh();
    setReloading(false);
    if (result.isError) { setReloadError(result.error.message || 'Unable to reload your profile. Your draft is still here.'); return; }
    setSession(null); save.reset(); setConfirmReload(false); setStatus('Saved profile reloaded.');
  }
  const earned = profile.honors.filter(honor => honor.earnedAtUtc);
  const earnedKeys = new Set(earned.map(honor => honor.key));
  const unavailable = config.slots.some(key => key !== null && !earnedKeys.has(key)) || draft.history.present.some(patch => !earnedKeys.has(patch.key))
    || (draft.avatarKind === 'honor' && !earnedKeys.has(draft.avatarHonorKey ?? '')) || (config.attire === 'coach' && !profile.canUseMasterGuide);
  function removeUnavailable() {
    change(current => ({ ...current,
      avatarKind: current.avatarKind === 'honor' && !earnedKeys.has(current.avatarHonorKey ?? '') ? 'initials' : current.avatarKind,
      avatarHonorKey: current.avatarHonorKey && earnedKeys.has(current.avatarHonorKey) ? current.avatarHonorKey : null,
      character: { ...current.character, attire: current.character.attire === 'coach' && !profile.canUseMasterGuide ? 'student' : current.character.attire,
        slots: current.character.slots.map(key => key && earnedKeys.has(key) ? key : null) as CharacterConfig['slots'] },
      history: { past: [], present: current.history.present.filter(patch => earnedKeys.has(patch.key)), future: [] },
    }));
  }
  const selectedHonor = profile.honors.find(honor => honor.key === draft.avatarHonorKey);
  const defaultHonor = selectedHonor?.earnedAtUtc ? selectedHonor.key : earned[0]?.key;
  const initials = profile.displayName.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() || '?';
  const collection: SharePatch[] = profile.honors.flatMap(honor => {
    const src = honorImageSrc(honor.key); return src ? [{ key: honor.key, title: honor.title, src, earnedAtUtc: honor.earnedAtUtc }] : [];
  });
  const saveError = save.isError ? save.error.message || 'Unable to save your profile. Your draft is still here.' : '';
  const conflict = save.isError && save.error instanceof ApiError && save.error.status === 409;
  const honorSlots = <div className="slot-grid">{config.slots.map((key, index) => <div className="slot-option" key={index}>
    <span>Slot {index + 1}</span><span className="patch-preview">{key ? <MasteryHonorArtwork honorKey={key} size={110}/> : <span className="empty-ring" role="img" aria-label="Empty Honor spot"/>}</span>
    {page === 'Honors' ? <Select aria-label={`Honor in spot ${index + 1}`} value={key ?? ''} onChange={event => chooseSlot(index, event.target.value || null)}>
      <option value="">Empty · dotted</option>{profile.honors.map(honor => <option key={honor.key} value={honor.key} disabled={!honor.earnedAtUtc || config.slots.some((slot, i) => i !== index && slot === honor.key)}>{honor.title}{honor.earnedAtUtc ? '' : ' · Locked'}</option>)}
    </Select> : key ? <Button variant="secondary" size="compact" aria-label={`Remove Honor from slot ${index + 1}`} onClick={() => chooseSlot(index, null)}>Remove</Button> : <Button variant="secondary" size="compact" onClick={() => navigate('Honors')}>Choose Honor</Button>}
  </div>)}</div>;
  return <div className="training-page profile-page">
    <div className="profile-navigation"><span className="breadcrumb">Account <span aria-hidden="true">/</span> {page}</span><nav aria-label="Profile pages">{pages.map(item => <Button key={item} variant="ghost" aria-current={page === item ? 'page' : undefined} onClick={() => navigate(item)}>{item}</Button>)}</nav></div>
    <div ref={heading} tabIndex={-1} className="profile-heading"><PageHeader title={page === 'Profile' ? 'Your profile' : page === 'Character' ? 'Make your Pathfinder' : page === 'Honors' ? 'Your displayed Honors' : 'Share your character'} description={`${profile.displayName} · ${me?.organizationName ?? ''}`}/></div>
    {status && <Notice tone="success">{status}</Notice>}
    {unavailable && <Notice><p>Some selected Honors or attire are no longer available to your account. Remove those choices to keep editing the rest of your profile.</p><Button variant="secondary" disabled={save.isPending || reloading} onClick={removeUnavailable}>Remove unavailable choices</Button></Notice>}
    {saveError && <Notice tone="danger"><p>{saveError}</p><p>Your changes are still here.{conflict ? ' Reload the saved profile before making a new save.' : ' Review your choices and try again.'}</p>{conflict && <Button variant="secondary" disabled={save.isPending} onClick={() => setConfirmReload(true)}>Reload saved profile</Button>}</Notice>}
    {renderError && <Notice tone="danger"><p>{renderError}</p><Button variant="secondary" onClick={() => { setRenderError(''); setRendererVersion(version => version + 1); }}>Retry artwork</Button></Notice>}
    <Suspense key={rendererVersion} fallback={<LoadingState label="Loading your character editor…"/>}>
      <fieldset className="profile-editor-controls" disabled={save.isPending || reloading}>
        {page === 'Share' && unavailable ? <Panel><h2>Update your choices before sharing</h2><p>Choose Remove unavailable choices above to remove restricted Honors or attire. Your other appearance and card changes will stay in your draft.</p><Button variant="secondary" onClick={() => navigate('Character')}>Review character</Button></Panel>
          : page === 'Share' ? <ShareEditor config={config} profile={{ userName: me?.userName ?? '' }} collection={collection} history={draft.history}
          setHistory={next => change(current => ({ ...current, history: applyState(next, current.history) }))}
          options={draft.shareOptions} setOptions={(next: SetStateAction<ShareOptions>) => change(current => ({ ...current, shareOptions: applyState(next, current.shareOptions) }))}
          onBackground={background => update('background', background)} onEdit={() => navigate('Character')} onError={setRenderError}/>
          : <div className="creator-layout">
            <Panel className="character-panel"><CharacterPreview config={config} onError={setRenderError}/><p className="figure-caption">Sash · {config.slots.filter(Boolean).length} of 3 Honors selected</p><div className="figure-actions"><Button onClick={() => navigate(page === 'Character' ? 'Profile' : 'Character')}>{page === 'Character' ? 'Back to profile' : 'Edit character'}</Button><Button variant="secondary" onClick={() => navigate('Share')}>Share character</Button></div></Panel>
            <div className="editor-panels">
              {page === 'Profile' && <><Panel><h2>Profile image</h2><p className="help">Choose how you appear across Erudoza.</p><div className="avatar-options">
                <Button variant={draft.avatarKind === 'honor' ? 'primary' : 'secondary'} aria-label="Honor" aria-pressed={draft.avatarKind === 'honor'} disabled={!defaultHonor} onClick={() => chooseAvatar('honor', defaultHonor)}>{defaultHonor ? <MasteryHonorArtwork honorKey={defaultHonor} size={145}/> : <span className="avatar-empty"><span className="empty-ring"/></span>}<span>Honor</span></Button>
                <Button variant={draft.avatarKind === 'character' ? 'primary' : 'secondary'} aria-label="Character" aria-pressed={draft.avatarKind === 'character'} onClick={() => chooseAvatar('character')}><CharacterPortrait appearance={config} onError={setRenderError}/><span>Character</span></Button>
                <Button variant={draft.avatarKind === 'initials' ? 'primary' : 'secondary'} aria-label="Use initials" aria-pressed={draft.avatarKind === 'initials'} onClick={() => chooseAvatar('initials')}><span className="initials-preview">{initials}</span><span>Initials</span></Button>
              </div>{draft.avatarKind === 'honor' && <label className="avatar-select">Honor profile image<Select value={draft.avatarHonorKey ?? ''} onChange={event => chooseAvatar('honor', event.target.value)}>{profile.honors.map(honor => <option key={honor.key} value={honor.key} disabled={!honor.earnedAtUtc}>{honor.title}{honor.earnedAtUtc ? '' : ' · Locked'}</option>)}</Select></label>}{!earned.length && <p className="help">Earn an Honor to use its patch as your profile image.</p>}</Panel>
                <Panel><h2>Displayed Honors</h2>{honorSlots}<Button className="wide-action" variant="secondary" onClick={() => navigate('Honors')}>Manage Honors</Button><p className="help">Your profile image and displayed Honors are separate.</p></Panel></>}
              {page === 'Character' && <><Panel><h2>Appearance</h2>
                <fieldset><legend>Body type</legend><div className="choice-row">{(['male', 'female'] as const).map(body => <Button key={body} variant={config.bodyType === body ? 'primary' : 'secondary'} aria-pressed={config.bodyType === body} onClick={() => selectBody(body)}>{body === 'male' ? 'Male' : 'Female'}</Button>)}</div></fieldset>
                <fieldset><legend>Skin tone</legend><div className="choice-row">{skinTones.map(tone => <Button key={tone.key} variant={config.skin === tone.key ? 'primary' : 'secondary'} aria-pressed={config.skin === tone.key} onClick={() => update('skin', tone.key)}><span className="color-swatch" style={{ background: tone.color }}/>{tone.name}</Button>)}</div></fieldset>
                <fieldset><legend>{config.bodyType === 'male' ? 'Male hairstyles' : 'Female hairstyles'}</legend><div className="style-options">{hairStyles[config.bodyType].map(hair => <Button key={hair.key} variant={config.style === hair.key ? 'primary' : 'secondary'} aria-pressed={config.style === hair.key} onClick={() => update('style', hair.key)}><CharacterPortrait appearance={{ ...config, style: hair.key }} className="hair-thumbnail" onError={setRenderError}/>{hair.name}</Button>)}</div></fieldset>
                <fieldset><legend>Hair color</legend><div className="choice-row hair-colors">{hairColors.map(hair => <Button key={hair.key} variant={config.hairColor === hair.key ? 'primary' : 'secondary'} aria-pressed={config.hairColor === hair.key} onClick={() => update('hairColor', hair.key)}><span className="color-swatch" style={{ background: hair.color }}/>{hair.name}</Button>)}</div></fieldset>
                <fieldset><legend>Eye color</legend><div className="choice-row">{eyeColors.map(eyes => <Button key={eyes.key} variant={config.eyes === eyes.key ? 'primary' : 'secondary'} aria-pressed={config.eyes === eyes.key} onClick={() => update('eyes', eyes.key)}><span className="color-swatch" style={{ background: eyes.color }}/>{eyes.name}</Button>)}</div></fieldset>
              </Panel><Panel><h2>Attire</h2><div className="choice-row"><Button variant={config.attire === 'student' ? 'primary' : 'secondary'} aria-pressed={config.attire === 'student'} onClick={() => update('attire', 'student')}>Pathfinder</Button><Button variant={config.attire === 'coach' ? 'primary' : 'secondary'} aria-pressed={config.attire === 'coach'} disabled={!profile.canUseMasterGuide} onClick={() => update('attire', 'coach')}>Master Guide · coach</Button></div>{!profile.canUseMasterGuide && <p className="help">Master Guide attire is available to coaches.</p>}</Panel>
                <Panel><h2>Background</h2><div className="background-options">{backgrounds.map(background => <Button key={background.key} variant={config.background === background.key ? 'primary' : 'secondary'} aria-pressed={config.background === background.key} onClick={() => update('background', background.key)}><img src={background.thumbnail} alt=""/>{background.name}</Button>)}</div></Panel></>}
              {page === 'Honors' && <><Panel><h2>Three spots on your sash</h2><p className="help">Slots run from shoulder to waist. Choose an earned Honor for each spot, or leave it dotted.</p>{honorSlots}<Button variant="ghost" onClick={() => update('slots', [null, null, null])}>Clear all three spots</Button></Panel>
                <Panel><div className="profile-collection-heading"><h2>Honor collection</h2><Button variant="secondary" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing patches…' : 'Refresh patches'}</Button></div><p className="help">{earned.length} of {profile.honors.length} unlocked. Earn an Honor to wear its patch.</p>
                  {(['Scripture', 'Team Practice', 'Simulation'] as const).filter(category => profile.honors.some(honor => honor.category === category)).map(category => <section key={category} className="profile-category" aria-label={`${category} profile images`}><h3>{category}</h3><div className="honor-collection">{profile.honors.filter(honor => honor.category === category).map(honor => {
                    const selected = draft.avatarKind === 'honor' && draft.avatarHonorKey === honor.key;
                    return <div key={honor.key} className="profile-honor-option" data-selected={selected || undefined}><MasteryHonorArtwork honorKey={honor.key} size={80} muted={!honor.earnedAtUtc}/><div><h3>{honor.title}</h3><div className="profile-honor-badges"><Badge tone={honor.earnedAtUtc ? 'info' : 'neutral'}>{honor.earnedAtUtc ? 'Unlocked' : 'Locked'}</Badge>{config.slots.includes(honor.key) && <Badge>On sash</Badge>}{selected && <Badge tone="success">Profile image</Badge>}</div><p>{honor.requirement}</p><Button variant="secondary" size="compact" disabled={!honor.earnedAtUtc || selected} aria-label={`${selected ? 'Wearing' : 'Use'} ${honor.title} as profile image`} onClick={() => chooseAvatar('honor', honor.key)}>{selected ? 'Selected profile image' : honor.earnedAtUtc ? 'Use profile image' : 'Earn to unlock'}</Button></div></div>;
                  })}</div></section>)}<p className="help">Practice milestones stay in your history and do not provide profile images.</p>
                </Panel></>}
            </div>
          </div>}
      </fieldset>
    </Suspense>
    <Panel className="profile-save-actions"><p>{dirty ? 'You have unsaved changes.' : 'Your saved profile is up to date.'}</p><Button variant="secondary" disabled={!dirty || save.isPending || reloading} onClick={() => setConfirmReload(true)}>Discard changes</Button><Button disabled={!dirty || save.isPending || reloading} onClick={saveChanges}>{save.isPending ? 'Saving…' : 'Save changes'}</Button></Panel>
    {confirmReload && <ConfirmationDialog title="Reload your saved profile?" description="This replaces your unsaved appearance, Honor and share changes with the latest saved profile." confirmLabel="Reload saved profile" pending={reloading} pendingLabel="Reloading…" error={reloadError} onCancel={() => setConfirmReload(false)} onConfirm={() => void reloadSaved()}/>}
  </div>;
}
