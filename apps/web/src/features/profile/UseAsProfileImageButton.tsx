import { Button, useToast } from "../../components/ui";
import { useSetProfileAvatar } from "./profile";

/**
 * The one "Use as profile image" treatment (Honors page, Practice hub
 * simulation patches and team patches): a real action, not a trip to the
 * profile page. It calls the dedicated avatar endpoint, which sets the
 * earned patch as the profile image atomically — the same end state as
 * picking it in the profile editor and saving, without risking an
 * in-progress profile draft. When the patch is already worn it renders as
 * a disabled state label instead of an action.
 */
export function UseAsProfileImageButton({ honorKey, title, worn }: { honorKey: string; title: string; worn: boolean }) {
  const setAvatar = useSetProfileAvatar();
  const toast = useToast();
  if (worn) return <Button variant="secondary" disabled aria-label={`${title} is your profile image`}>Worn as profile image</Button>;
  return <Button variant="secondary" disabled={setAvatar.isPending} aria-label={`Use ${title} as profile image`} onClick={() => setAvatar.mutate(honorKey, {
    onSuccess: () => toast.success(`${title} is now your profile image.`),
    onError: () => toast.danger("Couldn't set your profile image. Try again."),
  })}>{setAvatar.isPending ? "Setting…" : "Use as profile image"}</Button>;
}
