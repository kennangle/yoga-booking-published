-- ============================================================
-- Class Booking — Postgres (Neon) schema
-- Ported from the D1/SQLite schema. Same resolved spec:
--   User.roles is a set; Booking -> one Class + one User;
--   capacity nullable (null = unlimited); no double-booking a class.
--
-- IF NOT EXISTS on every object so this is safe to run on every cold
-- start (the first-boot migration mechanism). Running it twice is a
-- no-op, so concurrent boots cannot corrupt or duplicate the schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('student', 'instructor', 'owner')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS classes (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  starts_at     TIMESTAMPTZ NOT NULL,        -- was TEXT in SQLite; Postgres has a real type
  instructor_id TEXT NOT NULL REFERENCES users(id),
  capacity      INTEGER CHECK (capacity IS NULL OR capacity > 0)
);

CREATE TABLE IF NOT EXISTS bookings (
  id       TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  UNIQUE (class_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_class ON bookings (class_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user  ON bookings (user_id);
