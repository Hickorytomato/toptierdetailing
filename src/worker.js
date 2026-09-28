// Top Tier Detailing — API worker. Static files are served from /public;
// anything under /api/ lands here.
import {
  SERVICES, ADDONS, WINDOWS, BOOK_AHEAD_DAYS,
  serviceById, serviceLabel, windowsFor, windowOpen, windowLabel,
  addDays, todayChicago, prettyDate,
} from "../public/js/services.js";

const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 900_000; // after client-side compression
const SESSION_DAYS = 90;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, ctx, url);
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong on our end. Try again in a minute." }, 500);
    }
  },
};

async function route(req, env, ctx, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === "/api/availability" && m === "GET") return availability(env);
  if (p === "/api/requests" && m === "POST") return createRequest(req, env, ctx);

  if (p === "/api/admin/login" && m === "POST") return login(req, env);

  // Everything below needs Carlos to be signed in.
  if (p.startsWith("/api/admin/")) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("k") || "";
    if (!(await verifySession(token, env))) return json({ error: "Please sign in again." }, 401);

    if (p === "/api/admin/requests" && m === "GET") return listRequests(env, url);
    let mm = p.match(/^\/api\/admin\/requests\/([A-Z0-9-]+)$/);
    if (mm && m === "POST") return updateRequest(req, env, mm[1]);
    mm = p.match(/^\/api\/admin\/photos\/(\d+)$/);
    if (mm && m === "GET") return photo(env, Number(mm[1]));
    if (p === "/api/admin/days-off" && m === "GET") return daysOff(env);
    if (p === "/api/admin/days-off" && m === "POST") return toggleDayOff(req, env);
  }
  return json({ error: "Not found" }, 404);
}

// ───────────── public ─────────────

async function availability(env) {
  const today = todayChicago();
  const end = addDays(today, BOOK_AHEAD_DAYS);
  const [jobs, blocked] = await Promise.all([
    env.DB.prepare(
      "SELECT date, time_window FROM requests WHERE status = 'confirmed' AND date >= ? AND date <= ?"
    ).bind(today, end).all(),
    env.DB.prepare("SELECT date FROM blocked_dates WHERE date >= ? AND date <= ?").bind(today, end).all(),
  ]);
  const taken = {};
  for (const j of jobs.results) (taken[j.date] ||= []).push({ window: j.time_window });
  return json(
    { today, first: addDays(today, 1), last: end, taken, blocked: blocked.results.map((b) => b.date) },
    200,
    { "Cache-Control": "no-store" }
  );
}

