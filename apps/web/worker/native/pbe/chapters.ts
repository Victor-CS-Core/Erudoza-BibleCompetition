import type { TargetReview } from './review';
import type { PbeQuestion, PbeTarget } from './types';

export interface TargetProof {
  targetId: string;
  questionId: string;
  questionVersion: number;
  attemptId: string;
  /** Trusted original response lock time, or original acceptance time for untimed legacy evidence. */
  atMs: number;
  acceptedSequence: number;
  fullCredit: boolean;
  unaided: boolean;
  final: boolean;
  /** Skill applicability from the frozen original rubric, never from current question heads. */
  recall: boolean;
  activity: 'Solo' | 'Team';
}

export const RETENTION_RULE_VERSION = 'pbe-retention-v1' as const;
export const CHAPTER_RULE_VERSION = 'pbe-chapter-v1' as const;
const retentionDelayMs = 48 * 60 * 60 * 1000;
export type RetentionCandidate = Pick<TargetProof, 'targetId'|'questionId'|'questionVersion'|'attemptId'|'atMs'|'acceptedSequence'>;
export interface RetentionState {
  ruleVersion: typeof RETENTION_RULE_VERSION;
  practiced: boolean;
  recalled: boolean;
  pendingCount: number;
  lastAcceptedSequence: number;
  lastFailureSequence: number|null;
  earliest: RetentionCandidate[];
  latest: RetentionCandidate[];
  witness: [RetentionCandidate, RetentionCandidate]|null;
  dataGap: boolean;
}
export const initialRetentionState = (): RetentionState => ({ruleVersion:RETENTION_RULE_VERSION,practiced:false,recalled:false,pendingCount:0,lastAcceptedSequence:0,lastFailureSequence:null,earliest:[],latest:[],witness:null,dataGap:false});
const tie = (a:RetentionCandidate,b:RetentionCandidate) => a.acceptedSequence-b.acceptedSequence || a.questionId.localeCompare(b.questionId) || a.attemptId.localeCompare(b.attemptId);
const earliestOrder = (a:RetentionCandidate,b:RetentionCandidate) => a.atMs-b.atMs || tie(a,b);
function extremes(candidates:RetentionCandidate[], latest:boolean):RetentionCandidate[] {
  const ordered=candidates.slice().sort((a,b)=>(latest?b.atMs-a.atMs:a.atMs-b.atMs)||tie(a,b));
  return [...new Map(ordered.map(c=>[c.questionId,ordered.find(p=>p.questionId===c.questionId)!])).values()].slice(0,2);
}
/** A serializable bounded fold. Caller feeds normalized evidence once in original accepted order. */
export function advanceRetention(state:RetentionState, proof:TargetProof):RetentionState {
  if(proof.activity!=='Solo')return state;
  if(proof.acceptedSequence<=state.lastAcceptedSequence)throw new Error('Retention evidence must advance original accepted order.');
  const next={...state,practiced:true,lastAcceptedSequence:proof.acceptedSequence};
  if(!proof.recall)return next;
  if(!proof.final)return {...next,pendingCount:next.pendingCount+1};
  if(!proof.fullCredit)return {...next,recalled:false,lastFailureSequence:proof.acceptedSequence,earliest:[],latest:[],witness:null};
  if(!proof.unaided)return next;
  const {targetId,questionId,questionVersion,attemptId,atMs,acceptedSequence}=proof;
  const candidate={targetId,questionId,questionVersion,attemptId,atMs,acceptedSequence};
  const previous=[...next.earliest,...next.latest].sort(earliestOrder);
  const partner=previous.find(p=>p.questionId!==questionId&&Math.abs(atMs-p.atMs)>=retentionDelayMs);
  return {...next,recalled:true,earliest:extremes([...next.earliest,candidate],false),latest:extremes([...next.latest,candidate],true),witness:next.witness??(partner?[partner,candidate]:null)};
}
export const retentionReady = (state:RetentionState|undefined):boolean => !!state&&state.ruleVersion===RETENTION_RULE_VERSION&&!state.dataGap&&state.pendingCount===0&&state.witness!==null;
/** Array entry points share the exact persisted fold, including deterministic witness selection. */
export function replayTargets(proofs:TargetProof[],eligibleTargetIds:string[]):Map<string,RetentionState>{
  const states=new Map(eligibleTargetIds.map(id=>[id,initialRetentionState()]));
  for(const proof of proofs.filter(p=>states.has(p.targetId)).sort((a,b)=>a.acceptedSequence-b.acceptedSequence||a.attemptId.localeCompare(b.attemptId)))states.set(proof.targetId,advanceRetention(states.get(proof.targetId)!,proof));
  return states;
}
export function retainedTargets(proofs:TargetProof[],eligibleTargetIds:string[]):string[]{
  return [...replayTargets(proofs,eligibleTargetIds)].filter(([,state])=>retentionReady(state)).map(([id])=>id).sort();
}

