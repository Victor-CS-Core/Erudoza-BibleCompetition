import type {VerifiedCooperationScope} from './cooperation-capability';
import {cooperationPage,cooperationPageBudget,entriesSql,type CooperationWork,type SavedSourceFacts} from './cooperation-storage';
/** Set-wise source reduction over saved D1 facts; no question answers, source text or chronology. */
export async function readSubjectSourceFacts(scope:VerifiedCooperationScope,w:CooperationWork){
 const student=w.roster[w.subjectIndex].studentId,descriptor=w.descriptors[w.subjectIndex];scope.assertSubject(student,w.roster);
 const known=descriptor.availability==='Known';
 const sql=`WITH context(org,season,student) AS (VALUES(?,?,?)),meta(generation) AS (VALUES(?)),sources AS (${entriesSql('sources')}),
 selected AS MATERIALIZED (SELECT json_extract(value,'$.sourceKind') AS sourceKind,json_extract(value,'$.contentPackId') AS contentPackId,json_extract(value,'$.sourceUnitId') AS sourceUnitId FROM sources WHERE json_extract(value,'$.studentId')=(SELECT student FROM context) AND json_array(json_extract(value,'$.sourceKind'),json_extract(value,'$.contentPackId'),json_extract(value,'$.sourceUnitId'))>? ORDER BY sourceKind,contentPackId,sourceUnitId LIMIT 128),
 saved AS MATERIALIZED (SELECT json_extract(m.data,'$.family') AS family,e.value FROM context c JOIN Records m INDEXED BY Records_training_scope ON m.kind='pbe-chapter-manifest' AND m.org_id=c.org AND m.season_id=c.season AND m.owner_id=c.student AND json_extract(m.data,'$.generationId')=? JOIN json_each(m.data,'$.entries') e WHERE ?=1 AND json_extract(m.data,'$.family') IN ('targets','heads','retentions')),
 targets AS MATERIALIZED (SELECT json_extract(value,'$.target.id') AS id,json_extract(value,'$.target.skill') AS skill,json_extract(value,'$.target.sourceUnitIds') AS units FROM saved WHERE family='targets' AND json_type(value,'$.target')='object' AND EXISTS(SELECT 1 FROM json_each(saved.value,'$.target.sourceUnitIds') u JOIN selected s ON s.sourceUnitId=u.value)),
 heads AS MATERIALIZED (SELECT json_extract(value,'$.question') AS question FROM saved WHERE family='heads' AND json_type(value,'$.question')='object'),
 headParts AS MATERIALIZED (SELECT json_extract(question,'$.id') AS questionId,json_extract(question,'$.kind') AS kind,json_extract(p.value,'$.targetId') AS targetId FROM heads JOIN json_each(question,'$.parts') p WHERE json_extract(p.value,'$.targetId') IN (SELECT id FROM targets)),
 variants AS (SELECT t.id,count(DISTINCT p.questionId) AS n FROM targets t LEFT JOIN headParts p ON p.targetId=t.id AND p.kind<>'TrueFalse' AND (t.skill<>'ExactWords' OR p.kind='ExactWords') GROUP BY t.id),
 retentions AS MATERIALIZED (SELECT json_extract(value,'$.targetId') AS id,json_extract(value,'$.projection') AS p FROM saved WHERE family='retentions'),
 targetFacts AS MATERIALIZED (SELECT t.id,t.units,
 CASE WHEN r.id IS NULL OR json_extract(r.p,'$.retention.ruleVersion') IS NOT 'pbe-retention-v1' OR json_extract(r.p,'$.retention.dataGap')=1 THEN NULL ELSE coalesce(json_extract(r.p,'$.retention.practiced'),0) END AS practiced,
 CASE WHEN r.id IS NULL OR json_extract(r.p,'$.retention.ruleVersion') IS NOT 'pbe-retention-v1' OR json_extract(r.p,'$.retention.dataGap')=1 THEN NULL WHEN json_extract(r.p,'$.retention.pendingCount')>0 OR json_extract(r.p,'$.provisional')=1 THEN 0 ELSE coalesce(json_extract(r.p,'$.retention.recalled'),0) END AS recalled,
 CASE WHEN v.n<2 THEN 0 WHEN r.id IS NULL OR json_extract(r.p,'$.retention.ruleVersion') IS NOT 'pbe-retention-v1' OR json_extract(r.p,'$.retention.dataGap')=1 THEN NULL WHEN json_extract(r.p,'$.retention.ruleVersion')<>'pbe-retention-v1' OR json_extract(r.p,'$.retention.pendingCount')>0 OR json_extract(r.p,'$.provisional')=1 OR coalesce(json_array_length(r.p,'$.retention.witness'),0)<>2 THEN 0 ELSE 1 END AS retained,
 CASE WHEN r.id IS NULL OR json_extract(r.p,'$.retention.ruleVersion') IS NOT 'pbe-retention-v1' OR json_extract(r.p,'$.retention.dataGap')=1 OR json_extract(r.p,'$.provisional')=1 THEN 0 ELSE 1 END AS dueKnown,
 CASE WHEN r.id IS NULL THEN NULL ELSE coalesce(json_extract(r.p,'$.review.unresolved'),0) END AS unresolved,
 CASE WHEN json_extract(r.p,'$.review.intervalIndex')>=0 THEN json_extract(r.p,'$.review.dueAtMs') END AS scheduledAtMs FROM targets t LEFT JOIN retentions r ON r.id=t.id JOIN variants v ON v.id=t.id),
 edges AS MATERIALIZED (SELECT t.*,u.value AS sourceId FROM targetFacts t JOIN json_each(t.units) u JOIN selected s ON s.sourceUnitId=u.value),
 coverage AS (SELECT DISTINCT u.value AS sourceId FROM heads JOIN json_each(question,'$.sourceUnitIds') u),
 reduced AS (SELECT s.sourceKind,s.contentPackId,s.sourceUnitId,count(e.id) AS targets,max(e.practiced) AS practiced,sum(e.practiced IS NULL AND e.id IS NOT NULL) AS practiceUnknown,min(e.recalled) AS recalled,sum(e.recalled IS NULL AND e.id IS NOT NULL) AS recallUnknown,min(e.retained) AS retained,sum(e.retained IS NULL AND e.id IS NOT NULL) AS retainedUnknown,min(e.dueKnown) AS dueKnown,max(e.unresolved) AS unresolved,sum(e.unresolved IS NULL AND e.id IS NOT NULL) AS dueUnknown,min(e.scheduledAtMs) AS scheduledAtMs,EXISTS(SELECT 1 FROM coverage WHERE sourceId=s.sourceUnitId) AS covered FROM selected s LEFT JOIN edges e ON e.sourceId=s.sourceUnitId GROUP BY s.sourceKind,s.contentPackId,s.sourceUnitId)
 SELECT json_array(sourceKind,contentPackId,sourceUnitId) AS key,json_object('studentId',(SELECT student FROM context),'sourceKind',sourceKind,'contentPackId',contentPackId,'sourceUnitId',sourceUnitId,
 'questionCovered',CASE WHEN ?=1 THEN covered END,
 'practiced',CASE WHEN ?=0 THEN NULL WHEN practiced=1 THEN 1 WHEN practiceUnknown>0 THEN NULL ELSE 0 END,
 'recalled',CASE WHEN ?=0 THEN NULL WHEN targets=0 OR recalled=0 THEN 0 WHEN recallUnknown>0 THEN NULL ELSE 1 END,
 'retained',CASE WHEN ?=0 THEN NULL WHEN covered=0 OR targets=0 OR retained=0 THEN 0 WHEN retainedUnknown>0 THEN NULL ELSE 1 END,
 'dueKnown',CASE WHEN ?=0 THEN 0 ELSE coalesce(dueKnown,1) END,
 'unresolved',CASE WHEN ?=0 THEN NULL WHEN unresolved=1 THEN 1 WHEN dueUnknown>0 THEN NULL ELSE 0 END,'scheduledAtMs',scheduledAtMs) AS payload FROM reduced ORDER BY key LIMIT 128`;
 const rows=await cooperationPage<SavedSourceFacts>(scope.ctx,sql,[scope.ctx.orgId,w.seasonId,student,w.workId,w.after,descriptor.generationId,known?1:0,...Array(6).fill(known?1:0)],cooperationPageBudget(w));
 return rows.map(row=>({...row,questionCovered:row.questionCovered===null?null:!!row.questionCovered,practiced:row.practiced===null?null:!!row.practiced,recalled:row.recalled===null?null:!!row.recalled,retained:row.retained===null?null:!!row.retained,dueKnown:!!row.dueKnown,unresolved:row.unresolved===null?null:!!row.unresolved}));
}
