import { PatchArtwork } from "../../components/ui/PatchArtwork";

type Props = {
  kind: "team-a" | "team-b" | "team-practice";
  size?: number;
  className?: string;
};

/** Approved team identity artwork. Earned Honors use their own evidence and assets. */
export function PracticePatch({ kind, size = 120, className = "" }: Props) {
  return <PatchArtwork src={`/brand/practice/${kind}-256.webp`} srcSet={`/brand/practice/${kind}-256.webp 256w, /brand/practice/${kind}-512.webp 512w`} size={size} className={`practice-patch ${className}`} />;
}
