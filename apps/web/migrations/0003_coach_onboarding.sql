CREATE TABLE AuthBudgets (
 key TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX AuthBudgets_expiry ON AuthBudgets(expires_at);
CREATE INDEX LoginLimits_window ON LoginLimits(window);
CREATE INDEX Sessions_user ON Sessions(user_id);
CREATE TABLE CoachInvitations (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES Organizations(id),
 email TEXT NOT NULL COLLATE NOCASE, inviter_id TEXT NOT NULL REFERENCES Users(id),
 token_hash TEXT NOT NULL UNIQUE, version TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','revoked')),
 delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered IN (0,1)),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 accepted_user_id TEXT REFERENCES Users(id)
);
CREATE INDEX CoachInvitations_scope ON CoachInvitations(org_id,status,expires_at);
CREATE INDEX CoachInvitations_recent ON CoachInvitations(org_id,created_at DESC);
CREATE INDEX CoachInvitations_email ON CoachInvitations(org_id,email,status);
CREATE INDEX CoachInvitations_expiry ON CoachInvitations(expires_at);
CREATE TABLE AuthChallenges (
 id TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('signup','password','invitation')),
 email TEXT NOT NULL COLLATE NOCASE, code_digest TEXT NOT NULL,
 user_id TEXT REFERENCES Users(id), credential_version TEXT,
 invitation_id TEXT REFERENCES CoachInvitations(id), invitation_version TEXT,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered IN (0,1)),
 consumed_at INTEGER, claim_nonce TEXT
);
CREATE INDEX AuthChallenges_email ON AuthChallenges(email,purpose,consumed_at);
CREATE INDEX AuthChallenges_invitation ON AuthChallenges(invitation_id,consumed_at);
CREATE INDEX AuthChallenges_expiry ON AuthChallenges(expires_at);
