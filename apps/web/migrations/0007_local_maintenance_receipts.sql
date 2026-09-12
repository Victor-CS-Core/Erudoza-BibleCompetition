-- Closed managed-local restore metadata. Product routes never query these tables.
CREATE TABLE IF NOT EXISTS MaintenanceReceipt (
 id TEXT PRIMARY KEY CHECK (id='global'), identity TEXT NOT NULL, plan_hash TEXT NOT NULL,
 phase TEXT NOT NULL CHECK (phase IN ('closed','verified')), cursor TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE MaintenanceArchives (
 id TEXT NOT NULL, ordinal INTEGER NOT NULL, identity TEXT NOT NULL,
 length INTEGER NOT NULL, hash TEXT NOT NULL, whole_length INTEGER NOT NULL,
 whole_hash TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,ordinal)
) WITHOUT ROWID;
