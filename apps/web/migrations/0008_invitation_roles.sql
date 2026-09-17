-- 0008: invitation roles + the third Adult role ("Content Manager").
--
-- SQLite cannot drop or alter a CHECK constraint in place, so Users is rebuilt
-- with the widened role CHECK. Foreign keys are disabled only for the rebuild
-- window and verified afterwards. CoachInvitations gains the invited role
-- (existing rows default to 'Admin', matching the historical hardcode).

PRAGMA foreign_keys = OFF;

CREATE TABLE Users_new (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES Organizations(id), user_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 email TEXT COLLATE NOCASE, display_name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('Adult','Student')),
 role TEXT NOT NULL CHECK(role IN ('Owner','Admin','Content Manager','Student')), password_hash TEXT NOT NULL,
 credential_version TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

INSERT INTO Users_new SELECT * FROM Users;

DROP TABLE Users;

ALTER TABLE Users_new RENAME TO Users;

CREATE UNIQUE INDEX IF NOT EXISTS Users_email ON Users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS Users_org ON Users(org_id,kind);

ALTER TABLE CoachInvitations ADD COLUMN role TEXT NOT NULL DEFAULT 'Admin';

PRAGMA foreign_key_check;

PRAGMA foreign_keys = ON;
