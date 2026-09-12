-- Immutable bounded nodes. A Records match manifest is published only after complete verification.
CREATE TABLE PracticeRoomComponents (
  org_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, season_id, room_id, hash)
) WITHOUT ROWID;
