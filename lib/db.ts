// ============================================================
// Neon connection + first-boot schema (cold-start migration).
//
// Decision (Phase 1): schema runs on cold start, not as a build step.
// Rationale: it mirrors what the non-technical Deploy-Button user's flow
// does — no build config they must touch — so validating it here de-risks
// Phase 3. schema.sql is idempotent (IF NOT EXISTS), so re-running is a
// no-op; the module-level promise below means a single warm instance runs
// it at most once and concurrent requests await the same promise.
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

export function ensureSchema(): Promise<void> {
  if (!migrated) {
    migrated = (async () => {
      const ddl = readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8");
      for (const stmt of splitStatements(ddl)) {
        await sql(stmt);
      }
    })().catch((e) => {
      // Reset so a transient failure retries on the next request instead of
      // caching a rejected promise forever.
      migrated = null;
      throw e;
    });
  }
  return migrated;
}
