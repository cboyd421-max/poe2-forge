# POE2 Forge

A Path of Exile 2 build tool that combines a Path of Building 2 alternative, a live trade-market optimizer, an AI-assisted theorycrafting partner, and (eventually) a market-intelligence layer — all in one local-first web app, zero npm dependencies.

**Live demo:** https://cboyd421-max.github.io/poe2-forge

> The Pages link loads the UI fully. The PoB2 decoder, build gallery, S-rank scanner, Advanced Thaumaturgy reference, gear editor, and build export all work standalone in the browser. Anything that hits the live trade API (Optimizer tab, character import) needs the local Node proxy in the [Setup](#setup) section.

## What works today (Phases 0–7A)

- **Welcome tab** — first-time setup checklist (proxy, POESESSID, account); single screen, no docs to chase
- **Optimizer tab** — three-panel paperdoll, scored upgrade results from the live `trade2` API, copy-whisper + step-by-step trade flow for every result
- **Theorycraft → PoB2 Decoder** — paste any Path of Building 2 export code, decode in-browser (zero-dep, `DecompressionStream` + `DOMParser`), populate the Optimizer in one click
- **Theorycraft → Build Gallery** — curated set of league-ready builds (Jungroan Titan caster, Bridget Whirling Assault, etc.) plus your own saved entries via `localStorage`
- **Theorycraft → S-Rank Scanner** — pattern-matches builds for the "downside text negated by ascendancy keystone" pattern behind every recent S-tier build (Lich + Last Lament, Hollow Form + Rolling Slam, etc.); two modes — scan your current build, or pick a class + ascendancy + skill + item combo manually
- **Theorycraft → Advanced Thaumaturgy** — searchable alt-quality skill reference (full data fills in 24–48h after 0.5 launches)
- **Export Build** — round-trips back to a PoB2 paste code. Lossless for PoB-sourced builds; synthesized minimal XML for everything else
- **Gear Editor (Phase 7A)** — toggle "EDIT MODE" on the Optimizer paperdoll. Every slot becomes editable: rarity, base, item level, plus add/edit/remove individual implicit + explicit mods. Edits flow cleanly through the export path

## What's coming

- **7B / 7C** — skill gem editor + passive tree paste-import
- **8** — damage calculation engine (replaces the "STATS STALE" pill on edited builds with real recomputed numbers)
- **9** — side-by-side build comparison with stat diffs
- **10** — market intelligence dashboard (Phase 1 already logs every trade search; visualizes after one full league of data)
- **11** — build telemetry + prediction-accuracy feedback loop

Full plan: [`POE2Forge_Roadmap.pdf`](POE2Forge_Roadmap.pdf).

## Setup

### Quick start (no install, no proxy)

Just open https://cboyd421-max.github.io/poe2-forge in any modern browser. The Theorycraft tabs work out of the box — decoder, gallery, S-rank scanner, alt-quality reference, gear editor, export. You'll see "PROXY OFFLINE" in the header — that's expected without the proxy.

### Full setup (adds Optimizer trade scans and character import)

You need three things: **Node.js**, your **POESESSID cookie**, and a clone of this repo.

#### 1. Install Node.js

Download from https://nodejs.org and run the installer. v18+ is fine.

Verify in PowerShell or Terminal:
```
node --version
```

#### 2. Get your POESESSID

This is a session cookie from pathofexile.com. The proxy uses it to talk to the trade API as you.

1. Log in at https://www.pathofexile.com in any browser
2. Open DevTools (`F12`)
3. Go to the **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Under **Cookies → https://www.pathofexile.com**, find the row named `POESESSID`
5. Copy the **Value** — it's a long hex string

> Treat POESESSID like a password. Anyone with it can act as you on the trade site. Don't share it, don't paste it anywhere public. The included `.gitignore` already blocks `.env` so you can't accidentally commit it.

#### 3. Clone the repo and create `.env`

```
git clone https://github.com/cboyd421-max/poe2-forge.git
cd poe2-forge
```

Create a file called `.env` in the project root:
```
POESESSID=paste_your_cookie_value_here
PORT=3001
```

#### 4. Run the proxy

```
node poe2forge-proxy.js
```

You should see a banner like:
```
╔══════════════════════════════════════════════╗
║       POE2 FORGE — Trade API Proxy           ║
║       Running on http://localhost:3001       ║
╚══════════════════════════════════════════════╝
```

Leave this window open while you use the app.

#### 5. Open the UI

Open `POE2Forge_v13.html` from your local clone in a browser (or visit the Pages link with the proxy running). The header pill should turn green and show your current league.

## Using it

**Welcome tab.** First load shows a setup checklist. Most items auto-check once you're set up.

**Optimizer tab.** Once a build is loaded — via Welcome's "Import Character" or Theorycraft's "Send to Optimizer" — adjust the priority sliders on the left (Resistance / Life / DPS / Defense / MF), set a budget if you want, then click a slot to scan it or **SCAN ALL UPGRADES** for the whole paperdoll. Click a result for the full mod breakdown and deltas vs. your current item. **Copy Whisper** copies the in-game whisper command — paste it into PoE chat to start the trade.

**PoB2 Decoder.** Paste any PoB2 export code (from pobb.in, Discord, Reddit, your own PoB) and hit Decode. The build summary appears inline; **Send to Optimizer** loads it for trade-scan upgrades.

**Build Gallery.** Click a curated card to load it. Save your own with the star button (lives in `localStorage`, not synced).

**S-Rank Scanner.** Scan your current build, or pick a class + ascendancy + skill + item combo manually. Each flag explains the actual game-mechanics reasoning, not just "these things go together".

**Advanced Thaumaturgy.** Search any skill to see its normal-quality effect alongside the hidden Advanced Thaumaturgy alt-quality effect (Gemling builds depend on this). Data fills in once PoE2DB ingests post-launch (~24–48h after 5/29).

**Export Build.** Available from the Decoder, the Gallery, and the Optimizer's left panel. Generates a PoB2 paste code you can share or import into PoB2 itself. For PoB-sourced builds it's byte-for-byte identical to what you imported; for everything else it's a synthesized minimal XML that PoB2 still re-imports cleanly.

**Gear Editor (EDIT MODE).** Toggle the violet "EDIT MODE" chip on the paperdoll. Every slot turns dashed-violet; clicking opens a modal where you can edit rarity, name, base, item level, and add/edit/remove individual mods. Save commits to your current build. **Stats become stale** after editing (orange "STATS STALE" pill) — the displayed numbers came from PoB's calc engine against the original build; Phase 8 will recompute them properly. Edited builds export cleanly via the synthesize path.

## Troubleshooting

**"PROXY OFFLINE" pill.** The proxy isn't running. Restart with `node poe2forge-proxy.js`. (If you're only using the standalone Theorycraft features, ignore this.)

