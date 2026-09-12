-- Additive projection index. Legacy sessions, awards and Honors remain untouched.
CREATE INDEX IF NOT EXISTS Records_training_scope ON Records(org_id,season_id,owner_id,kind,id) WHERE season_id IS NOT NULL;
