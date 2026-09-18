import { ThemedImage } from "./ThemedImage";
import "./landscape-banner.css";

type Props = {
  className?: string;
  alt?: string;
  priority?: boolean;
  sizes?: string;
};

/** Preserve the approved panorama; page headings and actions stay outside the art. */
export function LandscapeBanner({ className = "", alt = "", priority = false, sizes = "(min-width: 1248px) 1200px, calc(100vw - 48px)" }: Props) {
  return <ThemedImage
    className={`er-landscape-banner ${className}`.trim()}
    src="/assets/training/journey-hero-720.webp"
    srcSet="/assets/training/journey-hero-720.webp 720w, /assets/training/journey-hero-1440.webp 1440w"
    darkSrc="/assets/training/journey-hero-dark-720.webp"
    darkSrcSet="/assets/training/journey-hero-dark-720.webp 720w, /assets/training/journey-hero-dark-1440.webp 1440w"
    sizes={sizes}
    width={1440}
    height={480}
    alt={alt}
    loading={priority ? "eager" : "lazy"}
    fetchPriority={priority ? "high" : "auto"}
    decoding="async"
  />;
}
