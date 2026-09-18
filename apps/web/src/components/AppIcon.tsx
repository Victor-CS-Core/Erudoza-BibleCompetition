export type IconName = "home" | "book" | "review" | "chart" | "users" | "flag" | "arrow" | "logout" | "menu" | "close" | "search" | "pin" | "chevron" | "grid" | "plus" | "check" | "bell" | "flame" | "sun" | "moon";
const paths: Record<IconName, string> = {
  check: "m5 12 4 4L19 6",
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
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  flame: "M12 2s6 5 6 11a6 6 0 0 1-12 0c0-2 1-4 2-5.2.6 1.6 1.6 2.6 3 3.2-.4-3 .1-6 1-9z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m13.2 13.2 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
};
export function AppIcon({ name }: { name: IconName }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
