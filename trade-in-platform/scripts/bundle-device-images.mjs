#!/usr/bin/env node
/** Rebuild src/data/deviceImageBundles.ts from public/devices/*.png|webp */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

const root = join(process.cwd(), "public/devices");
const out = join(process.cwd(), "src/data/deviceImageBundles.ts");
const mime = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

const files = readdirSync(root)
  .filter((f) => mime[extname(f).toLowerCase()])
  .sort();

const lines = [
  "/** Auto-generated: real product PNGs inlined for Framer/Shopify embed. Do not edit by hand. */",
  "export const deviceImageBundles: Record<string, string> = {",
];

let raw = 0;
for (const f of files) {
  const buf = readFileSync(join(root, f));
  raw += buf.length;
  const m = mime[extname(f).toLowerCase()];
  lines.push(`  "${basename(f, extname(f))}": "data:${m};base64,${buf.toString("base64")}",`);
}
lines.push("};", "");
writeFileSync(out, lines.join("\n"));
console.log(`bundled ${files.length} images (${raw} bytes) → ${out} (${statSync(out).size} bytes)`);
