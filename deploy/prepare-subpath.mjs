#!/usr/bin/env node
// Configure the production build for NASQO under the existing ERP HTTPS domain.
// Changes only dist output. The source mobile runtime and existing Odoo are untouched.
import fs from "node:fs";
import path from "node:path";

const base = "/nsqo-app/";
const out = path.resolve("dist/client");
const indexPath = path.join(out, "index.html");
const manifestPath = path.join(out, "manifest.webmanifest");
let html = fs.readFileSync(indexPath, "utf8");

if (!html.includes(base + "assets/index-")) {
  throw new Error("Vite output must be built using --base " + base);
}
html = html.replaceAll('href="/icon.svg"', 'href="' + base + 'icon.svg"');
html = html.replaceAll('href="/manifest.webmanifest"', 'href="' + base + 'manifest.webmanifest"');
fs.writeFileSync(indexPath, html);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.id = base;
manifest.scope = base;
manifest.start_url = base;
if (Array.isArray(manifest.icons)) {
  manifest.icons = manifest.icons.map((icon) => ({
    ...icon,
    src: icon.src === "/icon.svg" ? base + "icon.svg" : icon.src,
  }));
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log("Prepared isolated NASQO site:", base);