export interface ChapterScope {
  chapterKey: string;
  scopeVersion: string;
  /** This chapter or introduction group's assigned sources. */
  assignedSourceUnitIds: string[];
  /** Complete personally eligible assignment, including other chapter groups. */
  eligibleAssignmentSourceUnitIds: string[];
}

export interface ChapterProgress {
  chapterKey: string;
  scopeVersion: string;
  assignedPassages: number;
  questionCoveredPassages: number;
  totalTargets: number;
  practicedTargets: number;
  recalledTargets: number;
  retainedTargets: number;
  dueTargets: number;
  missingVariantTargets: number;
  stampEarnedAtUtc: string | null;
}

/**
 * Current counters for the validated, published bank and normalized accepted evidence supplied by the caller.
 * A whole-chapter retained claim additionally requires nonzero targets, complete assigned-passage coverage,
 * every declared target retained, and no relevant pending correction. Counts never create an earned stamp.
 */
export function projectChapter(
  scope: ChapterScope,
  targets: PbeTarget[],
  reviews: TargetReview[],
  proofs: TargetProof[],
  questions: PbeQuestion[],
  context: { asOfMs: number },
): ChapterProgress {
  return projectChapterFromStates(scope,targets,reviews,replayTargets(proofs,targets.map(t=>t.id)),questions,context);
}
export function projectChapterFromStates(
 scope:ChapterScope, targets:Pick<PbeTarget,'id'|'skill'|'sourceUnitIds'>[],reviews:TargetReview[],states:Map<string,RetentionState>,
 questions:(Pick<PbeQuestion,'id'|'kind'|'sourceUnitIds'>&{parts:Pick<PbeQuestion['parts'][number],'targetId'>[]})[],context:{asOfMs:number},
):ChapterProgress {
  if (!Number.isFinite(context.asOfMs)) throw new Error('Provide a finite chapter projection time.');
  const assigned = new Set(scope.assignedSourceUnitIds);
  const eligibleAssignment = new Set(scope.eligibleAssignmentSourceUnitIds);
  if ([...assigned].some(id => !eligibleAssignment.has(id))) {
    throw new Error('Chapter sources must be within the eligible assignment.');
  }
  const inGroup = (sourceUnitIds: string[]) =>
    sourceUnitIds.every(id => eligibleAssignment.has(id)) && sourceUnitIds.some(id => assigned.has(id));
  const groupedTargets = new Map(targets.filter(t => inGroup(t.sourceUnitIds)).map(t => [t.id, t]));
  const groupedQuestions = questions.filter(q => inGroup(q.sourceUnitIds));
  const covered = new Set(groupedQuestions.flatMap(q => q.sourceUnitIds.filter(id => assigned.has(id))));
  const variants = new Map<string, Set<string>>([...groupedTargets.keys()].map(id => [id, new Set()]));
  for (const q of groupedQuestions) {
    if (q.kind === 'TrueFalse') continue;
    for (const part of q.parts) {
      const t = groupedTargets.get(part.targetId);
      // ExactWords grading always enforces order, regardless of the general ordered flag.
      if (t && (t.skill !== 'ExactWords' || q.kind === 'ExactWords')) variants.get(t.id)!.add(q.id);
    }
  }
  states=new Map([...states].filter(([id])=>groupedTargets.has(id)));
  const counts={practicedTargets:0,recalledTargets:0,retainedTargets:0,dueTargets:0,missingVariantTargets:0};
  for(const id of groupedTargets.keys()){
    const facts=chapterTargetCounts(states.get(id),reviews.find(r=>r.targetId===id),variants.get(id)!.size,context.asOfMs);
    for(const key of Object.keys(counts) as (keyof typeof counts)[])counts[key]+=facts[key];
  }
  return {
    chapterKey: scope.chapterKey, scopeVersion: scope.scopeVersion,
    assignedPassages: assigned.size, questionCoveredPassages: covered.size, totalTargets: groupedTargets.size,
    ...counts,
    // Only the transactional adapter may overlay a persisted immutable first-earned stamp.
    stampEarnedAtUtc: null,
  };
}

/** Same per-target counter rules for the array wrapper and bounded persisted aggregation. */
export function chapterTargetCounts(state:RetentionState|undefined,review:TargetReview|undefined,variantCount:number,asOfMs:number){
 if(!Number.isFinite(asOfMs))throw new Error('Provide a finite chapter projection time.');
 return {practicedTargets:state?.practiced?1:0,recalledTargets:state?.recalled&&!state.pendingCount&&!state.dataGap?1:0,retainedTargets:retentionReady(state)&&variantCount>=2?1:0,dueTargets:review&&(review.unresolved||review.intervalIndex>=0&&review.dueAtMs<=asOfMs)?1:0,missingVariantTargets:variantCount<2?1:0};
}