async function createRequest(req, env, ctx) {
  if (Number(req.headers.get("Content-Length") || 0) > 5_000_000) {
    return json({ error: "Those photos are too big. Try fewer photos." }, 413);
  }
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  // Bots fill in the hidden field; people never see it.
  if (body.website) return json({ ok: true, id: "TTD-0", first_name: "" });

  const clean = (v, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const service = serviceById(body.service);
  const date = clean(body.date, 10);
  const win = clean(body.window, 20);
  const vehicle = clean(body.vehicle, 120);
  const name = clean(body.name, 80);
  const phoneDigits = String(body.phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const address = clean(body.address, 200);
  const notes = String(body.notes ?? "").trim().slice(0, 1500);
  const addons = (Array.isArray(body.addons) ? body.addons : [])
    .filter((a) => ADDONS.some((x) => x.id === a)).slice(0, ADDONS.length);

  if (!service) return json({ error: "Pick a service." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Pick a day." }, 400);
  const today = todayChicago();
  if (date <= today || date > addDays(today, BOOK_AHEAD_DAYS)) return json({ error: "Pick a day in the next few weeks." }, 400);
  if (!windowsFor(service, date).includes(win)) return json({ error: "That time doesn't work for this service. Pick another." }, 400);
  if (!vehicle) return json({ error: "What are we detailing? Add the year, make and model." }, 400);
  if (!name) return json({ error: "Add your name." }, 400);
  if (phoneDigits.length !== 10) return json({ error: "Add a 10-digit mobile number so I can text you." }, 400);
  if (address.length < 6) return json({ error: "Add the address where the car will be." }, 400);

  // Is the slot still open?
  const [blocked, jobs] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM blocked_dates WHERE date = ?").bind(date).first(),
    env.DB.prepare("SELECT time_window AS window FROM requests WHERE status = 'confirmed' AND date = ?").bind(date).all(),
  ]);
  if (blocked || !windowOpen(win, jobs.results)) {
    return json({ error: "Someone just grabbed that time. Pick another one.", code: "taken" }, 409);
  }

  // Light spam guard: max 3 requests per phone number per day.
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM requests WHERE phone = ? AND created_at > ?"
  ).bind(phoneDigits, new Date(Date.now() - 86400_000).toISOString()).first();
  if (recent && recent.n >= 3) {
    return json({ error: "Looks like you've already sent a few requests today. I'll text you soon." }, 429);
  }

  // Photos arrive as data URLs, already shrunk by the browser.
  const photos = [];
  for (const d of (Array.isArray(body.photos) ? body.photos : []).slice(0, MAX_PHOTOS)) {
    const mm = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(d));
    if (!mm) continue;
    const bytes = Uint8Array.from(atob(mm[2]), (c) => c.charCodeAt(0));
    if (bytes.length > MAX_PHOTO_BYTES) continue;
    photos.push({ mime: mm[1], bytes });
  }

  const id = "TTD-" + randomCode(5);
  const now = new Date().toISOString();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO requests (id, status, service, addons, date, time_window, vehicle, notes, name, phone, address, photo_count, created_at, updated_at)
       VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, service.id, addons.join(","), date, win, vehicle, notes, name, phoneDigits, address, photos.length, now, now),
    ...photos.map((ph) =>
      env.DB.prepare("INSERT INTO request_photos (request_id, mime, data, created_at) VALUES (?, ?, ?, ?)")
        .bind(id, ph.mime, ph.bytes.buffer, now)
    ),
  ];
  await env.DB.batch(stmts);

  ctx.waitUntil(notifyCarlos(env, { id, service, date, win, vehicle, name, address, photos: photos.length, origin: new URL(req.url).origin }));

  return json({ ok: true, id, first_name: name.split(" ")[0] });
}

async function notifyCarlos(env, r) {
  if (!env.NTFY_TOPIC) return;
  const city = r.address.split(",").slice(1).join(",").trim() || r.address;
  const lines = [
    `${prettyDate(r.date)} · ${windowLabel(r.win)}`,
    `${r.vehicle}${r.photos ? ` · ${r.photos} photo${r.photos > 1 ? "s" : ""}` : ""}`,
    `${r.name.split(" ")[0]} · ${city}`,
  ];
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
      method: "POST",
      headers: {
        Title: `New request: ${serviceLabel(r.service)}`,
        Click: `${r.origin}/admin`,
        Tags: "car",
        Priority: "high",
      },
      body: lines.join("\n"),
    });
  } catch (e) {
    console.error("ntfy failed", e);
  }
}

// ───────────── admin ─────────────

async function login(req, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: "Admin password isn't set up yet." }, 500);
  const { password } = await req.json().catch(() => ({}));
  const ok = await safeEqual(String(password || ""), env.ADMIN_PASSWORD);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Wrong password." }, 401);
  }
  const payload = b64url(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400_000 }));
  return json({ token: `${payload}.${await sign(payload, env)}` });
}

