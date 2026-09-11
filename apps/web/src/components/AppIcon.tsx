export type IconName = "home" | "book" | "review" | "chart" | "users" | "flag" | "arrow" | "logout" | "menu" | "close" | "search" | "pin" | "chevron" | "grid" | "plus";
const paths: Record<IconName, string> = {
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  pin: "m15 3 6 6-4 1-3 5v3l-3-3-6-1 5-3 1-4Zm-6 12-6 6",
  chevron: "m6 9 6 6 6-6",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  plus: "M12 5v14M5 12h14",
  home: "m3 10 9-7 9 7v10H14v-6h-4v6H3Z",
  book: "M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1m0-15c3-2 7-2 10-1v15c-4-1-7-1-10 1V5Z",
  review: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2",
  chart: "M4 20V13m8 7V8m8 12V3",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m9 0a4 4 0 0 1 0 8",
  flag: "M4 22V3m0 1c5-4 10 4 16 0v10c-6 4-11-4-16 0",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  logout: "M9 4H3v16h6m6-13 5 5-5 5m-7-5h12",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "m5 5 14 14M5 19 19 5",
};
export function AppIcon({ name }: { name: IconName }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
