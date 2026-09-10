// One-off local seed: node scripts/seed.mjs
// Requires DATABASE_URL in the environment (your Neon connection string).
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL first."); process.exit(1); }

const sql = neon(url);

// The Neon HTTP driver runs ONE statement per call — no multi-statement
// blobs. Split on statement-terminating semicolons and run each in turn.
function splitStatements(text) {
  return text
    .split(/;\s*$/m)
    .map((s) => s.replace(/--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

async function runFile(path) {
  for (const stmt of splitStatements(readFileSync(path, "utf8"))) {
    await sql(stmt);
  }
}

console.log("Applying schema…");
await runFile("lib/schema.sql");
console.log("Seeding demo data…");
await runFile("lib/seed.sql");
console.log("Done.");
