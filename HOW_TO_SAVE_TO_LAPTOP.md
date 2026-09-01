# How to save this project to your laptop

## What you get

1. **`TechGenius-TradeIn-FULL-PROJECT.zip`** — full source + docs + device images + SQLite DB (no `node_modules`)
2. **`PROJECT_MASTER_GUIDE.md`** — goal, what-is-what, every build step
3. **`STEPS_WE_MADE.md`** — clean chronological step log
4. Existing reports: `REUSELY_REPLICA_REPORT.md`, `PRODUCTION_AUDIT_REPORT.md`

## Download from Cursor Cloud

1. Open this agent run:  
   **https://cursor.com/agents/bc-019fafda-9feb-7864-8cfa-a4ebcd9bb397**
2. Use the agent’s **file browser / download** controls for the workspace.
3. Download:
   - `TechGenius-TradeIn-FULL-PROJECT.zip` (preferred — one file), **or**
   - the whole workspace folder if the UI offers “Download”
4. Save the zip to your laptop (Desktop or Documents).

## Unzip and run (clean)

```bash
# macOS / Linux
cd ~/Desktop   # or wherever you saved it
unzip TechGenius-TradeIn-FULL-PROJECT.zip -d TechGenius-TradeIn
cd TechGenius-TradeIn

# Backend
cd trade-in-backend
npm install
npm run db:migrate
npm run dev
# leave this terminal running → http://127.0.0.1:4100

# Frontend (new terminal)
cd ../trade-in-platform
npm install
npm run dev
```

Open the Vite URL shown in the terminal, then go to **`/admin`**.

**Login**

- Email: `admin@techgenius.ca`
- Password: `TechGenius2026!`

## Windows (PowerShell)

```powershell
Expand-Archive TechGenius-TradeIn-FULL-PROJECT.zip -DestinationPath TechGenius-TradeIn
cd TechGenius-TradeIn\trade-in-backend
npm install
npm run db:migrate
npm run dev
```

New terminal:

```powershell
cd TechGenius-TradeIn\trade-in-platform
npm install
npm run dev
```

## Verify no setup errors

```bash
curl http://127.0.0.1:4100/api/health
# expect: {"status":"ok", ...}
```

If `npm install` fails, use Node 20 LTS from https://nodejs.org and retry.

## Optional: keep git history

This zip excludes `.git` to stay smaller. If you need full commit history, download the workspace including `.git` from the agent UI, or re-init:

```bash
cd TechGenius-TradeIn
git init
git add .
git commit -m "Import Tech Genius trade-in full project"
```

## Cloud note

This agent workspace has **no GitHub remote (`origin`)**, so files are saved via **download from the agent**, not via `git push`. Putting the zip on your laptop is the correct backup path.
