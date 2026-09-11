# POE2 Forge

A local-first Path of Exile 2 build workbench: PoB2 code decoding, a cross-class S-rank pattern scanner, gear/skill/tree editors, build export, and an upgrade finder that builds prioritized searches and opens them on the **official trade site**. Vanilla HTML/CSS/JS frontend, Node.js stdlib server, zero npm dependencies.

**Live demo:** https://cboyd421-max.github.io/poe2-forge

> This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## Compliance

Forge uses **only resources GGG documents for third-party use**. As of v17 (2026-07-04):

- **No undocumented pathofexile.com endpoints.** The v2.x trade2 proxy, `character-window/*` calls, and every other internal-website-API integration were removed entirely. Neither the local server nor the frontend makes any request to pathofexile.com.
- **No session cookies.** POESESSID auth is gone. Forge uses no GGG credentials of any kind. Stale `POESESSID`/`POE_ACCOUNT` entries in an old `.env` are ignored (the server prints a notice suggesting you delete them).
- **No trade-data collection.** The v2.x trade-search SQLite logging was removed. Forge does not scrape, warehouse, or redistribute market data.
- **Trade searches happen on GGG's own site.** Forge constructs a trade-site URL from your build's priorities and opens it in your browser. You browse listings, whisper, and trade on pathofexile.com itself.
- **Character import rides PoB2's approved OAuth.** Path of Building 2 holds a GGG-approved OAuth client; Forge launches it, you import inside PoB2, and Forge ingests the resulting build code from your clipboard. Direct GGG import is unavailable (OAuth registration status unverified).
- **The `.build` format is officially documented.** PoB2 code decode/encode and `.build` interop use published formats, entirely client-side.
- **Price context comes from third-party public APIs** (poe2scout.com), fetched with an identifying User-Agent and cached locally for 30 minutes to keep request volume polite.

## OAuth status

OAuth registration status unverified; direct character import unavailable. Use the PoB2 export/import workflow.

## What works today

- **Welcome tab** — setup checklist and the PoB2 bridge entry point for character imports
- **Optimizer tab** — three-panel paperdoll; click any slot to open a prioritized upgrade search on the official trade site (equippability-gated, budget-capped, biased toward relevant mods via pseudo-stat filters)
- **Theorycraft → PoB2 Decoder** — paste any PoB2 export code, decode in-browser (zero-dep, `DecompressionStream` + `DOMParser`), populate the Optimizer in one click
- **Theorycraft → Build Gallery** — curated league-ready builds plus your own saved entries via `localStorage`
- **Theorycraft → S-Rank Scanner** — pattern-matches builds for the "downside text negated by ascendancy keystone" pattern; scan your current build or pick a class + ascendancy + skill + item combo manually
- **Theorycraft → Advanced Thaumaturgy** — searchable alt-quality skill reference (data from PoE2DB via the bundled scraper)
- **Export Build** — returns the complete original PoB2 code for an unchanged imported build, including after a reload. Exporting edited builds is not supported yet.
- **Gear Editor / Skill Editor / Tree paste-import** — edit any slot, gem group, or the passive-tree URL in place
- **PoB2 Bridge** — "Connect via PoB2" launches PoB2 (GGG-approved OAuth), walks you through its import flow, then ingests the resulting code via clipboard

## What's coming

