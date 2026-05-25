# POE2 Forge

A Path of Exile 2 build tool that combines a Path of Building 2 alternative, a live trade-market optimizer, an AI-assisted theorycrafting partner, and (eventually) a market-intelligence layer — all in one local-first web app, zero npm dependencies.

**Live demo:** https://cboyd421-max.github.io/poe2-forge

> The Pages link loads the UI fully. The PoB2 decoder, build gallery, S-rank scanner, Advanced Thaumaturgy reference, gear/skill/tree editors, and build export all work standalone in the browser. Anything that hits the live trade API (Optimizer tab, character import, PoB2 bridge) needs the local Node proxy in the [Setup](#setup) section.

## What works today (Phases 0–7C + PoB2 bridge)

- **Welcome tab** — first-time setup checklist, league + character dropdown, and the PoB2 bridge entry point for PoE2 character imports
- **Optimizer tab** — three-panel paperdoll, scored upgrade results from the live `trade2` API, copy-whisper + step-by-step trade flow for every result
- **Theorycraft → PoB2 Decoder** — paste any PoB2 export code, decode in-browser (zero-dep, `DecompressionStream` + `DOMParser`), populate the Optimizer in one click
- **Theorycraft → Build Gallery** — curated set of league-ready builds plus your own saved entries via `localStorage`
- **Theorycraft → S-Rank Scanner** — pattern-matches builds for the "downside text negated by ascendancy keystone" pattern; two modes — scan your current build, or pick a class + ascendancy + skill + item combo manually
- **Theorycraft → Advanced Thaumaturgy** — searchable alt-quality skill reference (full data fills in 24–48h after 0.5 launches)
- **Export Build** — round-trips back to a PoB2 paste code. Lossless for PoB-sourced builds; synthesized minimal XML for everything else
- **Gear Editor (Phase 7A)** — toggle "EDIT MODE" on the paperdoll. Click any slot to edit rarity, name, base, item level, and individual implicit + explicit mods
- **Skill Editor (Phase 7B)** — "Edit Skills" button in the Optimizer left panel. Edit any gem group: main skill + supports (each with an in-game-style searchable gem picker), gem level + quality, slot label, enabled/disabled toggle, MAIN radio across groups
- **Passive Tree paste-import (Phase 7C)** — "Edit Passive Tree" button. Paste any tree URL (pathofexile.com / pobb.in / poeplanner), see validated source + estimated node count, replace the build's tree
- **PoB2 Bridge (v16)** — "Connect via PoB2" button on Welcome. Launches PoB2 (which has GGG-approved OAuth for PoE2), walks you through its import flow, then ingests the resulting code via clipboard. Workaround for PoE2 character API still being OAuth-gated

## What's coming

- **Phase 8** — damage calculation engine (replaces the "STATS STALE" pill on edited builds with real recomputed numbers). Approach: vendor PoB2's Lua calc engine, run it in-browser via Fengari.
- **Phase 9** — side-by-side build comparison with stat diffs
- **Phase 10** — market intelligence dashboard (Phase 1 already logs every trade search; visualizes after one full league of data)
- **Phase 11** — build telemetry + prediction-accuracy feedback loop
- **Interactive passive-tree renderer** — visual tree à la Maxroll/Mobalytics — depends on post-launch PoE2 tree data

Full plan: [`POE2Forge_Roadmap.pdf`](POE2Forge_Roadmap.pdf).

## Setup

### Quick start (no install, no proxy)

Just open https://cboyd421-max.github.io/poe2-forge in any modern browser. The Theorycraft tabs work out of the box — decoder, gallery, S-rank scanner, alt-quality reference, gear/skill/tree editors, export. You'll see "PROXY OFFLINE" in the header — that's expected without the proxy.

### Full setup (Optimizer trade scans, character import, PoB2 bridge)

You need **Node.js** and a clone of this repo. As of v2.5 the proxy also serves the HTML/JSON/icons over HTTP, so you don't need a separate static-file server.

#### 1. Install Node.js

Download from https://nodejs.org and run the installer. v18+ is fine.

```
node --version
```

#### 2. Clone the repo

```
git clone https://github.com/cboyd421-max/poe2-forge.git
cd poe2-forge
```

#### 3. Create `.env`

Create a file called `.env` in the project root:

```
POESESSID=paste_your_pathofexile_cookie_here
POE_ACCOUNT=YourAccountName#1234
PORT=3001
POB2_PATH=C:\Program Files\Path of Building Community (PoE2)\Path of Building.exe
```

- **POESESSID** — your pathofexile.com session cookie. Lets the proxy hit the trade API. Get it via DevTools (`F12`) → Application/Storage → Cookies → pathofexile.com → POESESSID → copy the Value
- **POE_ACCOUNT** — your full account name including the discriminator (e.g. `MyName#1234`). Needed for the character endpoint
- **PORT** — the proxy port. Leave at 3001 unless you need to change it
- **POB2_PATH** — *optional.* Absolute path to your installed PoB2 executable. Enables the "Connect via PoB2" auto-launch on Welcome. Without it the bridge still works — you just open PoB2 yourself

> Treat POESESSID like a password. The included `.gitignore` already blocks `.env` so you can't accidentally commit it.

#### 4. Run the proxy

```
node poe2forge-proxy.js
```

You should see a banner with the app URL:

```
╔══════════════════════════════════════════════╗
║       POE2 FORGE — Trade API Proxy v2.5      ║
║       Running on http://localhost:3001       ║
╠══════════════════════════════════════════════╣
║  Open the app:                               ║
║   http://localhost:3001/POE2Forge_v16.html   ║
║  (or just http://localhost:3001/ → redirects) ║
╚══════════════════════════════════════════════╝
```

Leave the terminal open while you use the app.

#### 5. Open the UI

Go to **http://localhost:3001/** in your browser. The proxy serves HTML, JSON, and icons over HTTP — the header pill should turn green and show your current league.

## Using it

**Welcome tab.** First load shows a setup checklist. Two ways to import a character:
- **PoE1 characters:** "Connect Character" dropdown. League + Character → Import. Works against GGG's public profile endpoint.
- **PoE2 characters:** "Connect via PoB2" button. PoE2's character API is OAuth-gated and GGG hasn't approved Forge's OAuth yet, so we route through PoB2 (which *is* approved). The wizard walks you through PoB2's 5-click import flow, then ingests the resulting code via clipboard.

**Optimizer tab.** Once a build is loaded, adjust priority sliders (Resistance / Life / DPS / Defense / MF), set a budget, then click a slot to scan it or **SCAN ALL UPGRADES** for the whole paperdoll. Click a result for the full mod breakdown and deltas vs. your current item. **Copy Whisper** copies the in-game whisper command — paste it into PoE chat to start the trade.

**Theorycraft → PoB2 Decoder.** Paste any PoB2 export code (from pobb.in, Discord, Reddit, your own PoB) and hit Decode. The build summary appears inline; **Send to Optimizer** loads it for trade-scan upgrades.

**Build Gallery.** Click a curated card to load it. Save your own with the star button (lives in `localStorage`, not synced).

**S-Rank Scanner.** Scan your current build, or pick a class + ascendancy + skill + item combo manually. Each flag explains the actual game-mechanics reasoning.

**Advanced Thaumaturgy.** Search any skill to see its normal-quality effect alongside the hidden Advanced Thaumaturgy alt-quality effect (Gemling builds depend on this). Data fills in once PoE2DB ingests post-launch (~24–48h after 5/29).

**Export Build.** Available from the Decoder, the Gallery, and the Optimizer's left panel. Generates a PoB2 paste code. For PoB-sourced builds it's byte-for-byte identical to what you imported; for everything else it's a synthesized minimal XML PoB2 still re-imports cleanly.

**Gear Editor (EDIT MODE).** Toggle the violet "EDIT MODE" chip on the paperdoll. Every slot turns dashed-violet; clicking opens a modal where you edit rarity, name, base, item level, and individual mods.

**Skill Editor (Edit Skills).** Click "Edit Skills" in the Optimizer left panel. Each gem group has main + supports (with an in-game-style searchable gem picker), gem level + quality, a slot label, an ENABLED/DISABLED chip, and a MAIN radio. Add or remove groups as needed.

**Tree Editor (Edit Passive Tree).** Click "Edit Passive Tree" in the Optimizer left panel. Shows the current URL + node count. Paste a new URL to replace it (validated against pathofexile.com / pobb.in / poeplanner); save commits.

**STATS STALE pill.** Appears in the scan-status bar after any edit. The displayed stats came from PoB's calc engine against the imported build; once mods/skills/tree change, those numbers no longer match. Phase 8 will replace this with live recomputation. Today: paste the exported code back into PoB2 if you want fresh stats.

## Troubleshooting

**"PROXY OFFLINE" pill.** The proxy isn't running. Restart with `node poe2forge-proxy.js`.

**Rate limit errors (429).** GGG caps trade API calls. The proxy enforces ~12/minute; if you spam SCAN ALL you'll hit it. Wait 60 seconds.

**Empty results / 401 / 403 on trade scans.** Your POESESSID expired. Log out and back in at pathofexile.com, grab a fresh cookie, update `.env`, restart the proxy.

**"PoE2 characters not visible" when importing.** Use the **Connect via PoB2** button on Welcome instead. The "Connect Character" dropdown today returns PoE1 characters only (OAuth is pending GGG approval); the PoB2 bridge is the supported PoE2 workaround.

**PoB2 doesn't auto-launch from "Connect via PoB2".** Verify `POB2_PATH` in your `.env` points to the actual PoB2 executable, then restart the proxy. The wizard still works without auto-launch — open PoB2 yourself and use the "Paste from Clipboard" button after generating the code.

**Anything else.** DM me — easier than you debugging it.

## File map

- `POE2Forge_v16.html` — current single-file frontend (PoB2 bridge)
- `POE2Forge_v15.html` — Phase 7C (tree paste-import)
- `POE2Forge_v14.html` — Phase 7B (skill editor + gem picker)
- `POE2Forge_v13.html` — Phase 7A (gear editor)
- `POE2Forge_v6.html` through `_v12.html` — earlier versions, kept as rollback points
- `POE2Forge_v4.html`, `_v5.html` — pre-Phase-0 history
- `poe2forge-proxy.js` — local Node proxy (trade API + character endpoints + trade-data logging + static-file serving + PoB2 launch)
- `poe2forge-gallery-codes.js` — Phase 3 sidecar with the curated PoB codes
- `poe2db-base-types.json`, `poe2db-skills.json`, `poe2db-uniques.json` — Phase 5 reference data (paperdoll icons + alt-quality strings)
- `scrape-poe2db.js` — zero-dep Node script to refresh the JSON files after a patch
- `index.html` — GitHub Pages landing; redirects to v16
- `POE2Forge_Roadmap.pdf` — canonical 11-phase project plan
- `.gitignore` — blocks `.env`, `node_modules/`, `*.log`

## Stack

Vanilla HTML/CSS/JS frontend, Node.js stdlib proxy (no npm dependencies). The proxy:
- forwards GGG `trade2` and `character-window` requests with your POESESSID
- logs every trade search to a local SQLite file for future market-intelligence work (Phase 10)
- serves the project's HTML/JSON/icons over HTTP so `file://` loading limitations don't bite
- spawns PoB2 via `child_process.spawn` for the v16 bridge workflow
- handles CORS at the proxy layer so the frontend can be served from anywhere

PoB code encode/decode is fully client-side: `CompressionStream` / `DecompressionStream` + `DOMParser`, no `pako`, no proxy round-trip.
