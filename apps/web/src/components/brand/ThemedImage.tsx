import type { ImgHTMLAttributes } from "react";
import { useTheme } from "../../theme";

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  /** Image (and optional srcSet) used when the resolved theme is dark. */
  darkSrc: string;
  darkSrcSet?: string;
};

/** <img> that swaps to a dark-background variant when the resolved theme is dark. */
export function ThemedImage({ darkSrc, darkSrcSet, src, srcSet, ...rest }: Props) {
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  return <img {...rest} src={dark ? darkSrc : src} srcSet={dark ? (darkSrcSet ?? darkSrc) : srcSet} />;
}
