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
- **Export Build** — returns the exact original code for an unchanged PoB2 import. Equipment edits patch the complete original document and update only the selected equipment set; other sets, skills, passive trees, jewels, flasks, charms, and unmapped data are retained. Skill/tree edits still cannot be exported.
- **Candidate equipment** — paste complete text from PoB2's item editor into a Forge gear slot, or adjust the imported item's modifiers. Save, reload, export, and save a candidate to your local gallery without buying or equipping anything in-game.
- **Build Workshop** — preserve an original beside a separate candidate. **Try change** applies a supported plain-language gear edit and calculates its impact using the installed Windows PoB2 engine. DPS, effective hit pool, life, energy shield and resistance comparisons update automatically, including after undo. Original/candidate exports and a manual fallback remain available.
- **Gear Editor / Skill Editor / Tree paste-import** — edit any slot, gem group, or the passive-tree URL in place
- **PoB2 Bridge** — "Connect via PoB2" launches PoB2 (GGG-approved OAuth), walks you through its import flow, then ingests the resulting code via clipboard

## What's coming

- **Calculation coverage** — automatic equipment comparisons now run locally on Windows using the installed PoB2 engine. Broader skill/tree/jewel editing, integration of these results into other Forge panels, and portable calculator packaging remain future work.
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
- **POB2_PYTHON** — optional absolute path to 64-bit `python.exe` for automatic calculations. The calculator discovers standard per-user Windows PoB2 and Python installations; custom locations need `POB2_PATH` and `POB2_PYTHON`. Python 3 uses only its standard library. No Python package or extra Lua installation is required.
- **CONTACT_EMAIL** — sent in the User-Agent on poe2scout price requests, per their API guidance.
- **PORT** — change if 3001 is taken.

No GGG credentials go in `.env`. If you're upgrading from v2.x, delete `POESESSID` and `POE_ACCOUNT` — they're no longer read — and delete `trade_log.sqlite` if one exists; nothing writes to it anymore.

## Using it

**Import a character.** Welcome → **Connect via PoB2**. PoB2 signs you in through GGG's official OAuth page, you pick your character inside PoB2 (5 clicks), copy the generated code, and Forge ingests it from your clipboard. Or paste any PoB2 code directly in Theorycraft → PoB2 Decoder.

**Hunt upgrades.** Optimizer tab → set priority sliders and a budget → click a gear slot. Forge builds an equippability-gated, budget-capped search biased toward mods your build cares about and opens it on the official trade site. Browse, whisper, and trade there — on GGG's own UI, with live listings.

**Theorycraft.** The S-Rank Scanner pattern-matches for downside-negation interactions (Last Lament + Lich Eternal Life being the canonical case). The Advanced Thaumaturgy reference surfaces alt-quality effects that delete a downside — Gemling fuel.

**Try a gear change.** Import a PoB2 build, toggle EDIT MODE on the paperdoll, and click a slot. Adjust the current item's modifiers, or paste complete item text from PoB2's item editor and click **Load item text** to replace it. A replacement retains its own quality, sockets, and other properties. Click **Save**, then **Export Build (PoB2)**. Import that code into a new PoB2 build to calculate and compare it with the original. No purchase or in-game equipment change is needed. Codes, XML downloads, and local gallery entries include the supported gear edits, including after reloading Forge.

**Compare and describe a gear edit.** Open local **Build Workshop → Use current build**. Forge stores a full original snapshot and an independent candidate in `forge:workshop:v1`. Enter **Change my amulet from +2 to +4 projectile skills**, **Set my amulet life to +140**, or **Set my boots movement speed to 30%**, then choose **Try change**. Forge validates the complete export, updates only the candidate, and automatically calculates both versions. **Preview only** is optional. Select the desired attack under **Compare this skill** once; the selection is saved. Damage, effective hit pool, life and energy shield are shown first; expand **Damage and defence details** for the full comparison. The last ten candidate changes can be undone, including a reset to the original, and undo recalculates automatically.

This first plain-language flow uses a local, constrained command parser. It requires one existing modifier with one numeric value. Shorthand such as **Change crossbow +2 to +4 proj skills** works with or without **from**, regardless of case. Ambiguous rings or duplicated matches, mismatched original values, compound requests, new modifiers and unsupported descriptions are rejected. Requests to choose optimal item stats show an explicit capability explanation and leave the candidate unchanged. The parser does not call an AI provider, generate whole builds, judge item legality, or invent damage estimates; PoB2 calculates the results. Every proposed edit passes the existing complete-source equipment export before it can be applied.

**Automatic calculations.** The local Node server exposes `GET /pob2-calculator` and Origin-gated `POST /pob2-calculate`. It decodes bounded PoB2 codes, then uses a hidden 64-bit Python process to load the installed `lua51.dll`, PoB2 Lua modules and game data. The bootstrap follows PoB2's official headless wrapper; only drawing/input hooks are stubbed. Each uncached build receives a fresh process, isolated temporary user path, no update/network hooks and no file writes. The open PoB2 desktop session, account settings and saved builds are not changed. Source and result data stay local. The actual calculation engine and item-mod support are the installed PoB2 version's, so game accuracy remains subject to that version and the chosen configuration.

