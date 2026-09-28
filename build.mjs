// Build: copy public/ -> dist/, bundle the API worker, and stamp CSS/JS links
// with a content hash so phones never mix a new page with old cached styles.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

fs.rmSync("dist", { recursive: true, force: true });
fs.cpSync("public", "dist", { recursive: true });
execSync("npx esbuild src/worker.js --bundle --format=esm --outfile=dist/_worker.js --log-level=warning", { stdio: "inherit" });

const hash = (f) => createHash("md5").update(fs.readFileSync(f)).digest("hex").slice(0, 10);
const assets = {};
for (const dir of ["css", "js"]) for (const f of fs.readdirSync(`dist/${dir}`)) assets[`/${dir}/${f}`] = hash(`dist/${dir}/${f}`);
for (const f of ["images/hero/reel-720.mp4", "images/hero/reel-540.mp4", "images/hero/poster.jpg"]) assets[`/${f}`] = hash(`dist/${f}`);

const stamp = (text) => {
  for (const [url, h] of Object.entries(assets)) {
    text = text.split(`"${url}"`).join(`"${url}?v=${h}"`);
    text = text.split(`"${url}#`).join(`"${url}?v=${h}#`);   // e.g. video start-time fragments
  }
  return text;
};
for (const f of fs.readdirSync("dist").filter((f) => f.endsWith(".html"))) {
  fs.writeFileSync(`dist/${f}`, stamp(fs.readFileSync(`dist/${f}`, "utf8")));
}
// ES module imports between our own scripts
for (const f of fs.readdirSync("dist/js")) {
  const p = `dist/js/${f}`;
  let t = fs.readFileSync(p, "utf8");
  t = t.replace(/from "\.\/([\w-]+\.js)"/g, (m, name) => `from "./${name}?v=${assets[`/js/${name}`]}"`);
  fs.writeFileSync(p, t);
}
console.log("stamped", Object.keys(assets).length, "files");
