export function apiUrl(path: string, base = import.meta.env.VITE_API_BASE_URL): string {
  const prefix = (base ?? "").replace(/\/$/, "");
  return `${prefix}${path}`;
}
