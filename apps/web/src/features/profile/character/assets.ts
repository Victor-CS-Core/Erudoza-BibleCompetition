const solo = new Set(['exact-recall','reference-ready','chapter-strong','full-coverage','steady-study','review-complete']);
const team = new Set(['first-fellowship','team-steady','shared-scribe','team-precision','rehearsal-complete']);
const simulation = new Set(['first-rehearsal','event-ready','steady-team','trusted-scribe','team-precision']);
export const characterAsset = (path:string) => `/brand/characters/v1/${path}`;
/** All production Honor images, with no URL or arbitrary file input. */
export function honorImageSrc(key:string):string|undefined {
 const [category,name,...extra]=key.split(':');if(extra.length)return;
 if(category==='solo'&&solo.has(name))return `/assets/training/${name}-320.webp`;
 if(category==='team'&&team.has(name))return `/brand/practice/${name}-512.webp`;
 if(category==='simulation'&&simulation.has(name))return `/brand/simulation/${name}-512.webp`;
}
