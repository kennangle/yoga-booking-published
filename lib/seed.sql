-- Demo seed — mirrors the users the original index.ts UI expects
-- (u_self, u_c students; u_owner owner) plus a couple of classes.
-- Idempotent via ON CONFLICT so re-seeding is safe.

INSERT INTO users (id, name) VALUES
  ('u_self',  'You'),
  ('u_c',     'Cara'),
  ('u_owner', 'Olivia'),
  ('u_inst',  'Ravi')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role) VALUES
  ('u_self',  'student'),
  ('u_c',     'student'),
  ('u_owner', 'owner'),
  ('u_inst',  'instructor')
ON CONFLICT DO NOTHING;

INSERT INTO classes (id, title, starts_at, instructor_id, capacity) VALUES
  ('c_vin',  'Vinyasa Flow',   '2026-09-15T09:00:00Z', 'u_inst', 2),
  ('c_yin',  'Yin & Restore',  '2026-09-15T18:00:00Z', 'u_inst', NULL)
ON CONFLICT (id) DO NOTHING;
