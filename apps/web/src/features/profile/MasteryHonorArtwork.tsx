import type { BadgeKey } from "../../api/trainingTypes";
import { PatchArtwork } from "../../components/ui/PatchArtwork";
import { honorAsset } from "../student/trainingAssets";

const solo = new Set(["exact-recall", "reference-ready", "chapter-strong", "full-coverage", "steady-study", "review-complete"]);
const team = new Set(["first-fellowship", "team-steady", "shared-scribe", "team-precision", "rehearsal-complete"]);
export function isHonorArtwork(key: string) {
  const [category, name] = key.split(":");
  return key === `${category}:${name}` && ((category === "solo" && solo.has(name)) || (category === "team" && team.has(name)));
}
export function MasteryHonorArtwork({ honorKey, size = 96, muted = false, className = "" }: { honorKey: string; size?: number; muted?: boolean; className?: string }) {
  if (!isHonorArtwork(honorKey)) return null;
  const [category, name] = honorKey.split(":");
  return <PatchArtwork {...(category === "solo" ? honorAsset(name as BadgeKey) : { src: `/brand/practice/${name}-256.webp`, srcSet: `/brand/practice/${name}-256.webp 256w, /brand/practice/${name}-512.webp 512w` })} size={size} muted={muted} className={className} />;
}
