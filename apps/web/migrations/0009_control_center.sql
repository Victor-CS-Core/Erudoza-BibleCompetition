-- 0009: Admin Control Center support state.
--
-- Users.created_at (epoch ms, matching Sessions and CoachInvitations) powers
-- join dates and the "new this month" delta. Existing rows are backfilled
-- from the most precise surviving source first: the consumed auth challenge
-- that created the account, then the account's earliest audit action, then
-- its earliest practice session. Rows with no surviving source stay NULL and
-- the UI shows an honest dash instead of a guessed date.
--
-- DailyActivity is the durable sessions-per-day rollup (audit rows purge at
-- 90 days, so the chart cannot derive from them forever). It is backfilled
-- from stored completed sessions, keyed by the session's credited local date
-- where the record carries one and by the UTC completion date otherwise.
-- Session completion increments it from here on.
--
-- SupportInbox and SupportTickets are the support-ticket store behind the
-- control center. SupportInbox rows arrive through the token-guarded ingest
-- endpoint. A ticket is created from an inbox row or by hand, and
-- source_message_id is unique so one email can only ever become one ticket.
--
-- ErrorEvents is the worker's durable 5xx log: the fetch handler's catch
-- path records one row per server error, rolled to 30 days on write.

ALTER TABLE Users ADD COLUMN created_at INTEGER;

UPDATE Users SET created_at = (SELECT min(c.consumed_at) FROM AuthChallenges c WHERE c.user_id = Users.id AND c.consumed_at IS NOT NULL)
WHERE created_at IS NULL AND EXISTS (SELECT 1 FROM AuthChallenges c WHERE c.user_id = Users.id AND c.consumed_at IS NOT NULL);

UPDATE Users SET created_at = (SELECT min(CAST(strftime('%s', json_extract(r.data, '$.createdAtUtc')) AS INTEGER) * 1000) FROM Records r WHERE r.kind = 'audit' AND json_extract(r.data, '$.actorId') = Users.id AND json_extract(r.data, '$.createdAtUtc') IS NOT NULL)
WHERE created_at IS NULL AND EXISTS (SELECT 1 FROM Records r WHERE r.kind = 'audit' AND json_extract(r.data, '$.actorId') = Users.id AND json_extract(r.data, '$.createdAtUtc') IS NOT NULL);

UPDATE Users SET created_at = (SELECT min(CAST(strftime('%s', json_extract(r.data, '$.createdAtUtc')) AS INTEGER) * 1000) FROM Records r WHERE r.kind IN ('session', 'pbe-session') AND r.owner_id = Users.id AND json_extract(r.data, '$.createdAtUtc') IS NOT NULL)
WHERE created_at IS NULL AND EXISTS (SELECT 1 FROM Records r WHERE r.kind IN ('session', 'pbe-session') AND r.owner_id = Users.id AND json_extract(r.data, '$.createdAtUtc') IS NOT NULL);

CREATE TABLE DailyActivity (
 day TEXT NOT NULL, org_id TEXT NOT NULL REFERENCES Organizations(id),
 sessions INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (day, org_id)
);

INSERT INTO DailyActivity(day, org_id, sessions)
SELECT COALESCE(json_extract(r.data, '$.training.creditedLocalDate'), json_extract(r.data, '$.creditedLocalDate'), date(json_extract(r.data, '$.completedAtUtc'))) AS day, r.org_id, count(*)
FROM Records r
WHERE r.kind IN ('session', 'pbe-session') AND json_extract(r.data, '$.status') = 'Completed' AND json_extract(r.data, '$.completedAtUtc') IS NOT NULL
GROUP BY day, r.org_id;

CREATE TABLE SupportInbox (
 id TEXT PRIMARY KEY, source_message_id TEXT NOT NULL UNIQUE,
 requester_name TEXT NOT NULL, requester_email TEXT,
 subject TEXT NOT NULL, snippet TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
 received_at INTEGER NOT NULL, ticket_id TEXT
);

CREATE TABLE SupportTickets (
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE,
 source TEXT NOT NULL CHECK (source IN ('email', 'manual')),
 source_message_id TEXT, requester_name TEXT NOT NULL, requester_email TEXT,
 subject TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Open', 'Waiting', 'Resolved')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX SupportTickets_message ON SupportTickets(source_message_id) WHERE source_message_id IS NOT NULL;

CREATE TABLE ErrorEvents (
 id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL,
 route_area TEXT NOT NULL, status INTEGER NOT NULL, error_name TEXT
);

CREATE INDEX ErrorEvents_time ON ErrorEvents(occurred_at);