**Rate limit errors (429).** GGG caps trade API calls. The proxy enforces ~12/minute; if you spam SCAN ALL you'll hit it. Wait 60 seconds.

**Empty results / 401 / 403 on trade scans.** Your POESESSID expired. Log out and back in at pathofexile.com, grab a fresh cookie, update `.env`, restart the proxy.

**"No PoE2 characters" when importing.** GGG's character endpoint currently returns PoE1 characters only; PoE2 character access needs OAuth, which is pending GGG approval. PoB import is the workaround — copy your build's PoB code from the in-game tracker (post-0.5) or from any creator video, paste it into the Decoder.

**Anything else.** DM me — easier than you debugging it.

## File map

- `POE2Forge_v13.html` — current single-file frontend (Phase 7A, gear editor)
- `POE2Forge_v6.html` through `_v12.html` — prior versions, kept as rollback points
- `POE2Forge_v4.html`, `_v5.html` — pre-Phase-0 history
- `poe2forge-proxy.js` — local Node proxy (trade API + character endpoints + trade-data logging)
- `poe2forge-gallery-codes.js` — Phase 3 sidecar with the curated PoB codes
- `poe2db-base-types.json`, `poe2db-skills.json`, `poe2db-uniques.json` — Phase 5 reference data (paperdoll icons + alt-quality strings)
- `scrape-poe2db.js` — zero-dep Node script to refresh the JSON files after a patch
- `index.html` — GitHub Pages landing; redirects to v13
- `POE2Forge_Roadmap.pdf` — canonical 11-phase project plan
- `.gitignore` — blocks `.env`, `node_modules/`, `*.log`

## Stack

Vanilla HTML/CSS/JS frontend, Node.js stdlib proxy (no npm dependencies). The proxy forwards requests to `pathofexile.com/api/trade2/*` and `/character-window/*` with your POESESSID, reshapes responses for the UI, and logs every trade search to a local file for future market-intelligence work (Phase 10). CORS is handled at the proxy layer so the frontend can be served from anywhere.

PoB code encode/decode is fully client-side: `CompressionStream` / `DecompressionStream` + `DOMParser`, no `pako`, no proxy round-trip.
