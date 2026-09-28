// Top Tier Detailing — API worker. Static files are served from /public;
// anything under /api/ lands here.
import {
  SERVICES, ADDONS, WINDOWS, BOOK_AHEAD_DAYS,
  serviceById, serviceLabel, windowsFor, windowOpen, windowLabel, addonAllowed, addonNames,
  addDays, todayChicago, prettyDate,
} from "../public/js/services.js";

const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 900_000; // after client-side compression
const SESSION_DAYS = 90;

// Old links from the first version of the site.
const REDIRECTS = {
  "/status": "/book", "/status.html": "/book",
  "/index.html": "/", "/book.html": "/book", "/admin.html": "/admin",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const moved = REDIRECTS[url.pathname];
    if (moved) return Response.redirect(url.origin + moved, 301);
    if (!url.pathname.startsWith("/api/")) return serveAsset(request, env, url);
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

// Static files. Versioned CSS/JS/video (?v=hash) can be cached forever; pages
// themselves are always re-checked so a phone never mixes new HTML with old styles.
async function serveAsset(request, env, url) {
  const res = await env.ASSETS.fetch(request);
  if (!res.ok) return res;
  const out = new Response(res.body, res);
  const type = out.headers.get("Content-Type") || "";
  if (url.searchParams.has("v")) out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  else if (type.includes("text/html")) out.headers.set("Cache-Control", "no-cache");
  else if (/\.(css|js)$/.test(url.pathname)) out.headers.set("Cache-Control", "no-cache");
  return out;
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
  const addons = [...new Set(Array.isArray(body.addons) ? body.addons : [])]
    .filter((a) => ADDONS.some((x) => x.id === a) && addonAllowed(service, a));

  if (!service) return json({ error: "Pick a service." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Pick a day." }, 400);
  const today = todayChicago();
  if (date <= today || date > addDays(today, BOOK_AHEAD_DAYS)) return json({ error: "Pick a day in the next few weeks." }, 400);
  if (!windowsFor(service, date, addons).includes(win)) return json({ error: "That time doesn't work for this service. Pick another." }, 400);
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

  ctx.waitUntil(notifyCarlos(env, { id, service, addons, date, win, vehicle, name, phone: phoneDigits, address, notes, photos: photos.length, origin: new URL(req.url).origin }));

  return json({ ok: true, id, first_name: name.split(" ")[0] });
}

async function notifyCarlos(env, r) {
  if (!env.MAILER) { console.log("mailer not bound"); return; }
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const phone = String(r.phone);
  const pretty = `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  const when = `${prettyDate(r.date, { weekday: "long", month: "short", day: "numeric" })} · ${windowLabel(r.win)}`;
  const service = serviceLabel(r.service) + (r.addons.length ? ` + ${addonNames(r.addons).join(", ")}` : "");
  const link = `${r.origin}/admin`;
  const rows = [
    ["When", when],
    ["Service", service],
    ["Vehicle", r.vehicle],
    ["Customer", r.name],
    ["Phone", pretty],
    ["Address", r.address],
    ...(r.notes ? [["Notes", r.notes]] : []),
    ...(r.photos ? [["Photos", `${r.photos} attached (see them in Requests)`]] : []),
  ];
  const text = `New booking request\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nConfirm, suggest another time, or decline:\n${link}`;
  const html = `<!doctype html><html><body style="margin:0;background:#0b0b0b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#f3f1ed">
<div style="max-width:520px;margin:0 auto;padding:24px 18px">
  <p style="margin:0 0 4px;color:#c9a86e;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">New booking request</p>
  <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:26px;font-weight:600;color:#fff">${esc(when)}</h1>
  <table style="width:100%;border-collapse:collapse;background:#151515;border:1px solid #2a2a2a;border-radius:10px">
    ${rows.map(([k, v]) => `<tr><td style="padding:10px 14px;color:#8f8a83;font-size:14px;vertical-align:top;width:90px;border-bottom:1px solid #222">${esc(k)}</td><td style="padding:10px 14px;font-size:15px;border-bottom:1px solid #222">${k === "Phone" ? `<a href="tel:+1${phone}" style="color:#e0c592">${esc(v)}</a>` : esc(v)}</td></tr>`).join("")}
  </table>
  <p style="margin:22px 0 10px"><a href="${link}" style="display:inline-block;background:#c9a86e;color:#120e07;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px">Open requests</a></p>
  <p style="margin:0;color:#75716b;font-size:13px">Confirm, suggest another time, or decline from your Requests screen. Request ${esc(r.id)}.</p>
</div></body></html>`;
  try {
    const res = await env.MAILER.fetch("https://mailer/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: `New request: ${service} · ${prettyDate(r.date)}`, text, html }),
    });
    if (!res.ok) console.error("mailer failed", res.status, await res.text());
  } catch (e) {
    console.error("mailer error", e);
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
