import {simulationCatalog} from '../practice/simulation-awards';
export const ruleVersionFor=(key:string)=>key.startsWith('simulation:')?'simulation-v1' as const:key.startsWith('pbe:')?'pbe-v1' as const:'mastery-v1' as const;
export const RULE_VERSION = 'mastery-v1' as const;
export const honorCatalog = [
  { key: 'solo:exact-recall', title: 'Exact Recall', category: 'Scripture', requirement: 'Reach 90 in exact wording on 12 distinct assigned passages.' },
  { key: 'solo:reference-ready', title: 'Reference Ready', category: 'Scripture', requirement: 'Reach 90 in reference recall on 20 distinct assigned passages.' },
  { key: 'solo:chapter-strong', title: 'Chapter Strong', category: 'Scripture', requirement: 'Bring every assigned passage in one chapter, with at least 10 passages, to the honor standard: exact wording 90, reference 80, recognition 80.' },
  { key: 'solo:full-coverage', title: 'Complete Mastery', category: 'Scripture', requirement: 'Bring every assigned passage in a scope of at least 30 passages to the honor standard: exact wording 90, reference 80, recognition 80.' },
  { key: 'solo:steady-study', title: 'Proven Retention', category: 'Scripture', requirement: 'Retain the honor standard (exact wording 90, reference 80, recognition 80) on 20 distinct passages and pass an unaided advanced typed retest at least 48 hours after first reaching that standard on each.' },
  { key: 'solo:review-complete', title: 'Review Complete', category: 'Scripture', requirement: 'Correctly answer 8 distinct due passages on the first accepted advanced typed review attempt, without hints, while meeting the honor standard (exact wording 90, reference 80, recognition 80).' },
  { key: 'team:first-fellowship', title: 'First Fellowship', category: 'Team Practice', requirement: 'Reach 90% personal accuracy across 10 distinct manually submitted questions as scribe.' },
  { key: 'team:team-steady', title: 'Team Steady', category: 'Team Practice', requirement: 'Complete 3 matches with at least 90% team accuracy and reach 90% personal accuracy across 30 distinct manual questions.' },
  { key: 'team:shared-scribe', title: 'Shared Scribe', category: 'Team Practice', requirement: 'Reach 95% personal accuracy across 30 distinct manual questions from at least 10 passages.' },
  { key: 'team:team-precision', title: 'Team Precision', category: 'Team Practice', requirement: 'Reach 95% team accuracy across 50 distinct questions from 15 passages, plus 90% personal accuracy across 10 distinct manual questions.' },
  { key: 'team:rehearsal-complete', title: 'Rehearsal Complete', category: 'Team Practice', requirement: 'Complete a resolved coached 90-question rehearsal with 90% team accuracy, plus 90% personal accuracy across 10 distinct manual questions.' },
  { key: 'pbe:coverage-starter', title: 'Coverage Starter', category: 'PBE Practice', requirement: 'Practice 10 different targets in your assigned PBE passages.' },
  { key: 'pbe:first-45', title: 'First 45', category: 'PBE Practice', requirement: 'Complete a 45-question half mock.' },
  { key: 'pbe:zero-extra', title: 'Zero Extra Answers', category: 'PBE Practice', requirement: 'Finish a timed run of at least 10 questions without writing any answer the question did not ask for.' },
  { key: 'pbe:steady-under-time', title: 'Steady Under Time', category: 'PBE Practice', requirement: 'Finish a timed run earning at least 90% of the available points.' },
  { key: 'pbe:captains-call', title: "Captain's Call", category: 'PBE Practice', requirement: 'Flag one of your answers for review and have a coach rule on it.' },
  { key: 'pbe:fair-challenge', title: 'Fair Challenge', category: 'PBE Practice', requirement: 'Have a flagged answer ruled in your favor, with the coach\u2019s correction raising its points.' },
  ...simulationCatalog,
] as const;
export type HonorKey = typeof honorCatalog[number]['key'];
export const honorId = (orgId: string, userId: string, key: string) => `${orgId}:${userId}:${ruleVersionFor(key)}:${key}`;
export interface HonorUnlock { id: string; userId: string; key: HonorKey; ruleVersion: ReturnType<typeof ruleVersionFor>; earnedAtUtc: string; seasonId: string; evidence: unknown }
export interface ProfileSelection { id: string; userId: string; honorKey: HonorKey | null; unlockId: string | null; ruleVersion: ReturnType<typeof ruleVersionFor> | null }
export const isHonorKey = (value: unknown): value is HonorKey => honorCatalog.some(h => h.key === value);
