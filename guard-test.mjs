// Guard-layer test against real Postgres. Run from the repo root:
//   node guard-test.mjs
// Requires DATABASE_URL in the environment.
import { neon } from "@neondatabase/serverless";
import { createBooking } from "./lib/guards.ts";
import { randomUUID } from "node:crypto";

const sql = neon(process.env.DATABASE_URL);
const student = ["student"], owner = ["owner"], instructor = ["instructor"];
let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} got=${got} want=${want}`);
  ok ? pass++ : fail++;
};

// Vinyasa (c_vin) has capacity 2. Book two different students -> both ok.
const r1 = await createBooking(sql, student, "c_vin", "u_self", randomUUID());
check("vinyasa #1 (u_self)", r1.ok ? "ok" : r1.code, "ok");

const r2 = await createBooking(sql, student, "c_vin", "u_c", randomUUID());
check("vinyasa #2 (u_c)", r2.ok ? "ok" : r2.code, "ok");

// Fresh third student -> capacity reached.
await sql`INSERT INTO users (id,name) VALUES ('u_x','Xander') ON CONFLICT DO NOTHING`;
await sql`INSERT INTO user_roles (user_id,role) VALUES ('u_x','student') ON CONFLICT DO NOTHING`;
const r3 = await createBooking(sql, student, "c_vin", "u_x", randomUUID());
check("vinyasa #3 -> full", r3.ok ? "ok" : r3.code, "class_full");

// Same student rebooks same class -> double-book precedes capacity.
const rDup = await createBooking(sql, student, "c_vin", "u_self", randomUUID());
check("vinyasa dup (u_self)", rDup.ok ? "ok" : rDup.code, "already_booked");

// Unlimited class (c_yin, capacity null) -> always ok.
const rY = await createBooking(sql, student, "c_yin", "u_self", randomUUID());
check("yin unlimited (u_self)", rY.ok ? "ok" : rY.code, "ok");

// Permission gate: owner and instructor cannot book.
const rO = await createBooking(sql, owner, "c_yin", "u_owner", randomUUID());
check("owner -> not_student", rO.ok ? "ok" : rO.code, "not_student");
const rI = await createBooking(sql, instructor, "c_yin", "u_inst", randomUUID());
check("instructor -> not_student", rI.ok ? "ok" : rI.code, "not_student");

// Missing class.
const rM = await createBooking(sql, student, "c_nope", "u_self", randomUUID());
check("missing class -> no_such_class", rM.ok ? "ok" : rM.code, "no_such_class");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
