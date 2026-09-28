import {
  WINDOWS, ADDONS, serviceById, serviceLabel, priceLabel,
  windowLabel, prettyDate, addDays,
} from "./services.js";

const $ = (s) => document.querySelector(s);
const KEY = "ttd_admin";
let view = "new";
let data = { requests: [], today: "" };
let byId = {};

// ───────── auth ─────────
const token = {
  get() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } },
  set(t) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} },
};

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token.get(), ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) { token.set(""); showLogin("Please sign in again."); throw new Error("signed out"); }
  if (!r.ok) { const e = new Error(body.error || "Something went wrong."); e.code = body.code; throw e; }
  return body;
}

function showLogin(msg) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  const e = $("#login-error");
  e.hidden = !msg;
  e.textContent = msg || "";
  $("#password").focus();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || $("#login-form button");
  btn.disabled = true;
  try {
    const r = await fetch("/api/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("#password").value }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || "Couldn't sign in.");
    token.set(body.token);
    $("#password").value = "";
    startApp();
  } catch (err) {
    showLogin(err.message);
  } finally {
    btn.disabled = false;
  }
});

$("#logout").addEventListener("click", () => { token.set(""); showLogin(); });

// ───────── list ─────────
function startApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  setView(view);
}

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.view))
);
$("#refresh").addEventListener("click", () => setView(view));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && token.get() && !$("#app").hidden && !$("#sheet").open) setView(view);
});

async function setView(v) {
  view = v;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  $("#app-error").hidden = true;
  const isCal = v === "daysoff";
  $("#daysoff").hidden = !isCal;
  $("#list").hidden = isCal;
  $("#empty").hidden = true;
  if (isCal) return loadDaysOff();
  try {
    data = await api("/api/admin/requests?view=" + v);
    byId = Object.fromEntries(data.requests.map((r) => [r.id, r]));
    $("#c-new").textContent = data.counts.new || "";
    $("#c-upcoming").textContent = data.counts.upcoming || "";
    renderList();
  } catch (e) {
    if (e.message !== "signed out") showAppError(e.message);
  }
}

function showAppError(msg) {
  const el = $("#app-error");
  el.textContent = msg;
  el.hidden = false;
}

function relDay(ymd) {
  if (ymd === data.today) return "Today";
  if (ymd === addDays(data.today, 1)) return "Tomorrow";
  if (ymd < data.today) return "";
  const diff = Math.round((Date.parse(ymd) - Date.parse(data.today)) / 86400000);
  return diff < 7 ? "This " + prettyDate(ymd, { weekday: "long" }) : "";
}

function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24);
  return d + (d === 1 ? " day ago" : " days ago");
}

