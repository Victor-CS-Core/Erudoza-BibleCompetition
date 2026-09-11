-- Keep the logical primary key and both query indexes while removing the extra
-- rowid table write. Apply this file as one migration transaction.
CREATE TABLE Records_without_rowid (
 kind TEXT NOT NULL, id TEXT NOT NULL, org_id TEXT NOT NULL REFERENCES Organizations(id),
 season_id TEXT, owner_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)), revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(kind,id,org_id)
) WITHOUT ROWID;
INSERT INTO Records_without_rowid(kind,id,org_id,season_id,owner_id,data,revision)
 SELECT kind,id,org_id,season_id,owner_id,data,revision FROM Records;
DROP TABLE Records;
ALTER TABLE Records_without_rowid RENAME TO Records;
CREATE INDEX Records_scope ON Records(org_id,kind,season_id,id);
CREATE INDEX Records_owner ON Records(org_id,kind,owner_id,id);