The in-memory cache holds at most 16 results and is keyed by XML, selected skill and the installed manifest identity. Requests are size-limited, worker processes time out, cancellation terminates a stale worker, and the browser checks response input hashes and its current comparison before accepting results. An installed-engine update invalidates old cache keys. GitHub Pages cannot launch a local process: automatic calculations require local Forge; the public site retains manual tools. The optional calculator currently supports Windows with a standard 64-bit Python 3 install.

**Manual fallback.** Expand **Manual PoB2 tools**, then use **Get candidate PoB2 code** or **Get original code**. Import into a separate PoB2 build, keep the same skill/configuration, and return its fresh export through **Check returned build → Attach PoB2 results**. This separate fallback conservatively compares returned inputs and blocks mismatches or missing calculated values. It remains available when the local calculator is disconnected.

Displayed values come from the installed engine's numeric output, or from `PlayerStat` entries when explicitly using manual tools. The engine version and selected skill are shown. Editing invalidates candidate results; in-flight or failed calculations never supply new numbers. Missing/non-finite numbers stay blank, resistance deltas use percentage points, and unlike `CombinedDPS`/`TotalDPS` metrics are not subtracted. The Optimizer and Game Planner guide stay separate until you explicitly open the candidate in the Optimizer.

**Continue elsewhere in Forge.** **Open candidate in Optimizer** replaces the Optimizer's current build with a copy of the candidate while preserving the Workshop original. You can use its gear editor, gallery save, PoB2 export, or Game Planner conversion. Return to Build Workshop and choose **Use Optimizer edits** to capture manual equipment changes; changes to the other calculation inputs are rejected. Starting a new comparison explicitly replaces the previous comparison/history. All comparison data stays in this browser's storage; local and public origins have separate storage. A storage-quota error is shown before a candidate change is committed.

Changing base type, rarity, or sockets requires complete replacement item text; Forge does not guess missing item properties. Paste PoB2 item text containing `Rarity:` and `Implicits:`, not a trade URL or a build code. Item legality and current damage calculations remain PoB2's responsibility. Forge shows imported numbers as needing recalculation after edits, and omits obsolete calculated numbers from edited exports.

The bottom equipment panel's **Export to PoB2** button opens the export window. Items containing PoB2's legacy modifier-roll metadata support numeric edits while preserving that metadata. Changing the modifier list's structure on those items requires complete replacement item text so roll selections cannot be applied to the wrong modifier.

Skill and passive-tree edits remain saved in Forge but cannot yet be exported. Mixed gear/skill/tree edits fail with an explanation instead of silently exporting only part of the work. The original imported code remains stored with the build.

**Use the in-game Build Planner.** Open **Theorycraft → Game Planner**, also available from the PoB2 export window. Choose a `.build` file, paste its JSON, or choose **Use current PoB2 build**. Forge keeps this guide in its own browser storage; importing a guide never replaces the Optimizer character. Edit its name, author, and notes, or use **Edit full guide JSON → Apply JSON changes** to edit recommendations. **Download .build** writes a JSON guide for the game. No OAuth or local proxy is needed.

Place the download in your Documents folder under `My Games/Path of Exile 2/BuildPlanner` (Documents may be redirected to OneDrive). GGG also supports uploading/subscribing through its website. See [GGG's Build Planner documentation](https://www.pathofexile.com/developer/docs/game). Native in-game acceptance must be checked separately; passing Forge's structure check does not establish it.

Imported guides preserve string/object entry forms, progression intervals including zero, weapon sets, support links, inventory coordinates, markup text, and unknown extension fields through download/reload. The preview displays markup as text. Files are processed in the browser, limited to 1 MB, and are not uploaded.

Generating from PoB2 reuses the complete equipment-export path, so supported gear edits become reference notes. Only the selected passive tree, skill set, and item set are used. Numeric passive hashes are mapped against the bundled GGG 0.5.5 data for PoB2's `0_5` tree family; other versions are flagged. Gem IDs use PoB2's explicit `gameId` mapping, not guesses from names. Attribute selections are written as recommendations and weapon-set allocations retain their scope. The catalog is a pinned snapshot, not a guarantee that future game patches are compatible.

This is a guide, not a character snapshot: it has no computed DPS and does not equip items or preserve rolled items as game objects. PoB gem levels/quality and equipment modifiers appear as notes. Socketed jewels, meta or multi-active-skill groups, unrecognized IDs, and unsupported tree versions are reported. Omitted entries require selecting **Download a partial guide** and are recorded in its description. Disabled groups and inactive sets are intentionally excluded. Forge skill/tree edits remain subject to the existing export restriction.

**Flasks and charms.** The planner includes the active item set's two flasks and three charms as distinct hints. They all use `Flask1`, with `slot_x` values 0/1 for the flasks and 2/3/4 for the charms (`slot_y: 0`), matching [PoB2's generated InventorySlots.lua at ce566ea](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/ce566eac45ea8a86477f513c7ee65a1ebe60014e/src/Data/InventorySlots.lua). Empty positions remain empty; identical base types are not collapsed. The **Flasks and charms** preview retains source names, rarity, levels, quality, modifiers, trigger text, and any recovery/duration/charge lines present in PoB2's item text. Administrative item IDs, implicit counts, and XML roll metadata are excluded from the notes. Base recovery/duration or other effects absent from the source are not calculated or invented. To refresh these items, edit/import them in PoB2, bring the new code into Forge, and choose **Use current PoB2 build** again. Existing `.build` guides preserve their own coordinates unchanged on import/export.

