import { Component, lazy, Suspense, type CSSProperties, type ReactNode } from "react";
import { MasteryHonorArtwork, isHonorArtwork } from "./MasteryHonorArtwork";
import { useProfileIdentity } from "./profile";
import "./profile.css";

const CharacterPortrait = lazy(() => import("./character/CharacterPreview").then(module => ({ default: module.CharacterPortrait })));
class PortraitBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function ProfileAvatar({ userId, displayName, size = 36 }: { userId: string; displayName: string; size?: number }) {
  const identity = useProfileIdentity(userId);
  const kind = identity.data?.avatarKind ?? (identity.data?.avatarHonorKey ? "honor" : "initials");
  const key = kind === "honor" ? identity.data?.avatarHonorKey : null;
  const appearance = kind === "character" ? identity.data?.character : null;
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase() || "?";
  const fallback = <span>{initials}</span>;
  return <span className="profile-avatar" aria-hidden="true" data-profile-user={userId} data-profile-kind={kind} data-profile-honor={key && isHonorArtwork(key) ? key : undefined} style={{ "--profile-size": `${size}px` } as CSSProperties}>
    {appearance ? <PortraitBoundary key={JSON.stringify([userId, appearance])} fallback={fallback}><Suspense fallback={fallback}><CharacterPortrait appearance={appearance} fallback={fallback}/></Suspense></PortraitBoundary> : key && isHonorArtwork(key) ? <MasteryHonorArtwork honorKey={key} size={size} /> : fallback}
  </span>;
}
