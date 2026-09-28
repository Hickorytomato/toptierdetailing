import {
  SERVICES, ADDONS, WINDOWS, BOOK_AHEAD_DAYS,
  serviceById, serviceLabel, priceLabel, windowsFor, windowOpen,
  addonAllowed, jobLength, addonNames,
  addDays, todayChicago, prettyDate,
} from "./services.js";

const $ = (s) => document.querySelector(s);
const STEPS = ["service", "when", "details", "done"];

const state = {
  step: "service",
  service: null,      // service id
  group: null,        // selected group (for full detail before size is picked)
  addons: new Set(),
  date: null,
  window: null,
  photos: [],         // data URLs
  weekOffset: 0,
  avail: null,
};

// ───────── Step 1: service ─────────
const GROUPS = [
  { group: "full", title: "Full detail", sub: "Inside and out · 2–4 hours", price: "$150–$200" },
  { group: "signature", title: "Correction + ceramic", sub: "Swirl removal plus ceramic coating · all day", price: "from $499" },
  { group: "correction", title: "Paint correction", sub: "Swirls, haze, light scratches", price: "Quote" },
  { group: "ceramic", title: "Ceramic coating", sub: "Long-lasting gloss and protection", price: "Quote" },
  { group: "wheels", title: "Wheel polish", sub: "Faces and barrels, polished", price: "Quote" },
];

function renderServices() {
  const list = $("#service-list");
  list.innerHTML = "";
  for (const g of GROUPS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(state.group === g.group));
    btn.innerHTML = `<span class="opt-radio"></span>
      <span class="opt-main"><span class="opt-title">${g.title}</span><span class="opt-sub">${g.sub}</span></span>
      <span class="opt-price">${g.price}</span>`;
    btn.addEventListener("click", () => pickGroup(g.group));
    list.appendChild(btn);

    if (g.group === "full") {
      const sizes = document.createElement("div");
      sizes.className = "sizes";
      sizes.setAttribute("role", "radiogroup");
      sizes.setAttribute("aria-label", "Vehicle size");
      sizes.hidden = state.group !== "full";
      for (const s of SERVICES.filter((x) => x.group === "full")) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "size";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(state.service === s.id));
        b.innerHTML = `<span>${s.size}</span><b>$${s.price}</b>`;
        b.addEventListener("click", () => { state.service = s.id; afterServiceChange(); });
        sizes.appendChild(b);
      }
      list.appendChild(sizes);
    }
  }
}

function pickGroup(group) {
  state.group = group;
  if (group === "full") {
    const cur = serviceById(state.service);
    if (!cur || cur.group !== "full") state.service = null;
  } else {
    state.service = SERVICES.find((s) => s.group === group).id;
  }
  afterServiceChange();
}

const addonList = () => [...state.addons];

function afterServiceChange() {
  const s = serviceById(state.service);
  // Drop add-ons that the new main service already covers.
  for (const id of [...state.addons]) if (!addonAllowed(s, id)) state.addons.delete(id);
  // A time picked for a different job length may no longer be valid.
  if (s && state.date && !windowsFor(s, state.date, addonList()).includes(state.window)) state.window = null;
  if (s && state.date && !dayHasOpening(state.date)) { state.date = null; state.window = null; }
  renderServices();
  renderAddons();
  updateBar();
}

function renderAddons() {
  const s = serviceById(state.service);
  const fill = (el, kind) => {
    el.innerHTML = "";
    for (const a of ADDONS.filter((x) => x.kind === kind && addonAllowed(s, x.id))) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = a.name;
      b.setAttribute("aria-pressed", String(state.addons.has(a.id)));
      b.addEventListener("click", () => toggleAddon(a.id));
      el.appendChild(b);
    }
  };
  fill($("#addon-services"), "service");
  fill($("#addon-extras"), "extra");
  const note = $("#addon-note");
  const long = s && s.length !== "long" && jobLength(s, addonList()) === "long";
  note.hidden = !long;
}

function toggleAddon(id) {
  const s = serviceById(state.service);
  state.addons.has(id) ? state.addons.delete(id) : state.addons.add(id);
  // Correction + ceramic together is the Signature package.
  if (state.addons.has("correction") && state.addons.has("ceramic") && (!s || s.group !== "full")) {
    state.addons.delete("correction"); state.addons.delete("ceramic");
    pickGroup("signature");
    flash("Correction + ceramic together is the Signature package, so I switched you to that.");
    return;
  }
  if ((s?.group === "correction" && id === "ceramic" && state.addons.has("ceramic")) ||
      (s?.group === "ceramic" && id === "correction" && state.addons.has("correction"))) {
    state.addons.delete(id);
    pickGroup("signature");
    flash("Correction + ceramic together is the Signature package, so I switched you to that.");
    return;
  }
  afterServiceChange();
}

