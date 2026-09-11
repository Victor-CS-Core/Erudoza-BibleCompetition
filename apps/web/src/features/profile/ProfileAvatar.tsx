import type { CSSProperties } from "react";
import { MasteryHonorArtwork, isHonorArtwork } from "./MasteryHonorArtwork";
import { useProfileIdentity } from "./profile";
import "./profile.css";

export function ProfileAvatar({ userId, displayName, size = 36 }: { userId: string; displayName: string; size?: number }) {
  const identity = useProfileIdentity(userId);
  const key = identity.data?.avatarHonorKey;
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase() || "?";
  return <span className="profile-avatar" aria-hidden="true" data-profile-user={userId} data-profile-honor={key && isHonorArtwork(key) ? key : undefined} style={{ "--profile-size": `${size}px` } as CSSProperties}>
    {key && isHonorArtwork(key) ? <MasteryHonorArtwork honorKey={key} size={size} /> : <span>{initials}</span>}
  </span>;
}
