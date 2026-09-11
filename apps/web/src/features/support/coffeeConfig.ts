export const COFFEE_WIDGET_SCRIPT_URL = "https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js";

export function parseCoffeeProfile(value: string | undefined): { creatorId: string; url: string } | null {
  // Match the supplied path before URL normalization can erase unsafe segments.
  const match = value?.trim().match(/^https:\/\/(?:www\.)?buymeacoffee\.com(?::443)?\/([a-z0-9][a-z0-9_-]{0,99})\/?$/i);
  if (!match) return null;
  return { creatorId: match[1], url: `https://buymeacoffee.com/${match[1]}` };
}