function phonePretty(p) {
  const d = String(p).replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

function smsHref(phone, body) {
  const num = "+1" + String(phone).replace(/\D/g, "").slice(-10);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return `sms:${num}${ios ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

function mapsHref(address) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const q = encodeURIComponent(address);
  return ios ? `https://maps.apple.com/?daddr=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderList() {
  const list = $("#list");
  const reqs = data.requests;
  if (!reqs.length) {
    list.innerHTML = "";
    const msg = {
      new: ["All caught up", "New requests show up here. You'll get a notification when one comes in."],
      upcoming: ["Nothing on the calendar", "Jobs you confirm show up here."],
      history: ["No history yet", "Finished, declined, and cancelled jobs end up here."],
    }[view];
    $("#empty").innerHTML = `<b>${msg[0]}</b>${msg[1]}`;
    $("#empty").hidden = false;
    return;
  }
  list.innerHTML = reqs.map(card).join("");
  list.querySelectorAll("[data-act]").forEach((b) =>
    b.addEventListener("click", () => openSheet(b.dataset.act, byId[b.dataset.id]))
  );
}

function card(r) {
  const s = serviceById(r.service);
  const rel = relDay(r.date);
  const addons = r.addons ? r.addons.split(",").map((a) => ADDONS.find((x) => x.id === a)?.name || a).join(", ") : "";
  const first = esc(r.name.split(" ")[0]);
  const w = WINDOWS[r.time_window];
  const photos = r.photos.length
    ? `<div class="thumbs">${r.photos.map((id) => `<a href="/api/admin/photos/${id}?k=${encodeURIComponent(token.get())}" target="_blank" rel="noopener"><img src="/api/admin/photos/${id}?k=${encodeURIComponent(token.get())}" alt="Customer photo" loading="lazy"></a>`).join("")}</div>`
    : "";

  let actions = "";
  if (r.status === "new") {
    actions = `<div class="card-actions">
        <button class="btn btn-brass" data-act="confirm" data-id="${r.id}">Confirm</button>
        <button class="btn btn-ghost" data-act="other" data-id="${r.id}">Other time</button>
        <button class="btn btn-ghost" data-act="decline" data-id="${r.id}">Decline</button>
      </div>`;
  } else if (r.status === "confirmed" && view === "upcoming") {
    actions = `<div class="card-actions two">
        <button class="btn btn-primary" data-act="done" data-id="${r.id}">Mark done</button>
        <button class="btn btn-ghost" data-act="manage" data-id="${r.id}">Change / cancel</button>
      </div>`;
  } else {
    actions = `<div class="card-actions two">
        ${r.status === "confirmed" ? `<button class="btn btn-primary" data-act="done" data-id="${r.id}">Mark done</button>` : ""}
        <button class="btn btn-ghost" data-act="reopen" data-id="${r.id}">Move back to New</button>
      </div>`;
  }

  return `<article class="card ${rel === "Today" || rel === "Tomorrow" ? "soon" : ""}">
    <div class="card-top">
      <span class="card-service">${esc(serviceLabel(s) || r.service)}</span>
      ${view === "history" ? `<span class="pill ${r.status}">${r.status}</span>` : `<span class="card-price">${esc(priceLabel(s))}</span>`}
    </div>
    <p class="card-when">${rel ? `<small>${rel}</small>` : ""}${prettyDate(r.date, { weekday: "short", month: "short", day: "numeric" })} · ${esc(w ? w.label : r.time_window)}${w ? `, ${w.start}` : ""}</p>
    <dl class="facts">
      <div><dt>Customer</dt><dd>${esc(r.name)} · <a href="tel:+1${esc(r.phone)}">${phonePretty(r.phone)}</a></dd></div>
      <div><dt>Vehicle</dt><dd>${esc(r.vehicle)}</dd></div>
      <div><dt>Address</dt><dd><a href="${mapsHref(r.address)}" target="_blank" rel="noopener">${esc(r.address)}</a></dd></div>
      ${addons ? `<div><dt>Extras</dt><dd>${esc(addons)}</dd></div>` : ""}
    </dl>
    ${r.notes ? `<div class="card-notes">${esc(r.notes)}</div>` : ""}
    ${photos}
    ${actions}
    <div class="card-contact">
      <a class="btn btn-ghost" href="tel:+1${esc(r.phone)}">Call ${first}</a>
      <a class="btn btn-ghost" href="${smsHref(r.phone, `Hi ${r.name.split(" ")[0]}, it's Carlos with Top Tier Detailing. `)}">Text ${first}</a>
      ${r.status === "confirmed" ? `<a class="btn btn-ghost" href="${mapsHref(r.address)}" target="_blank" rel="noopener">Directions</a>` : ""}
    </div>
    <p class="card-meta">Requested ${ago(r.created_at)} · ${esc(r.id)}${r.carlos_note ? ` · Note: ${esc(r.carlos_note)}` : ""}</p>
  </article>`;
}

// ───────── message templates ─────────
function msgConfirm(r, date, win) {
  const s = serviceById(r.service);
  const w = WINDOWS[win];
  const first = r.name.split(" ")[0];
  const day = prettyDate(date, { weekday: "long", month: "short", day: "numeric" });
  let m = `Hi ${first}, it's Carlos with Top Tier Detailing. You're confirmed for ${day}. I'll be there at ${w.start} at ${r.address}.`;
  if (s && (s.quote || s.from)) m += ` I'll look the car over and give you an exact price before I start.`;
  if (s && (s.group === "ceramic" || s.group === "signature")) m += ` To hold the day I take a $__ deposit. I'll send you the details.`;
  m += ` Reply here if anything changes. See you then!`;
  return m;
}
function msgOther(r) {
  const first = r.name.split(" ")[0];
  const day = prettyDate(r.date, { weekday: "long", month: "short", day: "numeric" });
  return `Hi ${first}, it's Carlos with Top Tier Detailing. Thanks for the request! ${day} doesn't work for me. Could you do ___ instead?`;
}
function msgDecline(r) {
  const first = r.name.split(" ")[0];
  return `Hi ${first}, it's Carlos with Top Tier Detailing. Thanks for reaching out. Unfortunately I can't take this one. Sorry about that, and I hope to help you another time.`;
}
function msgCancel(r) {
  const first = r.name.split(" ")[0];
  const day = prettyDate(r.date, { weekday: "long", month: "short", day: "numeric" });
  return `Hi ${first}, it's Carlos with Top Tier Detailing. I need to cancel ${day}. Sorry about that. Can we find another day that works?`;
}

// ───────── sheet ─────────
const sheet = $("#sheet");
function closeSheet() { sheet.close(); }
sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
sheet.addEventListener("close", () => { if (sheet.dataset.dirty) { delete sheet.dataset.dirty; setView(view); } });

function sheetError(msg) {
  const el = $("#sheet-error");
  el.hidden = !msg;
  el.textContent = msg || "";
}

function windowOptions(selected) {
  return Object.entries(WINDOWS).map(([id]) =>
    `<option value="${id}" ${id === selected ? "selected" : ""}>${WINDOWS[id].label}, ${WINDOWS[id].start}</option>`
  ).join("");
}

function messageBox(text) {
  return `<div class="field"><label for="sheet-msg">Your text</label>
    <textarea class="textarea" id="sheet-msg">${esc(text)}</textarea>
    <span class="hint">Opens in your Messages app. You can still edit it there.</span></div>`;
}

function openSheet(act, r) {
  if (!r) return;
  sheetError("");
  const first = r.name.split(" ")[0];
  const s = serviceById(r.service);
  const title = $("#sheet-title"), sub = $("#sheet-sub"), body = $("#sheet-body"), actions = $("#sheet-actions");
  sub.textContent = `${first} · ${serviceLabel(s)} · ${r.vehicle}`;

  if (act === "confirm" || act === "manage") {
    title.textContent = act === "confirm" ? `Confirm ${first}` : `Change ${first}'s job`;
    body.innerHTML = `
      <div class="row">
        <div class="field"><label for="sheet-date">Day</label><input class="input" type="date" id="sheet-date" value="${r.date}"></div>
        <div class="field"><label for="sheet-win">Time</label><select class="select" id="sheet-win">${windowOptions(r.time_window)}</select></div>
      </div>
      <div id="clash"></div>
      ${messageBox(msgConfirm(r, r.date, r.time_window))}`;
    const refreshMsg = () => {
      const d = $("#sheet-date").value, w = $("#sheet-win").value;
      if (d && WINDOWS[w]) $("#sheet-msg").value = msgConfirm(r, d, w);
    };
    $("#sheet-date").addEventListener("change", refreshMsg);
    $("#sheet-win").addEventListener("change", refreshMsg);
    actions.innerHTML = `
      <button class="btn btn-brass btn-block" type="button" id="do-confirm">${act === "confirm" ? "Confirm" : "Save"} &amp; text ${esc(first)}</button>
      <button class="btn btn-ghost btn-block" type="button" id="do-confirm-quiet">${act === "confirm" ? "Confirm" : "Save"} without texting</button>
      ${act === "manage" ? `<button class="btn btn-danger btn-block" type="button" id="do-cancel">Cancel this job</button>` : ""}`;
    const run = async (text, force) => {
      try {
        await api(`/api/admin/requests/${r.id}`, {
          method: "POST",
          body: JSON.stringify({ action: "confirm", date: $("#sheet-date").value, window: $("#sheet-win").value, force }),
        });
        sheet.dataset.dirty = "1";
        if (text) showSent(`${first} is on the calendar`, "Now send the text:", r.phone, $("#sheet-msg").value);
        else closeSheet();
      } catch (e) {
        if (e.code === "clash") {
          $("#clash").innerHTML = `<div class="warn-box">${esc(e.message)} Confirm anyway?</div>`;
          $("#do-confirm").textContent = "Confirm anyway & text";
          $("#do-confirm").onclick = () => run(true, true);
          $("#do-confirm-quiet").onclick = () => run(false, true);
        } else sheetError(e.message);
      }
    };
    $("#do-confirm").onclick = () => run(true, false);
    $("#do-confirm-quiet").onclick = () => run(false, false);
    if (act === "manage") $("#do-cancel").onclick = () => openSheet("cancel", r);
  }

  else if (act === "other") {
    title.textContent = `Suggest another time`;
    body.innerHTML = `${messageBox(msgOther(r))}<p class="hint" style="color:var(--dim);font-size:.88rem;margin-top:-6px">Fill in the day you can do. The request stays in New. Once ${esc(first)} agrees, tap Confirm and change the day there.</p>`;
    actions.innerHTML = `<a class="btn btn-brass btn-block" id="do-sms">Open text to ${esc(first)}</a>`;
    const link = $("#do-sms");
    const sync = () => (link.href = smsHref(r.phone, $("#sheet-msg").value));
    $("#sheet-msg").addEventListener("input", sync);
    sync();
    link.addEventListener("click", () => setTimeout(closeSheet, 300));
  }

  else if (act === "decline" || act === "cancel") {
    const isCancel = act === "cancel";
    title.textContent = isCancel ? `Cancel ${first}'s job?` : `Decline ${first}?`;
    body.innerHTML = messageBox(isCancel ? msgCancel(r) : msgDecline(r));
    actions.innerHTML = `
      <button class="btn btn-danger btn-block" type="button" id="do-dec">${isCancel ? "Cancel job" : "Decline"} &amp; text ${esc(first)}</button>
      <button class="btn btn-ghost btn-block" type="button" id="do-dec-quiet">${isCancel ? "Cancel" : "Decline"} without texting</button>`;
    const run = async (text) => {
      try {
        await api(`/api/admin/requests/${r.id}`, { method: "POST", body: JSON.stringify({ action: isCancel ? "cancel" : "decline" }) });
        sheet.dataset.dirty = "1";
        if (text) showSent(isCancel ? "Job cancelled" : "Request declined", "Now send the text:", r.phone, $("#sheet-msg").value);
        else closeSheet();
      } catch (e) { sheetError(e.message); }
    };
    $("#do-dec").onclick = () => run(true);
    $("#do-dec-quiet").onclick = () => run(false);
  }

  else if (act === "done" || act === "reopen") {
    title.textContent = act === "done" ? `Mark ${first}'s job done?` : `Move back to New?`;
    body.innerHTML = act === "done" ? `<div class="field"><label for="sheet-note">Note for yourself <span class="opt-tag">(optional)</span></label><input class="input" id="sheet-note" placeholder="Paid cash, wants a maintenance wash in 3 months…" value="${esc(r.carlos_note)}"></div>` : "";
    actions.innerHTML = `<button class="btn btn-primary btn-block" type="button" id="do-it">${act === "done" ? "Mark done" : "Move to New"}</button>
      <button class="btn btn-ghost btn-block" type="button" id="do-close">Never mind</button>`;
    $("#do-it").onclick = async () => {
      try {
        const note = $("#sheet-note") ? $("#sheet-note").value : undefined;
        await api(`/api/admin/requests/${r.id}`, { method: "POST", body: JSON.stringify({ action: act, note }) });
        sheet.dataset.dirty = "1";
        closeSheet();
      } catch (e) { sheetError(e.message); }
    };
    $("#do-close").onclick = closeSheet;
  }

  if (!sheet.open) {
    sheet.showModal();
    title.setAttribute("tabindex", "-1");
    title.focus(); // keep the phone keyboard from popping up
  }
}

function showSent(heading, lead, phone, text) {
  $("#sheet-title").textContent = "";
  $("#sheet-sub").textContent = "";
  $("#sheet-body").innerHTML = `<div class="ok"><div class="check">✓</div><h2>${esc(heading)}</h2><p class="sheet-sub">${esc(lead)}</p></div>`;
  $("#sheet-actions").innerHTML = `<a class="btn btn-brass btn-block" href="${smsHref(phone, text)}" id="sent-sms">Open Messages</a>
    <button class="btn btn-ghost btn-block" type="button" id="sent-close">Done</button>`;
  $("#sent-sms").addEventListener("click", () => setTimeout(closeSheet, 400));
  $("#sent-close").onclick = closeSheet;
}

// ───────── days off ─────────
async function loadDaysOff() {
  try {
    const d = await api("/api/admin/days-off");
    renderCal(d);
  } catch (e) {
    if (e.message !== "signed out") showAppError(e.message);
  }
}

function renderCal(d) {
  const off = new Set(d.blocked);
  const jobs = {};
  for (const j of d.jobs) (jobs[j.date] ||= []).push(j);
  const cal = $("#cal");
  cal.innerHTML = "";
  let cursor = d.today.slice(0, 8) + "01";
  for (let mi = 0; mi < 3; mi++) {
    const [y, m] = cursor.split("-").map(Number);
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const wrap = document.createElement("div");
    wrap.className = "cal-month";
    wrap.innerHTML = `<h3>${prettyDate(cursor, { month: "long", year: "numeric" })}</h3>`;
    const grid = document.createElement("div");
    grid.className = "cal-grid";
    // In the current month, skip the weeks that are already over.
    let startDay = 1;
    if (mi === 0) {
      const t = Number(d.today.slice(8));
      const todayDow = new Date(Date.UTC(y, m - 1, t)).getUTCDay();
      startDay = Math.max(1, t - todayDow);
    }
    const padDow = new Date(Date.UTC(y, m - 1, startDay)).getUTCDay();
    grid.innerHTML = ["S", "M", "T", "W", "T", "F", "S"].map((x) => `<span class="dow">${x}</span>`).join("")
      + "<span class=\"cal-pad\"></span>".repeat(padDow);
    for (let day = startDay; day <= daysIn; day++) {
      const ymd = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cal-day" + (off.has(ymd) ? " off" : "") + (ymd === d.today ? " today" : "");
      b.disabled = ymd < d.today;
      const nJobs = (jobs[ymd] || []).length;
      b.innerHTML = `${day}<span class="dots">${"<i></i>".repeat(Math.min(nJobs, 3))}</span>`;
      b.setAttribute("aria-label", `${prettyDate(ymd, { weekday: "long", month: "long", day: "numeric" })}${off.has(ymd) ? ", day off" : ""}${nJobs ? `, ${nJobs} job${nJobs > 1 ? "s" : ""}` : ""}`);
      b.setAttribute("aria-pressed", String(off.has(ymd)));
      b.addEventListener("click", async () => {
        const turnOff = !off.has(ymd);
        if (turnOff && nJobs && !confirm(`You have ${nJobs} confirmed job${nJobs > 1 ? "s" : ""} that day. Take it off anyway? The job stays on your calendar.`)) return;
        turnOff ? off.add(ymd) : off.delete(ymd);
        b.classList.toggle("off", turnOff);
        b.setAttribute("aria-pressed", String(turnOff));
        try {
          await api("/api/admin/days-off", { method: "POST", body: JSON.stringify({ date: ymd, off: turnOff }) });
        } catch (e) {
          turnOff ? off.delete(ymd) : off.add(ymd);
          b.classList.toggle("off", !turnOff);
          if (e.message !== "signed out") showAppError(e.message);
        }
      });
      grid.appendChild(b);
    }
    wrap.appendChild(grid);
    cal.appendChild(wrap);
    cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
}

// ───────── go ─────────
if (token.get()) startApp();
else showLogin();
