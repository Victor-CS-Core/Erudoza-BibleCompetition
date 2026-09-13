export type CharacterAppearance = {
  bodyType: 'male' | 'female';
  style: string;
  hairColor: 'red' | 'black' | 'brown' | 'blond';
  skin: 'light' | 'medium' | 'deep';
  eyes: 'brown' | 'hazel' | 'blue';
};
export type CharacterConfig = CharacterAppearance & {
  attire: 'student' | 'coach';
  background: 'sunrise' | 'basecamp' | 'starlight';
  slots: [string | null, string | null, string | null];
};
export type AvatarKind = 'initials' | 'honor' | 'character';
export type ShareOptions = { showName: boolean; showBrand: boolean; showQR: boolean };
export type SharePlacement = { key: string; x: number; y: number; size: number; rotation: number };
export type CharacterProfileFields = {
  character: CharacterConfig;
  avatarKind: AvatarKind;
  characterVersion: number;
  shareOptions: ShareOptions;
  sharePatches: SharePlacement[];
  canUseMasterGuide: boolean;
};
export type SaveCharacterProfile = {
  version: number;
  character: CharacterConfig;
  avatarKind: AvatarKind;
  avatarHonorKey: string | null;
  shareOptions: ShareOptions;
  sharePatches: SharePlacement[];
};
