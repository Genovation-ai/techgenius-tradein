# Archive — superseded, kept only for reference

Nothing in here is built, imported or served. It is parked rather than deleted
so old links keep resolving, but treat all of it as out of date.

| Folder | Why it is here |
|--------|----------------|
| `framer-upload/` | A build of `tg-trade-in.js` from 2026-08-03 plus early Framer prompts. It predates the catalog de-dupe, the grading rules, two-spec laptop pricing and the server-authoritative promo fix. Shipping it would reintroduce every one of those bugs. |
| `Downloads/` | Six iterations of Framer prompt text, superseded by `FRAMER_PROMPT.txt` in the deliverable. |
| `screenshots/` | Development screenshots (~8.5 MB). |

**The current Framer integration lives in two places, and only two:**

- `trade-in-platform/framer/` — the code component and embed snippet in-repo
- `~/Downloads/TechGenius-Framer-Sell/` — the deliverable you hand to Framer
  (built JS/CSS, setup guide, paste-in prompt)

Rebuild the embed with `npm run build:embed:lite`; never copy from here.
