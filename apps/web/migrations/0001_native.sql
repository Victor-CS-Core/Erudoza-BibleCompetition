PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS Organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS Users (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES Organizations(id), user_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 email TEXT COLLATE NOCASE, display_name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('Adult','Student')),
 role TEXT NOT NULL CHECK(role IN ('Owner','Admin','Student')), password_hash TEXT NOT NULL,
 credential_version TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS Users_email ON Users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS Users_org ON Users(org_id,kind);
CREATE TABLE IF NOT EXISTS Sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES Users(id) ON DELETE CASCADE, credential_version TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS Sessions_expiry ON Sessions(expires_at);
CREATE TABLE IF NOT EXISTS LoginLimits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS Records (
 kind TEXT NOT NULL, id TEXT NOT NULL, org_id TEXT NOT NULL REFERENCES Organizations(id),
 season_id TEXT, owner_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)), revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(kind,id,org_id)
);
CREATE INDEX IF NOT EXISTS Records_scope ON Records(org_id,kind,season_id,id);
CREATE INDEX IF NOT EXISTS Records_owner ON Records(org_id,kind,owner_id,id);
