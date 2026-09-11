// ============================================================
// Neon connection + first-boot schema (cold-start migration) + demo seed.
//
// Decision (Phase 1): schema runs on cold start, not as a build step.
// Rationale: it mirrors what the non-technical Deploy-Button user's flow
// does — no build config they must touch — so validating it here de-risks
// Phase 3. schema.sql is idempotent (IF NOT EXISTS), so re-running is a
// no-op; the module-level promise below means a single warm instance runs
// it at most once and concurrent requests await the same promise.
//
// Decision (Phase 3): after the schema runs, seedDemo() populates sample
// data ONLY on an empty database. The Deploy Button is a demo/showcase, so
// a fresh clone should land on a populated schedule, not blank cards. A
// real user's populated DB is never touched (COUNT guard + ON CONFLICT).
// ============================================================

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (Neon integration should inject it).");

export const sql = neon(url);

let migrated: Promise<void> | null = null;

// The Neon HTTP driver runs ONE statement per call — no multi-statement
// blobs. Split the file on semicolons (safe here: the DDL has no semicolons
// inside string literals or bodies) and run each idempotent statement.
function splitStatements(sqlText: string): string[] {
  return sqlText
    .split(/;\s*$/m)
    .map((s) => s.replace(/--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

// Demo seed — runs once, only on an empty database. The COUNT guard means a
// fresh Deploy-Button DB gets sample data (so the schedule looks alive), while
// a user's real DB is never touched. Timestamps are relative to now() so the
// demo always shows upcoming classes regardless of when it's deployed.
//
// Idempotency is belt-and-suspenders: the COUNT short-circuits the whole seed
// on any non-empty DB, and ON CONFLICT DO NOTHING guards against a race between
// two concurrent cold-starts. One statement per sql() call, per the Neon HTTP
// driver's no-multi-statement rule. COUNT(*) is cast ::int because the driver
// returns bigint as a string, which would make count > 0 a string comparison.
//
// Scope: classes + instructor only, no bookings. Two upcoming classes make the
// schedule look alive; seeded bookings would make capacity counts nonzero and
// muddy the demo. FK order matters: classes.instructor_id references users(id),
// so the instructor user is inserted before the classes.
async function seedDemo(): Promise<void> {
  const [{ count }] = await sql(`SELECT COUNT(*)::int AS count FROM classes`);
  if (count > 0) return;

  // users first (classes.instructor_id -> users.id)
  await sql(`INSERT INTO users (id, name) VALUES ('u_maya', 'Maya Chen') ON CONFLICT (id) DO NOTHING`);
  await sql(`INSERT INTO user_roles (user_id, role) VALUES ('u_maya', 'instructor') ON CONFLICT DO NOTHING`);

  // classes (starts_at relative to now; capacity 2 and NULL/unlimited)
  await sql(`INSERT INTO classes (id, title, starts_at, instructor_id, capacity)
             VALUES ('c_vin', 'Vinyasa Flow', now() + interval '1 day', 'u_maya', 2)
             ON CONFLICT (id) DO NOTHING`);
  await sql(`INSERT INTO classes (id, title, starts_at, instructor_id, capacity)
             VALUES ('c_yin', 'Yin & Restore', now() + interval '2 day', 'u_maya', NULL)
             ON CONFLICT (id) DO NOTHING`);
}

export function ensureSchema(): Promise<void> {
  if (!migrated) {
    migrated = (async () => {
      const ddl = readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8");
      for (const stmt of splitStatements(ddl)) {
        await sql(stmt);
      }
      await seedDemo();
    })().catch((e) => {
      // Reset so a transient failure retries on the next request instead of
      // caching a rejected promise forever.
      migrated = null;
      throw e;
    });
  }
  return migrated;
}
