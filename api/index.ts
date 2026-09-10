// ============================================================
// Vercel serverless function — mirrors the original Cloudflare Worker
// router. Same routes, same GRANT/DENY behavior; the fetch(Request) handler
// becomes a Vercel (req, res) handler and DB access goes through the Neon
// `sql` client instead of env.DB.
//
// Runtime note: Node serverless (not edge) for Phase 1 validation, because
// ensureSchema() reads schema.sql off the filesystem. Edge is viable later
// (Neon has an edge driver) once the migration mechanism doesn't need fs —
// this is the "serverless vs edge" open question, deferred as spec'd.
// ============================================================

import { sql, ensureSchema } from "../lib/db.js";
import {
  loadRoles, createBooking, readOwnBookings, readSchedule,
  canAccessScreen, type Screen,
} from "../lib/guards.js";

export const config = { runtime: "nodejs" };

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Yoga Booking</title>
<style>
  body { font-family: "Iowan Old Style", Georgia, serif; background: #fbfaf7;
         color: #1a2b34; max-width: 640px; margin: 2rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .who { font-size: .85rem; color: #4a5c66; margin-bottom: 1.5rem; }
  .who select { font: inherit; font-size: .85rem; padding: .15rem .4rem; }
  .class { display: flex; align-items: center; justify-content: space-between;
           gap: 1rem; border: 1px solid #dfe4e6; border-radius: 10px;
           padding: .8rem 1rem; margin-bottom: .6rem; background: #fff; }
  .meta .title { font-weight: 600; }
  .meta .seats { font-size: .8rem; color: #4a5c66; font-family: ui-monospace, monospace; }
  button { font: inherit; cursor: pointer; border: 1px solid #0f6d76;
           background: #0f6d76; color: #fff; padding: .4rem .9rem; border-radius: 8px; }
  button:disabled { background: #fbfaf7; color: #4a5c66; border-color: #dfe4e6; cursor: not-allowed; }
  .msg { font-size: .8rem; margin-top: .3rem; font-family: ui-monospace, monospace; min-height: 1em; }
  .msg.ok { color: #0f6d76; } .msg.err { color: #a03449; }
</style></head><body>
<h1>Class Schedule</h1>
<div class="who">Booking as
  <select id="who">
    <option value="u_self">You (student)</option>
    <option value="u_c">Cara (student)</option>
    <option value="u_owner">Olivia (owner — no booking rights)</option>
  </select>
</div>
<div id="list">Loading…</div>
<script>
  const who = document.getElementById("who");
  const list = document.getElementById("list");
  async function load() {
    const rows = await (await fetch("/schedule")).json();
    list.innerHTML = "";
    for (const c of rows) {
      const cap = c.capacity === null ? "\u221e" : c.capacity;
      const full = c.capacity !== null && c.booked >= c.capacity;
      const row = document.createElement("div");
      row.className = "class";
      row.innerHTML =
        '<div class="meta"><div class="title">' + c.title + '</div>' +
        '<div class="seats">seats: ' + c.booked + ' / ' + cap + '</div>' +
        '<div class="msg" id="m_' + c.id + '"></div></div>' +
        '<button ' + (full ? "disabled" : "") + ' data-id="' + c.id + '">' +
        (full ? "Full" : "Book") + '</button>';
      list.appendChild(row);
    }
    list.querySelectorAll("button[data-id]").forEach(b =>
      b.addEventListener("click", () => book(b.dataset.id)));
  }
  async function book(classId) {
    const res = await fetch("/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": who.value },
      body: JSON.stringify({ classId }),
    });
    const data = await res.json();
    const m = document.getElementById("m_" + classId);
    if (data.ok) {
      await load();
      if (m) { m.textContent = "booked \u2713"; m.className = "msg ok"; }
    } else if (m) {
      m.textContent = data.code; m.className = "msg err";
    }
  }
  load();
</script></body></html>`;

// Vercel passes Node-style req/res. Keep a tiny json() helper for parity.
export default async function handler(req: any, res: any) {
  await ensureSchema();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  const json = (body: unknown, status = 200) => {
    res.status(status).setHeader("content-type", "application/json");
    res.send(JSON.stringify(body, null, 2));
  };

  if (method === "GET" && (path === "/" || path === "/api" || path === "/api/index")) {
    res.status(200).setHeader("content-type", "text/html");
    res.send(PAGE);
    return;
  }

  if (method === "GET" && path === "/schedule") {
    return json(await readSchedule(sql));
  }

  const userId = (req.headers["x-user-id"] as string) ?? "u_self";
  const roles = await loadRoles(sql, userId);

  if (method === "POST" && path === "/bookings") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const classId = body.classId as string;
    const bookingId = crypto.randomUUID();
    const result = await createBooking(sql, roles, classId, userId, bookingId);
    return json(result, result.ok ? 201 : 409);
  }

  if (method === "GET" && path === "/my-bookings") {
    const result = await readOwnBookings(sql, roles, userId);
    return json(result, result.ok ? 200 : 403);
  }

  if (method === "GET" && path.startsWith("/can/")) {
    const screen = path.slice("/can/".length) as Screen;
    return json({ userId, roles, screen, allowed: canAccessScreen(roles, screen) });
  }

  return json({ error: "not_found", routes: ["GET /", "GET /schedule", "POST /bookings", "GET /my-bookings", "GET /can/:screen"] }, 404);
}
