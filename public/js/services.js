// ─────────────────────────────────────────────────────────────
// Services, prices and time windows. The booking page AND the
// server both read this file, so change things here and nowhere else.
// ─────────────────────────────────────────────────────────────

// length: "short" jobs fit an evening; "long" jobs take the whole day.
export const SERVICES = [
  { id: "full-car",     group: "full", name: "Full detail", size: "Car / sedan",               price: 150, length: "short" },
  { id: "full-midsize", group: "full", name: "Full detail", size: "Midsize SUV / crossover",   price: 175, length: "short" },
  { id: "full-large",   group: "full", name: "Full detail", size: "Truck / large SUV / van",   price: 200, length: "short" },
  { id: "signature",    group: "signature", name: "Correction + ceramic", price: 499, from: true, length: "long" },
  { id: "correction",   group: "correction", name: "Paint correction", quote: true, length: "long" },
  { id: "ceramic",      group: "ceramic",    name: "Ceramic coating",  quote: true, length: "long" },
  { id: "wheels",       group: "wheels",     name: "Wheel polish",     quote: true, length: "short" },
];

// Things people can stack on top of the main service.
// kind "service" = quoted separately; kind "extra" = small add-on priced on site.
export const ADDONS = [
  { id: "wheels",     name: "Wheel polish",          kind: "service", length: "short" },
  { id: "correction", name: "Paint correction",      kind: "service", length: "long" },
  { id: "ceramic",    name: "Ceramic coating",       kind: "service", length: "long" },
  { id: "pet-hair",   name: "Pet hair removal",      kind: "extra",   length: "short" },
  { id: "odor",       name: "Odor removal",          kind: "extra",   length: "short" },
  { id: "engine-bay", name: "Engine bay",            kind: "extra",   length: "short" },
  { id: "headlights", name: "Headlight restoration", kind: "extra",   length: "short" },
];

// Add-ons that don't make sense with a given main service (already included or the same thing).
export function addonAllowed(service, addonId) {
  if (!service) return true;
  if (service.group === addonId) return false;
  if (service.group === "signature" && (addonId === "correction" || addonId === "ceramic")) return false;
  return true;
}

// A job is all-day if the main service or anything stacked on it is.
export function jobLength(service, addonIds = []) {
  if (!service) return "short";
  if (service.length === "long") return "long";
  return addonIds.some((id) => ADDONS.find((a) => a.id === id)?.length === "long") ? "long" : "short";
}

export function addonNames(ids) {
  return ids.map((id) => ADDONS.find((a) => a.id === id)?.name || id);
}

// Time windows. weekday = Mon–Fri, weekend = Sat–Sun.
export const WINDOWS = {
  morning:   { label: "Morning",   start: "8 am",  days: ["weekend"], length: "short" },
  afternoon: { label: "Afternoon", start: "12 pm", days: ["weekend"], length: "short" },
  evening:   { label: "Evening",   start: "5 pm",  days: ["weekday", "weekend"], length: "short" },
  allday:    { label: "All day",   start: "8 am",  days: ["weekday", "weekend"], length: "long" },
};

// How far ahead people can book, in days.
export const BOOK_AHEAD_DAYS = 42;

export function serviceById(id) {
  return SERVICES.find((s) => s.id === id) || null;
}

export function serviceLabel(s) {
  if (!s) return "";
  return s.size ? `${s.name} (${s.size})` : s.name;
}

export function priceLabel(s) {
  if (!s) return "";
  if (s.quote) return "Quote";
  return (s.from ? "from $" : "$") + s.price;
}

// Weekday/weekend for a YYYY-MM-DD string, independent of time zone.
export function dayType(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6 ? "weekend" : "weekday";
}

// Which windows a service can be booked into on a given date.
export function windowsFor(service, ymd, addonIds = []) {
  if (!service) return [];
  const type = dayType(ymd);
  const len = jobLength(service, addonIds);
  // Big jobs: all day on any day. On weekdays customers can also ask for an
  // evening start. Carlos decides when he confirms (he can move it then).
  if (len === "long") return type === "weekday" ? ["allday", "evening"] : ["allday"];
  return Object.entries(WINDOWS)
    .filter(([, w]) => w.length === len && w.days.includes(type))
    .map(([id]) => id);
}

// Given confirmed jobs on one date ([{window}]), is `windowId` still open?
// An all-day job blocks everything that day; any job blocks an all-day request.
export function windowOpen(windowId, jobsThatDay) {
  if (!jobsThatDay || !jobsThatDay.length) return true;
  if (windowId === "allday") return false;
  return !jobsThatDay.some((j) => j.window === "allday" || j.window === windowId);
}

export function windowLabel(id) {
  const w = WINDOWS[id];
  return w ? `${w.label} · starts ${w.start}` : id;
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function todayChicago(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function prettyDate(ymd, opts = { weekday: "short", month: "short", day: "numeric" }) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
