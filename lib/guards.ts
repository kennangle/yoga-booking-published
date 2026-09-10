// ============================================================
// Class Booking — Neon/Postgres guard layer
// Ported from the Cloudflare D1 version. The role -> permission -> screen
// logic is IDENTICAL to the original; only the DB client plumbing and the
// two SQLite-specific statements changed. Those changes are marked [PORT].
// ============================================================

import type { NeonQueryFunction } from "@neondatabase/serverless";

// A Neon `sql` tagged-template client. `sql\`...\`` returns the rows array;
// `sql.transaction([...])` runs several statements atomically.
export type Sql = NeonQueryFunction<false, false>;

export type Role = "student" | "instructor" | "owner";

export type Permission =
  | "read_schedule"
  | "create_booking"
  | "read_own_booking"
  | "read_class_roster"
  | "create_class"
  | "update_class"
  | "delete_class"
  | "create_user"     // "Create Instructor"
  | "update_user";    // "Update Instructor"

// ---- Role -> Permission map (single source of truth) — UNCHANGED ----
const ROLE_PERMS: Record<Role, Permission[]> = {
  student:    ["read_schedule", "create_booking", "read_own_booking"],
  instructor: ["read_schedule", "read_class_roster"],
  owner:      ["read_schedule", "read_class_roster",
               "create_class", "update_class", "delete_class",
               "create_user", "update_user"],
};

// ---- Screen -> required permissions (ANY-of; OR-gate) — UNCHANGED ----
export const SCREEN_GATES = {
  schedule:            ["read_schedule"],
  book_class:          ["create_booking"],
  my_bookings:         ["read_own_booking"],
  class_roster:        ["read_class_roster"],
  manage_schedule:     ["create_class", "update_class", "delete_class"],
  manage_instructors:  ["create_user", "update_user"],
} satisfies Record<string, Permission[]>;

export type Screen = keyof typeof SCREEN_GATES;

// ---- Permission resolution — UNCHANGED (pure functions, no DB) ----
export function permissionsFor(roles: Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMS[r] ?? []) out.add(p);
  return out;
}

export function can(roles: Role[], perm: Permission): boolean {
  return permissionsFor(roles).has(perm);
}

export function canAccessScreen(roles: Role[], screen: Screen): boolean {
  const perms = permissionsFor(roles);
  return SCREEN_GATES[screen].some((p) => perms.has(p));
}

// ============================================================
// Data-access helpers
// ============================================================

// [PORT] D1 .prepare().bind().all() -> Neon tagged template.
export async function loadRoles(sql: Sql, userId: string): Promise<Role[]> {
  const rows = await sql`SELECT role FROM user_roles WHERE user_id = ${userId}` as { role: Role }[];
  return rows.map((r) => r.role);
}

// [PORT] readSchedule was imported by index.ts but not present in the
// attached guards.ts, so it is RECONSTRUCTED from its call sites: the UI
// expects { id, title, booked, capacity } per class. Verify shape on first
// deploy against the real generated source if it differs.
export async function readSchedule(sql: Sql) {
  return await sql`
    SELECT c.id,
           c.title,
           c.capacity,
           COUNT(b.id)::int AS booked
      FROM classes c
      LEFT JOIN bookings b ON b.class_id = c.id
     GROUP BY c.id, c.title, c.capacity, c.starts_at
     ORDER BY c.starts_at`;
}

// ============================================================
// Booking guards — precedence UNCHANGED:
//   1. create_booking permission (role gate)
//   2. double-book (UNIQUE constraint)
//   3. capacity (atomic conditional insert)
// ============================================================

export type BookResult =
  | { ok: true; bookingId: string }
  | { ok: false; code: "not_student" | "already_booked" | "class_full" | "no_such_class"; message: string };

export async function createBooking(
  sql: Sql,
  roles: Role[],
  classId: string,
  userId: string,
  bookingId: string,
): Promise<BookResult> {
  // 1. Permission gate — UNCHANGED
  if (!can(roles, "create_booking")) {
    return { ok: false, code: "not_student", message: "User lacks create_booking (student role required)." };
  }

  // 2. Double-book pre-check — friendly message; the UNIQUE constraint is
  //    still the real guard, caught below on a race. [PORT] .first() -> rows.
  const dupe = await sql`
    SELECT 1 FROM bookings WHERE class_id = ${classId} AND user_id = ${userId} LIMIT 1`;
  if (dupe.length > 0) {
    return { ok: false, code: "already_booked", message: "User already holds a booking in this class." };
  }

  // 3. [PORT] Atomic capacity guard. SQLite used a conditional INSERT..SELECT
  //    and read changes() to see if it fired. Postgres form: same conditional
  //    INSERT..SELECT, but RETURNING id tells us directly whether a row landed
  //    (empty result = WHERE was false = class full or missing). Postgres also
  //    HAS row locking, so this is a genuine atomic insert, not a workaround.
  let inserted: { id: string }[];
  try {
    inserted = await sql`
      INSERT INTO bookings (id, class_id, user_id)
      SELECT ${bookingId}, ${classId}, ${userId}
      WHERE EXISTS (SELECT 1 FROM classes WHERE id = ${classId})
        AND (
          (SELECT capacity FROM classes WHERE id = ${classId}) IS NULL
          OR (SELECT COUNT(*) FROM bookings WHERE class_id = ${classId})
             < (SELECT capacity FROM classes WHERE id = ${classId})
        )
      RETURNING id` as { id: string }[];
  } catch (e: any) {
    // UNIQUE(class_id, user_id) lost a race between pre-check and insert.
    // [PORT] Postgres surfaces this as SQLSTATE 23505.
    const msg = String(e?.code ?? e?.message ?? e);
    if (msg.includes("23505") || msg.toUpperCase().includes("UNIQUE")) {
      return { ok: false, code: "already_booked", message: "User already holds a booking in this class." };
    }
    throw e;
  }

  // [PORT] Empty RETURNING = WHERE was false. Disambiguate full vs missing.
  if (inserted.length === 0) {
    const cls = await sql`SELECT id FROM classes WHERE id = ${classId}`;
    return cls.length > 0
      ? { ok: false, code: "class_full", message: "Class is at capacity." }
      : { ok: false, code: "no_such_class", message: "No such class." };
  }

  return { ok: true, bookingId };
}

// ============================================================
// Read Own Bookings — "own" := booking.user_id == current_user.id — UNCHANGED logic
// ============================================================
export async function readOwnBookings(sql: Sql, roles: Role[], userId: string) {
  if (!can(roles, "read_own_booking")) {
    return { ok: false as const, code: "forbidden", message: "User lacks read_own_booking." };
  }
  const bookings = await sql`
    SELECT b.id, b.class_id, c.title, c.starts_at
      FROM bookings b JOIN classes c ON c.id = b.class_id
     WHERE b.user_id = ${userId}
     ORDER BY c.starts_at`;
  return { ok: true as const, bookings };
}

// ============================================================
// Create Instructor := create a User carrying `instructor`.
// [PORT] D1 db.batch() (implicit txn) -> Neon sql.transaction([...]).
// ============================================================
export async function createInstructor(
  sql: Sql,
  actorRoles: Role[],
  newUserId: string,
  name: string,
) {
  if (!can(actorRoles, "create_user")) {
    return { ok: false as const, code: "forbidden", message: "User lacks create_user (owner role required)." };
  }
  await sql.transaction([
    sql`INSERT INTO users (id, name) VALUES (${newUserId}, ${name})`,
    sql`INSERT INTO user_roles (user_id, role) VALUES (${newUserId}, 'instructor')`,
  ]);
  return { ok: true as const, userId: newUserId };
}
