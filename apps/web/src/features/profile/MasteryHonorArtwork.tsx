import type { BadgeKey } from "../../api/trainingTypes";
import { PatchArtwork } from "../../components/ui/PatchArtwork";
import { honorAsset } from "../student/trainingAssets";

const solo = new Set(["exact-recall", "reference-ready", "chapter-strong", "full-coverage", "steady-study", "review-complete"]);
const simulation = new Set(["first-rehearsal","event-ready","steady-team","trusted-scribe","team-precision"]);
const team = new Set(["first-fellowship", "team-steady", "shared-scribe", "team-precision", "rehearsal-complete"]);
const pbe = new Set(["coverage-starter", "first-45", "zero-extra", "steady-under-time", "captains-call", "fair-challenge"]);
export function isHonorArtwork(key: string) {
  const [category, name] = key.split(":");
  return key === `${category}:${name}` && ((category === "solo" && solo.has(name)) || (category === "team" && team.has(name)) || (category === "simulation" && simulation.has(name)) || (category === "pbe" && pbe.has(name)));
}
export function MasteryHonorArtwork({ honorKey, size = 96, muted = false, className = "" }: { honorKey: string; size?: number; muted?: boolean; className?: string }) {
  if (!isHonorArtwork(honorKey)) return null;
  const [category, name] = honorKey.split(":");
  const folder = category === "simulation" ? "simulation" : category === "pbe" ? "pbe" : "practice";
  return <PatchArtwork {...(category === "solo" ? honorAsset(name as BadgeKey) : { src: `/brand/${folder}/${name}-256.webp`, srcSet: `/brand/${folder}/${name}-256.webp 256w, /brand/${folder}/${name}-512.webp 512w` })} size={size} muted={muted} className={className} />;
}
