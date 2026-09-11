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
<title>Serenity Yoga — Class Schedule</title>
<style>
  :root {
    --terracotta: #c05f3c;
    --terracotta-dark: #a34e30;
    --ink: #3a3630;
    --ink-soft: #7a736a;
    --ground: #faf7f2;
    --panel: #ffffff;
    --line: #e7e0d6;
    --teal: #0f6d76;
    --rose: #a03449;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
    line-height: 1.55;
  }
  /* ---- Top nav ---- */
  .nav {
    display: flex; align-items: center; gap: 2rem;
    padding: 1.1rem 2rem;
    border-bottom: 1px solid var(--line);
    background: var(--ground);
  }
  .brand {
    font-size: 1.5rem; font-weight: 700; letter-spacing: -.01em;
    color: var(--terracotta); text-decoration: none; margin-right: .5rem;
  }
  .nav .links { display: flex; gap: 1.6rem; flex: 1; }
  .nav .links a {
    color: var(--ink); text-decoration: none; font-size: 1rem;
    padding-bottom: .2rem;
  }
  .nav .links a.active {
    color: var(--terracotta); border-bottom: 2px solid var(--terracotta);
  }
  .nav .signin {
    color: var(--ink); text-decoration: none; font-size: 1rem;
  }
  .nav .cta {
    background: var(--terracotta); color: #fff; text-decoration: none;
    font-size: .95rem; padding: .55rem 1.1rem; border-radius: 8px;
  }
  .nav .cta:hover { background: var(--terracotta-dark); }
  /* ---- Hero ---- */
  .hero {
    padding: 2.6rem 2rem 2rem;
    border-bottom: 1px solid var(--line);
  }
  .hero h1 { font-size: 3rem; margin: 0 0 .5rem; letter-spacing: -.015em; }
  .hero p { font-size: 1.15rem; color: var(--ink-soft); margin: 0; }
  /* ---- Booking-as control (the one live control) ---- */
  .bookingbar {
    display: flex; align-items: center; gap: .6rem;
    padding: 1.2rem 2rem 0;
  }
  .bookingbar label { font-size: .95rem; color: var(--ink-soft); }
  .bookingbar select {
    font: inherit; font-size: .95rem; padding: .5rem .7rem;
    border: 1px solid var(--line); border-radius: 8px;
    background: var(--panel); color: var(--ink); min-width: 260px;
  }
  /* ---- Class list ---- */
  .wrap { max-width: 940px; margin: 0 auto; padding: 1.4rem 2rem 3rem; }
  .class {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; border: 1px solid var(--line); border-radius: 12px;
    padding: 1.1rem 1.3rem; margin-bottom: .8rem; background: var(--panel);
  }
  .meta .title { font-weight: 700; font-size: 1.15rem; }
  .meta .seats {
    font-size: .85rem; color: var(--ink-soft);
    font-family: ui-monospace, Menlo, monospace; margin-top: .15rem;
  }
  button {
    font: inherit; cursor: pointer; border: 1px solid var(--terracotta);
    background: var(--terracotta); color: #fff;
    padding: .6rem 1.4rem; border-radius: 8px; font-size: 1rem;
  }
  button:hover:not(:disabled) { background: var(--terracotta-dark); }
  button:disabled {
    background: var(--ground); color: var(--ink-soft);
    border-color: var(--line); cursor: not-allowed;
  }
  .msg {
    font-size: .8rem; margin-top: .3rem;
    font-family: ui-monospace, Menlo, monospace; min-height: 1em;
  }
  .msg.ok { color: var(--teal); }
  .msg.err { color: var(--rose); }
  @media (max-width: 620px) {
    .nav { gap: 1rem; padding: 1rem 1.25rem; flex-wrap: wrap; }
    .nav .links { gap: 1rem; order: 3; flex-basis: 100%; }
    .hero { padding: 1.8rem 1.25rem 1.4rem; }
    .hero h1 { font-size: 2.1rem; }
    .bookingbar { padding: 1rem 1.25rem 0; flex-wrap: wrap; }
    .bookingbar select { min-width: 0; width: 100%; }
    .wrap { padding: 1.2rem 1.25rem 2.5rem; }
  }
</style></head><body>
<nav class="nav">
  <a href="/" class="brand">Serenity Yoga</a>
  <div class="links">
    <a href="/" class="active">Schedule</a>
    <a href="/">Instructors</a>
    <a href="/">Pricing</a>
  </div>
  <a href="/" class="signin">Sign In</a>
  <a href="/" class="cta">Get Started</a>
</nav>

<header class="hero">
  <h1>Class Schedule</h1>
  <p>Find your perfect session and book your spot. All levels welcome.</p>
</header>

<div class="bookingbar">
  <label for="who">Booking as</label>
  <select id="who">
    <option value="u_self">You (student)</option>
    <option value="u_c">Cara (student)</option>
    <option value="u_owner">Olivia (owner — no booking rights)</option>
  </select>
</div>

<main class="wrap">
  <div id="list">Loading…</div>
</main>

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