async function listRequests(env, url) {
  const view = url.searchParams.get("view") || "new";
  const today = todayChicago();
  let sql;
  let args = [];
  if (view === "new") {
    sql = "SELECT * FROM requests WHERE status = 'new' ORDER BY date ASC, created_at ASC";
  } else if (view === "upcoming") {
    sql = "SELECT * FROM requests WHERE status = 'confirmed' AND date >= ? ORDER BY date ASC";
    args = [addDays(today, -3)];
  } else {
    sql = "SELECT * FROM requests WHERE status IN ('done','declined','cancelled') OR (status = 'confirmed' AND date < ?) ORDER BY date DESC LIMIT 100";
    args = [addDays(today, -3)];
  }
  const [rows, counts] = await Promise.all([
    env.DB.prepare(sql).bind(...args).all(),
    env.DB.prepare(
      "SELECT SUM(status = 'new') AS new, SUM(status = 'confirmed' AND date >= ?) AS upcoming FROM requests"
    ).bind(addDays(today, -3)).first(),
  ]);
  const ids = rows.results.map((r) => r.id);
  let photoMap = {};
  if (ids.length) {
    const ph = await env.DB.prepare(
      `SELECT id, request_id FROM request_photos WHERE request_id IN (${ids.map(() => "?").join(",")})`
    ).bind(...ids).all();
    for (const x of ph.results) (photoMap[x.request_id] ||= []).push(x.id);
  }
  return json({
    today,
    counts: { new: counts?.new || 0, upcoming: counts?.upcoming || 0 },
    requests: rows.results.map((r) => ({ ...r, photos: photoMap[r.id] || [] })),
  });
}

async function updateRequest(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Couldn't find that request." }, 404);
  const now = new Date().toISOString();
  const note = String(body.note ?? row.carlos_note ?? "").slice(0, 1000);

  const next = { confirm: "confirmed", decline: "declined", done: "done", cancel: "cancelled", reopen: "new" }[body.action];
  if (!next) return json({ error: "Unknown action." }, 400);

  let date = row.date;
  let win = row.time_window;
  if (body.action === "confirm") {
    if (body.date) date = String(body.date);
    if (body.window) win = String(body.window);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !WINDOWS[win]) return json({ error: "Pick a valid day and time." }, 400);
    const clash = await env.DB.prepare(
      "SELECT id, name, time_window AS window FROM requests WHERE status = 'confirmed' AND date = ? AND id != ?"
    ).bind(date, id).all();
    if (!windowOpen(win, clash.results) && !body.force) {
      const other = clash.results[0];
      return json({ error: `You already have ${other.name} booked that day (${WINDOWS[other.window]?.label || other.window}).`, code: "clash" }, 409);
    }
  }
  await env.DB.prepare(
    "UPDATE requests SET status = ?, date = ?, time_window = ?, carlos_note = ?, updated_at = ? WHERE id = ?"
  ).bind(next, date, win, note, now, id).run();
  return json({ ok: true });
}

async function photo(env, id) {
  const row = await env.DB.prepare("SELECT mime, data FROM request_photos WHERE id = ?").bind(id).first();
  if (!row) return new Response("Not found", { status: 404 });
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data);
  return new Response(bytes, { headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=86400" } });
}

async function daysOff(env) {
  const today = todayChicago();
  const end = addDays(today, 70);
  const [blocked, jobs] = await Promise.all([
    env.DB.prepare("SELECT date FROM blocked_dates WHERE date >= ? ORDER BY date").bind(today).all(),
    env.DB.prepare("SELECT date, time_window, name FROM requests WHERE status = 'confirmed' AND date >= ? AND date <= ?").bind(today, end).all(),
  ]);
  return json({ today, end, blocked: blocked.results.map((b) => b.date), jobs: jobs.results });
}

async function toggleDayOff(req, env) {
  const { date, off } = await req.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return json({ error: "Bad date." }, 400);
  if (off) {
    await env.DB.prepare("INSERT OR IGNORE INTO blocked_dates (date, created_at) VALUES (?, ?)").bind(date, new Date().toISOString()).run();
  } else {
    await env.DB.prepare("DELETE FROM blocked_dates WHERE date = ?").bind(date).run();
  }
  return json({ ok: true });
}

// ───────────── helpers ─────────────

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function randomCode(n) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(env) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey("raw", enc.encode("ttd-session:" + env.ADMIN_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(payload, env) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(payload));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifySession(token, env) {
  if (!token || !env.ADMIN_PASSWORD) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!(await safeEqual(sig, await sign(payload, env)))) return false;
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return Date.now() < exp;
  } catch {
    return false;
  }
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