- **Phase 8** — damage calculation engine (replaces the "STATS STALE" pill on edited builds with real recomputed numbers). Approach: vendor PoB2's Lua calc engine, run it in-browser via Fengari.
- **Phase 9** — side-by-side build comparison with stat diffs
- **Phase 10** — price-context panel fed by public third-party economy APIs (poe2scout, poe.ninja's poe2 endpoints). No GGG endpoints, no data warehousing.
- **Phase 11** — opt-in, local-only telemetry of Forge's own recommendations for a prediction-accuracy feedback loop. Your data stays on your machine.
- **Interactive passive-tree renderer** — visual tree à la Maxroll/Mobalytics — depends on PoE2 tree data availability

## Setup

### Quick start (no install, no server)

Open https://cboyd421-max.github.io/poe2-forge in any modern browser. The Theorycraft tools work out of the box — decoder, gallery, S-rank scanner, alt-quality reference, gear/skill/tree editors, export. Slot clicks open the official trade site directly (without a prefilled query when the local server isn't running).

### Full setup (prefilled trade searches, PoB2 auto-launch, price cache)

You need **Node.js** (v18+) and a clone of this repo.

```
git clone https://github.com/cboyd421-max/poe2-forge.git
cd poe2-forge
node poe2forge-proxy.js
```

Then open **http://localhost:3001/** in your browser.

### Optional `.env`

Create a `.env` in the project root if you want any of these:

```
POB2_PATH=C:\Program Files\Path of Building Community (PoE2)\Path of Building.exe
CONTACT_EMAIL=you@example.com
PORT=3001
```

- **POB2_PATH** — enables one-click PoB2 launch from the Welcome tab. Without it the bridge still works; you just open PoB2 yourself.
- **CONTACT_EMAIL** — sent in the User-Agent on poe2scout price requests, per their API guidance.
- **PORT** — change if 3001 is taken.

No GGG credentials go in `.env`. If you're upgrading from v2.x, delete `POESESSID` and `POE_ACCOUNT` — they're no longer read — and delete `trade_log.sqlite` if one exists; nothing writes to it anymore.

## Using it

**Import a character.** Welcome → **Connect via PoB2**. PoB2 signs you in through GGG's official OAuth page, you pick your character inside PoB2 (5 clicks), copy the generated code, and Forge ingests it from your clipboard. Or paste any PoB2 code directly in Theorycraft → PoB2 Decoder.

**Hunt upgrades.** Optimizer tab → set priority sliders and a budget → click a gear slot. Forge builds an equippability-gated, budget-capped search biased toward mods your build cares about and opens it on the official trade site. Browse, whisper, and trade there — on GGG's own UI, with live listings.

**Theorycraft.** The S-Rank Scanner pattern-matches for downside-negation interactions (Last Lament + Lich Eternal Life being the canonical case). The Advanced Thaumaturgy reference surfaces alt-quality effects that delete a downside — Gemling fuel.

**Edit and export.** Toggle EDIT MODE on the paperdoll to modify gear; Edit Skills / Edit Passive Tree from the left panel. Edits are saved in Forge, but edited-build export is not supported yet. An unchanged PoB2 import can be exported with its original code.

## Troubleshooting

**PoB2 rejects a Forge export / original code missing.** Older versions forgot the original PoB2 code on reload and generated incomplete XML with an unsupported tree version. Import the original PoB2 code again through Theorycraft → PoB2 Decoder and send it to Optimizer. Forge now stores that code with the build. The export's format check confirms decoding only; it is not a live test inside PoB2.

**"SERVER OFFLINE" pill.** The local server isn't running. Start it with `node poe2forge-proxy.js`. Theorycraft tools work without it; slot clicks fall back to opening the trade site without a prefilled query.

**Slot click opens the trade site with no filters.** Same cause — the local server builds the prefilled query. Start it and retry.

**PoB2 doesn't auto-launch from "Connect via PoB2".** Verify `POB2_PATH` in your `.env` points to the actual PoB2 executable, then restart the server. The wizard still works without auto-launch — open PoB2 yourself and use "Paste from Clipboard" after generating the code.

**Prices missing.** The `/prices/*` passthrough needs the local server running and poe2scout reachable. Cached responses last 30 minutes.

**Anything else.** DM me — easier than you debugging it.

## File map

- `POE2Forge_v17.html` — current single-file frontend (ToS-compliance release)
- Earlier releases (v4–v16) are preserved in **git history only** — the v2.x era carried the retired POESESSID/trade-proxy flow, so those files are deliberately not part of the distributed tree.
- `poe2forge-proxy.js` — local app server v3.0: static-file serving, official-trade-site link builder, poe2scout price passthrough with caching, PoB2 launcher. **Makes zero pathofexile.com requests.**
- `poe2forge-gallery-codes.js` — sidecar with the curated PoB codes
- `poe2db-base-types.json`, `poe2db-skills.json`, `poe2db-uniques.json` — reference data (paperdoll icons + alt-quality strings)
- `scrape-poe2db.js` — zero-dep Node script to refresh the JSON files after a patch (scrapes the community site poe2db.tw, not pathofexile.com)
- `index.html` — GitHub Pages landing; redirects to v17
- `.gitignore` — blocks `.env`, `node_modules/`, `*.log`, `trade_log.sqlite`

## Stack

Vanilla HTML/CSS/JS frontend, Node.js stdlib server (no npm dependencies). The server:

- serves the app's files over HTTP (exact-filename allowlist) so `file://` loading limitations don't bite
- builds official-trade-site deep-link URLs from build priorities (`POST /trade-link`)
- proxies the public poe2scout economy API with a 30-minute cache and identifying User-Agent (`GET /prices/*`)
- spawns PoB2 via `child_process.spawn` for the import bridge
- accepts loopback traffic only: binds `127.0.0.1` and validates `Host`/`Origin` against the two supported launch URLs (`http://localhost:3001`, `http://127.0.0.1:3001`) — no wildcard CORS
- **never contacts pathofexile.com** — retired v2.x routes return HTTP 410 with a pointer to this section

PoB code encode/decode is fully client-side: `CompressionStream` / `DecompressionStream` + `DOMParser`, no `pako`, no server round-trip.

## Changelog

### v17 — ToS-compliance release (2026-07-04)

Removed every pathofexile.com call outside GGG's documented developer API:

- **Removed** the trade2 search/fetch proxy. Upgrade hunting now deep-links prioritized searches to the official trade site.
- **Removed** POESESSID session-cookie auth entirely. Setup instructions telling users to extract their cookie are gone; the server ignores stale `.env` credentials and says so.
- **Removed** the `character-window/*` PoE1 character import. All character import routes through PoB2's GGG-approved OAuth (Forge has no confirmed OAuth registration of its own).
- **Removed** trade-search SQLite logging and the market-intelligence data-collection plan built on it. Phase 10 is redefined around public third-party economy APIs.
- **Added** `POST /trade-link` (official-site URL builder) and `GET /prices/*` (poe2scout passthrough, cached, identified User-Agent).
- **Added** the required non-affiliation notice to the app footer, Pages landing, and this README.
- Server rebranded from "Trade API Proxy" to "Local App Server" (v3.0); retired routes return 410 with migration pointers.

*Pre-publication review (2026-09-10):* legacy release files (v4–v16 HTML, the friends-guide PDF and its generator, the original roadmap PDF) retired from the distributed tree, all preserved in git history; server hardened — loopback-only bind, `Host`/`Origin`/`Sec-Fetch-Site` gating replacing wildcard CORS, exact-file static allowlist, malformed-request containment, PoB2 spawn-failure handling with an Origin-gated launch route, supported-keys-only `.env` loading (retired credentials detected by name, never imported, stripped from child environments); OAuth-status wording replaced with unverified-status language.

### v16 — PoB2 bridge

Semi-automated PoE2 character import via PoB2's approved OAuth client: launch PoB2, import inside it, paste the code back into Forge.

*(Earlier history: Phases 0–7C — decoder, gallery, scanner, alt-quality reference, gear/skill/tree editors, export — see version files and git log.)*

## License

MIT.
