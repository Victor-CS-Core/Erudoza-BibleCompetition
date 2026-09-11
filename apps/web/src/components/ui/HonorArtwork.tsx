import { PatchArtwork } from "./PatchArtwork";

export function HonorArtwork(props: { src: string; srcSet?: string; alt?: string; size?: number; muted?: boolean }) {
  return <PatchArtwork {...props} className="ds-honor-art" />;
}