function flash(msg) {
  const el = $("#addon-flash");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (el.hidden = true), 6000);
}

// ───────── Step 2: when ─────────
async function loadAvailability() {
  try {
    const r = await fetch("/api/availability", { cache: "no-store" });
    if (!r.ok) throw new Error();
    state.avail = await r.json();
  } catch {
    const today = todayChicago();
    state.avail = { today, first: addDays(today, 1), last: addDays(today, BOOK_AHEAD_DAYS), taken: {}, blocked: [] };
  }
}

function dayHasOpening(ymd) {
  const s = serviceById(state.service);
  const a = state.avail;
  if (!s || !a) return false;
  if (ymd < a.first || ymd > a.last || a.blocked.includes(ymd)) return false;
  return windowsFor(s, ymd, addonList()).some((w) => windowOpen(w, a.taken[ymd]));
}

function weekStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(ymd, -dow);
}

function renderDays() {
  const a = state.avail;
  if (!a) return;
  const s = serviceById(state.service);
  const firstWeek = weekStart(a.first);
  const lastWeek = weekStart(a.last);
  const start = addDays(firstWeek, state.weekOffset * 14);
  const days = $("#days");
  days.innerHTML = "";
  for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = d;
    days.appendChild(el);
  }
  for (let i = 0; i < 14; i++) {
    const ymd = addDays(start, i);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day";
    const open = dayHasOpening(ymd);
    b.disabled = !open;
    b.setAttribute("aria-pressed", String(state.date === ymd));
    b.setAttribute("aria-label", prettyDate(ymd, { weekday: "long", month: "long", day: "numeric" }) + (open ? "" : ", not available"));
    b.innerHTML = `<span class="m">${prettyDate(ymd, { month: "short" })}</span><span class="n">${Number(ymd.slice(8))}</span>`;
    b.addEventListener("click", () => {
      state.date = ymd;
      const wins = windowsFor(s, ymd, addonList()).filter((w) => windowOpen(w, a.taken[ymd]));
      state.window = wins.length === 1 ? wins[0] : (wins.includes(state.window) ? state.window : null);
      renderDays();
      renderWindows();
      updateBar();
      $("#windows-wrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    days.appendChild(b);
  }
  const end = addDays(start, 13);
  $("#range-label").textContent = `${prettyDate(start, { month: "short", day: "numeric" })} – ${prettyDate(end, { month: "short", day: "numeric" })}`;
  $("#prev-week").disabled = state.weekOffset === 0;
  $("#next-week").disabled = addDays(start, 14) > lastWeek;

  const long = s && jobLength(s, addonList()) === "long";
  $("#long-note").hidden = !long;
  $("#when-lede").textContent = long
    ? "Pick a Saturday or Sunday. Grayed-out days are already booked."
    : "Weeknights start at 5 pm. Weekends have morning, afternoon, and evening times.";
  $("#days-legend").textContent = "Grayed-out days are booked or unavailable.";
}

function renderWindows() {
  const wrap = $("#windows-wrap");
  const list = $("#windows");
  const s = serviceById(state.service);
  if (!state.date || !s) { wrap.hidden = true; return; }
  wrap.hidden = false;
  $("#windows-label").textContent = prettyDate(state.date, { weekday: "long", month: "long", day: "numeric" });
  list.innerHTML = "";
  const taken = state.avail.taken[state.date];
  for (const id of windowsFor(s, state.date, addonList())) {
    const w = WINDOWS[id];
    const open = windowOpen(id, taken);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(state.window === id));
    b.disabled = !open;
    if (!open) b.style.opacity = ".45";
    const sub = id === "allday" ? "I arrive at 8 am and work through the day" : `I arrive at ${w.start}`;
    b.innerHTML = `<span class="opt-radio"></span><span class="opt-main"><span class="opt-title">${w.label}</span><span class="opt-sub">${open ? sub : "Booked"}</span></span>`;
    b.addEventListener("click", () => { state.window = id; renderWindows(); updateBar(); });
    list.appendChild(b);
  }
}

// ───────── Step 3: details ─────────
const fields = ["vehicle", "name", "phone", "address", "notes"];

function formatPhone(v) {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function detailsProblems() {
  const v = (id) => $("#" + id).value.trim();
  const bad = [];
  if (!v("vehicle")) bad.push(["vehicle", "Add the year, make, and model."]);
  if (!v("name")) bad.push(["name", "Add your name."]);
  if (v("phone").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length !== 10) bad.push(["phone", "Add a 10-digit mobile number."]);
  if (v("address").length < 6) bad.push(["address", "Add the address where the car will be."]);
  return bad;
}

function renderSummary(target, withEdit) {
  const s = serviceById(state.service);
  const rows = [
    ["Service", `${serviceLabel(s)} · ${priceLabel(s)}`, "service"],
    ["When", `${prettyDate(state.date, { weekday: "short", month: "short", day: "numeric" })} · ${WINDOWS[state.window].label}, ${WINDOWS[state.window].start}`, "when"],
  ];
  if (state.addons.size) rows.push(["Also", addonNames(ADDONS.filter((a) => state.addons.has(a.id)).map((a) => a.id)).join(", "), "service"]);
  target.innerHTML = rows.map(([k, v, step]) =>
    `<div><dt>${k}</dt><dd>${escapeHtml(v)}${withEdit ? ` <button type="button" data-go="${step}">Change</button>` : ""}</dd></div>`
  ).join("");
  target.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
}

async function addPhotos(files) {
  const hint = $("#photo-hint");
  for (const f of files) {
    if (state.photos.length >= 4) break;
    try {
      state.photos.push(await shrink(f));
    } catch {
      hint.textContent = "One of those photos couldn't be read. Try a JPG or PNG.";
    }
  }
  renderPhotos();
}

function renderPhotos() {
  const wrap = $("#photos");
  wrap.querySelectorAll(".photo-thumb").forEach((n) => n.remove());
  const add = wrap.querySelector(".photo-add");
  state.photos.forEach((src, i) => {
    const t = document.createElement("div");
    t.className = "photo-thumb";
    t.innerHTML = `<img alt="Photo ${i + 1}" src="${src}"><button type="button" aria-label="Remove photo ${i + 1}">✕</button>`;
    t.querySelector("button").addEventListener("click", () => { state.photos.splice(i, 1); renderPhotos(); });
    wrap.insertBefore(t, add);
  });
  add.hidden = state.photos.length >= 4;
}

function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1600;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = 0.78, out = c.toDataURL("image/jpeg", q);
      while (out.length > 1_100_000 && q > 0.4) { q -= 0.12; out = c.toDataURL("image/jpeg", q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

async function submit() {
  const errEl = $("#form-error");
  errEl.hidden = true;
  document.querySelectorAll(".input.invalid").forEach((n) => n.classList.remove("invalid"));
  const bad = detailsProblems();
  if (bad.length) {
    bad.forEach(([id]) => $("#" + id).classList.add("invalid"));
    errEl.textContent = bad.map((b) => b[1]).join(" ");
    errEl.hidden = false;
    $("#" + bad[0][0]).focus();
    return;
  }
  const btn = $("#next-btn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Sending…`;
  const payload = {
    service: state.service,
    addons: [...state.addons],
    date: state.date,
    window: state.window,
    photos: state.photos,
    website: document.querySelector('[name="website"]').value,
  };
  for (const f of fields) payload[f] = $("#" + f).value.trim();

  try {
    const r = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409 && data.code === "taken") {
      await loadAvailability();
      state.date = null; state.window = null;
      go("when");
      showWhenError(data.error);
      return;
    }
    if (!r.ok) throw new Error(data.error || "Couldn't send your request. Check your connection and try again.");
    try {
      localStorage.setItem("ttd_me", JSON.stringify({ name: payload.name, phone: payload.phone, address: payload.address }));
    } catch {}
    showDone(data, payload);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    updateBar();
  }
}

function showWhenError(msg) {
  let el = $("#when-error");
  if (!el) {
    el = document.createElement("div");
    el.id = "when-error";
    el.className = "form-error";
    el.setAttribute("role", "alert");
    $("#step-when .lede").after(el);
  }
  el.textContent = msg;
  el.hidden = false;
}

function showDone(data, payload) {
  const first = data.first_name || "";
  $("#done-title").textContent = first ? `Got it, ${first}.` : "Got it.";
  $("#done-lede").textContent = `I'll text you at ${formatPhone(payload.phone)} to confirm. If anything needs to change, just reply to that text.`;
  renderSummary($("#done-summary"), false);
  go("done", { replace: true });
}

// ───────── navigation ─────────
function go(step, { replace = false, fromPop = false } = {}) {
  state.step = step;
  for (const s of STEPS) $("#step-" + s).hidden = s !== step;
  const idx = STEPS.indexOf(step);
  document.querySelectorAll(".progress span").forEach((n, i) => n.classList.toggle("on", i <= idx));
  $(".progress").style.visibility = step === "done" ? "hidden" : "visible";
  if (step === "when") { renderDays(); renderWindows(); const e = $("#when-error"); if (e) e.hidden = true; }
  if (step === "details") renderSummary($("#summary"), true);
  $("#step-bar").hidden = step === "done";
  updateBar();
  window.scrollTo(0, 0);
  if (!fromPop) {
    const st = { step };
    if (replace) history.replaceState(st, "", step === "service" ? location.pathname + location.search : "#" + step);
    else history.pushState(st, "", "#" + step);
  }
  const h = $(`#step-${step} h1`);
  if (h && !fromPop) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
}

function updateBar() {
  const back = $("#back-btn");
  const next = $("#next-btn");
  const picked = $("#picked");
  const s = serviceById(state.service);
  back.hidden = state.step === "service";
  picked.hidden = true;
  if (state.step === "service") {
    next.textContent = "Continue";
    next.disabled = !s;
    if (s) {
      picked.hidden = false;
      const n = state.addons.size;
      picked.innerHTML = `<b>${escapeHtml(serviceLabel(s))}</b>${priceLabel(s)}${n ? ` + ${n} more` : ""}`;
    }
    else if (state.group === "full") { picked.hidden = false; picked.innerHTML = `<b>Full detail</b>Pick your vehicle size`; }
  } else if (state.step === "when") {
    next.textContent = "Continue";
    next.disabled = !(state.date && state.window);
  } else if (state.step === "details") {
    next.textContent = "Send request";
    next.disabled = false;
  }
}

$("#next-btn").addEventListener("click", () => {
  if (state.step === "service") go("when");
  else if (state.step === "when") go("details");
  else if (state.step === "details") submit();
});
$("#back-btn").addEventListener("click", () => history.back());
$("#prev-week").addEventListener("click", () => { state.weekOffset = Math.max(0, state.weekOffset - 1); renderDays(); });
$("#next-week").addEventListener("click", () => { state.weekOffset++; renderDays(); });
window.addEventListener("popstate", (e) => {
  let step = (e.state && e.state.step) || "service";
  if (state.step === "done") { location.href = "/"; return; }
  if (step !== "service" && !serviceById(state.service)) step = "service";
  if (step === "details" && !(state.date && state.window)) step = "when";
  go(step, { fromPop: true });
});

$("#phone").addEventListener("input", (e) => {
  const el = e.target;
  const atEnd = el.selectionStart === el.value.length;
  el.value = formatPhone(el.value);
  if (atEnd) el.setSelectionRange(el.value.length, el.value.length);
});
document.querySelectorAll(".input").forEach((n) => n.addEventListener("input", () => {
  n.classList.remove("invalid");
  if (!document.querySelector(".input.invalid")) $("#form-error").hidden = true;
}));
$("#photo-input").addEventListener("change", (e) => { addPhotos([...e.target.files]); e.target.value = ""; });
$("#details-form").addEventListener("submit", (e) => { e.preventDefault(); submit(); });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ───────── start ─────────
function applyDeepLink() {
  const q = (new URLSearchParams(location.search).get("service") || "").toLowerCase();
  const map = {
    full: "full", detailing: "full",
    signature: "signature", package: "signature",
    correction: "correction", "paint-correction": "correction",
    ceramic: "ceramic", wheels: "wheels",
  };
  if (map[q]) pickGroup(map[q]);
}

function prefill() {
  try {
    const me = JSON.parse(localStorage.getItem("ttd_me") || "null");
    if (me) {
      if (me.name) $("#name").value = me.name;
      if (me.phone) $("#phone").value = formatPhone(me.phone);
      if (me.address) $("#address").value = me.address;
    }
  } catch {}
}

renderServices();
renderAddons();
applyDeepLink();
prefill();
go("service", { replace: true });
loadAvailability().then(() => {
  if (state.step === "when") { renderDays(); renderWindows(); }
});