Planner data is © Grinding Gear Games. Passive IDs/names and class overrides are derived from [GGG's official 0.5.5 export, commit bd87e65](https://github.com/grindinggear/poe2-skilltree-export/tree/bd87e6512c92b868542eddfb1ba4ea8b6dc2da36). Gem IDs, names and flags are derived from [PoB2's generated Gems.lua, commit ce566ea](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/ce566eac45ea8a86477f513c7ee65a1ebe60014e/src/Data/Gems.lua). The bundled catalog records source URLs, dates, full commit IDs, and SHA-256 hashes. To regenerate it, download those pinned inputs and run `node tools/build-planner-catalog.cjs tree.json Gems.lua sources.json`, with `sources.json` containing the catalog's `sources` object. Review version compatibility when refreshing it. The previous optimizer's converter informed the field/slot model; its older lossy writer was not used for imported-guide round trips.

## Troubleshooting

**Testing Build Workshop.** `node tests/workshop.cjs` runs isolated browser tests with synthetic fixtures and no upstream requests. It covers preview/apply boundaries, full-source exports, original/candidate storage and undo, ambiguity rejection, matching and mismatched result codes, stale asynchronous previews, quota failure, manual Optimizer capture, safe item rendering, and narrow layouts. Use the same Playwright/`FORGE_TEST_BROWSER` setup as the PoB2 suite. `FORGE_TEST_OUTPUT` optionally writes desktop/mobile screenshots; `FORGE_TEST_FILTER` selects a test by name. Run the existing PoB2, Game Planner and production static-handler suites as regression checks. The fixture's 11k/14k figures exercise the display flow and are not new native calculation evidence.

**Testing automatic calculations.** The Workshop suite also tests one-click calculation, automatic undo/reload, failure handling, response hashes and stale results with a mocked service. `node tests/calculator.cjs` checks real HTTP request gates, size limits, input parsing, cache keys, engine changes and concurrency with a mocked worker. Native validation was performed separately against installed PoB2 0.23.1 using the user's level 62 Mercenary: +4/+2 projectile amulets calculated approximately 14,941/12,709 Explosive Grenade DPS. A +117-to-+140 life-modifier test changed life from 1,467 to 1,496 and effective hit pool from about 2,178 to 2,216; undo restored the prior candidate. These values describe that build's current configuration, not universal predictions.

**Testing Game Planner.** `node tests/game-planner.cjs` uses the same Playwright setup as the PoB2 suite below. It covers actual file selection/download, metadata edits and reload, full-field round trips, malformed files, inert markup, selected PoB2 sets, ID translation, the +4 amulet case, partial exports, and stale asynchronous work. Run `node tests/pob-export.cjs` as the companion regression check and `node tests/planner-static.cjs` for the production static allowlist. Fixture browser traffic is restricted to the local test server; tests contain no user builds.

**Testing this equipment-export change.** `tests/pob-export.cjs` uses Playwright with an isolated browser and local synthetic fixtures. Install Playwright as a development tool or put an existing installation on `NODE_PATH`, install its Chromium browser, then run `node tests/pob-export.cjs`. Set `FORGE_TEST_BROWSER` to an existing Chromium/Edge executable to use it instead. No additional runtime dependency is used by Forge. The suite covers active/inactive equipment sets, source preservation, reloads, the actual slot editor, gallery saves, export races, invalid inputs, and XML downloads. A native PoB2 import remains a separate compatibility check.

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
- `poe2forge-planner.js`, `poe2forge-planner-data.json` — guide validation/conversion and a pinned game ID catalog; both are served by the local server's exact allowlist
- `poe2forge-workshop.js`, `poe2forge-workshop.css` — isolated original/candidate workspace, local equipment-command preview, conservative PoB2 result matching, and responsive comparison styles; exact public entries in the static allowlist
- `poe2forge-calc.js`, `tools/pob2/` — local calculation service and isolated installed-engine runner. Not served as public static assets. Upstream headless definition provenance and MIT notice are in `tools/pob2/NOTICE.md`.
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
