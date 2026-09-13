import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import { MasteryHonorArtwork } from "./MasteryHonorArtwork";
import { ProfileAvatar } from "./ProfileAvatar";
import { useMyProfile, useSetProfileAvatar } from "./profile";
import "./profile.css";

export function ProfilePage() {
  const { me } = useAuth();
  const profile = useMyProfile();
  const save = useSetProfileAvatar();
  const refreshProfile=profile.refetch;
  useEffect(()=>{
    // Completed activity evidence may publish shortly after navigation to Profile.
    // Limit refreshes to this page and this visit; never poll every avatar consumer.
    const timers=[2000,5000,10000,20000].map(delay=>window.setTimeout(()=>{
      if(document.visibilityState==='visible')void refreshProfile();
    },delay));
    return ()=>timers.forEach(timer=>window.clearTimeout(timer));
  },[refreshProfile]);
  const [status, setStatus] = useState("");
  const choose = (honorKey: string | null) => {
    setStatus("");
    save.mutate(honorKey, { onSuccess: () => setStatus(honorKey ? "Profile image updated everywhere you appear in Erudoza." : "Profile image reset to initials.") });
  };
  const current = profile.data?.honors.find(honor => honor.key === profile.data?.avatarHonorKey);
  return <div className="training-page profile-page">
    <PageHeader title="Your profile" description="Choose an earned training patch or your initials for your club profile and team discussions." />
    {profile.isPending ? <LoadingState label="Loading your profile…" /> : profile.isError ? <Panel><Notice tone="danger">Unable to load your profile.</Notice><Button variant="secondary" onClick={() => void profile.refetch()}>Try again</Button></Panel> : <>
      <Panel className="profile-summary">
        <ProfileAvatar userId={profile.data.userId} displayName={profile.data.displayName} size={80} />
        <div><h2>{profile.data.displayName}</h2><p>{me?.organizationName}</p><Badge>{current?.title ?? "Your initials"}</Badge></div>
        <Button variant="secondary" disabled={save.isPending || !profile.data.avatarHonorKey} onClick={() => choose(null)}>Use initials</Button>
      </Panel>
      {status && <Notice tone="success">{status}</Notice>}
      {save.isError && <Notice tone="danger">{save.error.message || "Unable to save your profile image. Try again."}</Notice>}
      <div className="profile-collection-heading"><Button variant="secondary" disabled={profile.isFetching||save.isPending} onClick={()=>void refreshProfile()}>{profile.isFetching?"Refreshing patches…":"Refresh patches"}</Button><h2>Honor profile images</h2><p>{profile.data.honors.filter(honor => honor.earnedAtUtc).length} of {profile.data.honors.length} unlocked. Earn an Honor to wear its patch.</p></div>
      {(["Scripture", "Team Practice", "Simulation"] as const).map(category => <section key={category} aria-label={`${category} profile images`} className="profile-category">
        <h3>{category}</h3><div className="profile-honor-grid">{profile.data.honors.filter(honor => honor.category === category).map(honor => {
          const selected = profile.data.avatarHonorKey === honor.key;
          return <Panel key={honor.key} className="profile-honor-option" data-selected={selected || undefined}>
            <MasteryHonorArtwork honorKey={honor.key} size={120} muted={!honor.earnedAtUtc} />
            <h3>{honor.title}</h3><Badge tone={selected ? "success" : honor.earnedAtUtc ? "info" : "neutral"}>{selected ? "Wearing" : honor.earnedAtUtc ? "Unlocked" : "Locked"}</Badge>
            <p>{honor.requirement}</p>
            <Button variant={selected ? "secondary" : "primary"} disabled={!honor.earnedAtUtc || selected || save.isPending} aria-label={`${selected ? "Wearing" : "Use"} ${honor.title} as profile image`} onClick={() => choose(honor.key)}>{selected ? "Current image" : !honor.earnedAtUtc ? "Earn to unlock" : save.isPending && save.variables === honor.key ? "Saving…" : "Use profile image"}</Button>
          </Panel>;
        })}</div>
      </section>)}
      <p className="profile-note">Meet an Honor’s recall or Team Practice requirements to use its patch. Practice milestones stay in your history and do not provide profile images.</p>
    </>}
  </div>;
}
