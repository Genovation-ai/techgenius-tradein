import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/tg-admin-qa";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const report = { pages: [], errors: [] };

page.on("pageerror", (e) => report.errors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() === "error") report.errors.push(`console: ${msg.text()}`);
});

async function shot(name, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(700);
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  report.pages.push({ name, url: page.url(), path });
  console.log("shot", name, page.url());
}

// Login page
await shot("01-login", "http://127.0.0.1:5173/admin/login");

// Sign in
await page.fill('input[type="email"]', "admin@techgenius.ca");
await page.fill('input[type="password"]', "TechGenius2026!");
await page.click('button[type="submit"]');
await page.waitForURL("**/admin", { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: false });
report.pages.push({ name: "02-dashboard", url: page.url(), path: `${OUT}/02-dashboard.png` });

const routes = [
  ["03-offers", "/admin/offers"],
  ["04-catalog", "/admin/catalog"],
  ["05-pricing", "/admin/pricing"],
  ["06-customers", "/admin/customers"],
  ["07-inventory", "/admin/inventory"],
  ["08-reports", "/admin/reports"],
  ["09-settings", "/admin/settings"],
  ["10-shipping", "/admin/shipping"],
];

for (const [name, path] of routes) {
  await shot(name, `http://127.0.0.1:5173${path}`);
}

// Mobile sidebar
await page.setViewportSize({ width: 390, height: 844 });
await shot("11-mobile-dashboard", "http://127.0.0.1:5173/admin");
await page.click('button[aria-label="Open menu"]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/12-mobile-menu.png`, fullPage: false });
report.pages.push({ name: "12-mobile-menu", url: page.url(), path: `${OUT}/12-mobile-menu.png` });

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log("DONE", report.pages.length, "pages,", report.errors.length, "errors");
await browser.close();
