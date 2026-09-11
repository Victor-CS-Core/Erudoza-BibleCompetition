-- Day/week/mission/projection reads use deterministic Records primary keys, so no
-- history scan or extra JSON indexes are needed for those point lookups.
-- This unique partial index protects idempotent start intents across sessions.
CREATE UNIQUE INDEX IF NOT EXISTS Records_training_start ON Records(org_id,owner_id,json_extract(data,'$.training.clientStartId'))
WHERE kind='session' AND json_extract(data,'$.training.clientStartId') IS NOT NULL;
