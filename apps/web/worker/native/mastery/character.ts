import type { AvatarKind, CharacterAppearance, CharacterConfig, CharacterProfileFields, SaveCharacterProfile, ShareOptions, SharePlacement } from '../../../shared/profileCharacter';
import { HttpError } from '../types';
import { honorCatalog, isHonorKey } from './catalog';

export type CharacterState = Omit<SaveCharacterProfile, 'version' | 'avatarHonorKey'> & { userId: string; operationId?: string };
const styles = {
  male: ['curls', 'side-part', 'quiff', 'buzz', 'waves', 'locs'],
  female: ['curly-bob', 'straight-bob', 'ponytail', 'braids', 'natural-curls', 'low-bun'],
};
/**
 * Gamification Phase 3 — cosmetic unlocks (spec §5). Cosmetic IDs use
 * `<slot>:<value>` form. Everything not listed here is free. The requirement
 * strings are shown greyed-out in the creator for locked options.
 */
export const SET_TWO_STYLES = ['buzz', 'waves', 'locs', 'braids', 'natural-curls', 'low-bun'] as const;
export const COSMETIC_REQUIREMENTS: Record<string, string> = {
  'background:starlight': 'Reach a 7-day practice streak',
  ...Object.fromEntries(SET_TWO_STYLES.map(s => [`style:${s}`, 'Reach level 4 (Keeper)'])),
  'sash:2': 'Earn any Team Practice Honor',
  'sash:3': 'Earn any Simulation Honor',
};
/** Cosmetic IDs selected by a character config (sash entries only when filled). */
export function cosmeticIdsFor(config: Pick<CharacterConfig, 'background' | 'hairColor' | 'style' | 'slots'>): string[] {
  const ids = [`background:${config.background}`, `hair:${config.hairColor}`, `style:${config.style}`];
  if (config.slots[1]) ids.push('sash:2');
  if (config.slots[2]) ids.push('sash:3');
  return ids;
}
/** 403 unless every locked cosmetic in the config is in the unlocked set. */
export function assertCosmeticsUnlocked(config: Pick<CharacterConfig, 'background' | 'hairColor' | 'style' | 'slots'>, unlocked: ReadonlySet<string>): void {
  const locked = cosmeticIdsFor(config).filter(id => COSMETIC_REQUIREMENTS[id] && !unlocked.has(id));
  if (locked.length) throw new HttpError(403, `Unlock this first — ${locked.map(id => COSMETIC_REQUIREMENTS[id]).join('; ')}.`);
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T => typeof value === 'string' && choices.includes(value as T);
export const defaultCharacter = (): CharacterConfig => ({ bodyType: 'male', style: 'curls', hairColor: 'brown', skin: 'medium', eyes: 'brown', attire: 'student', background: 'sunrise', slots: [null, null, null] });
export const defaultShareOptions = (): ShareOptions => ({ showName: true, showBrand: true, showQR: true });
export function appearance(value: unknown): CharacterAppearance | null {
  if (!object(value) || !oneOf(value.bodyType, ['male', 'female']) || !oneOf(value.style, styles[value.bodyType]) || !oneOf(value.hairColor, ['red', 'black', 'brown', 'blond']) || !oneOf(value.skin, ['light', 'medium', 'deep']) || !oneOf(value.eyes, ['brown', 'hazel', 'blue'])) return null;
  return { bodyType: value.bodyType, style: value.style, hairColor: value.hairColor, skin: value.skin, eyes: value.eyes };
}
function character(value: unknown): CharacterConfig | null {
  const head = appearance(value);
  if (!head || !object(value) || !oneOf(value.attire, ['student', 'coach']) || !oneOf(value.background, ['sunrise', 'basecamp', 'starlight']) || !Array.isArray(value.slots) || value.slots.length !== 3 || value.slots.some(key => key !== null && !isHonorKey(key))) return null;
  const selected = value.slots.filter(key => key !== null);
  if (new Set(selected).size !== selected.length) return null;
  return { ...head, attire: value.attire, background: value.background, slots: [...value.slots] as CharacterConfig['slots'] };
}
function shareOptions(value: unknown): ShareOptions | null {
  if (!object(value) || typeof value.showName !== 'boolean' || typeof value.showBrand !== 'boolean' || typeof value.showQR !== 'boolean') return null;
  return { showName: value.showName, showBrand: value.showBrand, showQR: value.showQR };
}
const bounded = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
function placement(value: unknown): SharePlacement | null {
  if (!object(value) || !isHonorKey(value.key) || !bounded(value.x, 0, 1200) || !bounded(value.y, 0, 1600) || !bounded(value.size, 144, 336) || !bounded(value.rotation, -180, 180)) return null;
  return { key: value.key, x: value.x, y: value.y, size: value.size, rotation: value.rotation };
}
export function validateCharacterSave(value: unknown, earned: ReadonlySet<string>, canUseMasterGuide: boolean, unlockedCosmetics: ReadonlySet<string>): SaveCharacterProfile {
  if (!object(value)) throw new HttpError(400, 'Provide a character profile.');
  const config = character(value.character), options = shareOptions(value.shareOptions);
  if (!Number.isSafeInteger(value.version) || ((value.version as number) < 0 || (value.version as number) >= Number.MAX_SAFE_INTEGER) || !config || !options || !oneOf(value.avatarKind, ['initials', 'honor', 'character']) || (value.avatarHonorKey !== null && !isHonorKey(value.avatarHonorKey)) || (value.avatarKind === 'honor' && value.avatarHonorKey === null) || !Array.isArray(value.sharePatches) || value.sharePatches.length > honorCatalog.length) throw new HttpError(400, 'Choose valid character, avatar and sharing options.');
  const patches = value.sharePatches.map(placement);
  if (patches.some(p => !p) || new Set(patches.map(p => p!.key)).size !== patches.length) throw new HttpError(400, 'Choose distinct Honors and valid patch positions.');
  if (config.attire === 'coach' && !canUseMasterGuide) throw new HttpError(403, 'Master Guide attire is available to coaches.');
  if ([value.avatarHonorKey, ...config.slots, ...patches.map(p => p!.key)].some(key => key !== null && !earned.has(key))) throw new HttpError(403, 'Earn each Honor before using it in your profile.');
  assertCosmeticsUnlocked(config, unlockedCosmetics);
  return { version: value.version as number, character: config, avatarKind: value.avatarKind, avatarHonorKey: value.avatarHonorKey, shareOptions: options, sharePatches: patches as SharePlacement[] };
}
export function characterFields(saved: unknown, revision: number, userId: string, avatarHonorKey: string | null, earned: ReadonlySet<string>, canUseMasterGuide: boolean): CharacterProfileFields {
  const state = object(saved) && saved.userId === userId ? saved : null;
  const config = character(state?.character) ?? defaultCharacter(), options = shareOptions(state?.shareOptions) ?? defaultShareOptions();
  config.slots = config.slots.map(key => key && earned.has(key) ? key : null) as CharacterConfig['slots'];
  if (!canUseMasterGuide) config.attire = 'student';
  const seen = new Set<string>(), patches: SharePlacement[] = [];
  if (Array.isArray(state?.sharePatches)) for (const item of state.sharePatches.slice(0, honorCatalog.length)) {
    const patch = placement(item); if (patch && earned.has(patch.key) && !seen.has(patch.key)) { seen.add(patch.key); patches.push(patch); }
  }
  let avatarKind: AvatarKind = oneOf(state?.avatarKind, ['initials', 'honor', 'character']) ? state.avatarKind : avatarHonorKey ? 'honor' : 'initials';
  if (avatarKind === 'honor' && !avatarHonorKey) avatarKind = 'initials';
  return { character: config, avatarKind, characterVersion: state ? revision : 0, shareOptions: options, sharePatches: patches, canUseMasterGuide };
}
export function portraitIdentity(saved: unknown, userId: string, avatarHonorKey: string | null) {
  const state = object(saved) && saved.userId === userId ? saved : null;
  const head = appearance(state?.character);
  const avatarKind: AvatarKind = state?.avatarKind === 'character' && head ? 'character' : state?.avatarKind === 'initials' ? 'initials' : avatarHonorKey ? 'honor' : 'initials';
  return { avatarKind, character: avatarKind === 'character' ? head : null };
}
