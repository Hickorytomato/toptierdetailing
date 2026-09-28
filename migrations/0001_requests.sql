-- New booking tables for the rebuilt site.
-- The old `bookings` table from the first version is left alone.

CREATE TABLE IF NOT EXISTS requests (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'confirmed', 'declined', 'done', 'cancelled')),
  service      TEXT NOT NULL,
  addons       TEXT NOT NULL DEFAULT '',
  date         TEXT NOT NULL,          -- YYYY-MM-DD, Tulsa time
  time_window  TEXT NOT NULL,          -- evening | morning | afternoon | allday
  vehicle      TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,          -- 10 digits
  address      TEXT NOT NULL,
  photo_count  INTEGER NOT NULL DEFAULT 0,
  carlos_note  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_status_date ON requests (status, date);
CREATE INDEX IF NOT EXISTS idx_requests_phone ON requests (phone, created_at);

CREATE TABLE IF NOT EXISTS request_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  TEXT NOT NULL,
  mime        TEXT NOT NULL,
  data        BLOB NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_request ON request_photos (request_id);

CREATE TABLE IF NOT EXISTS blocked_dates (
  date        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);
