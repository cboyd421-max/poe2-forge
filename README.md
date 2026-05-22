# POE2 Forge

A Path of Exile 2 build optimizer with live trade API integration. Three-panel UI: your character on the left, scored upgrade results in the middle, item detail with upgrade deltas and trade flow guide on the right.

**Live demo (UI only):** https://cboyd421-max.github.io/poe2-forge

> ⚠️ The Pages URL loads the UI but won't show real data unless you run the local proxy below. The proxy uses *your* PoE session to query the trade API, so each user needs their own setup.

## What it does

- Reads your character stats (life, resistances, ES, etc.) — currently hardcoded in `POE2Forge_v4.html`, will be auto-pulled once GGG OAuth approves
- Searches the official PoE2 trade API for items that fix your worst stats first (uncapped resistance, low life, etc.)
- Scores each result against five priorities you control with sliders: resistance, life, DPS, defense, MF
- Shows upgrade deltas vs. your current character ("Fire Res: −55% → +20% ✓ CAPPED")
- Gives you a copy-paste whisper and a step-by-step trade flow for each item

## Setup

You need three things: **Node.js**, your **POESESSID cookie**, and a copy of this repo.

### 1. Install Node.js

Download from https://nodejs.org and run the installer. Any v18+ is fine.

Verify in PowerShell or Terminal:
```
node --version
```

### 2. Get your POESESSID

This is a session cookie from pathofexile.com. It lets the proxy talk to the trade API as you.

1. Log in at https://www.pathofexile.com in any browser
2. Open DevTools (`F12`)
3. Go to the **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Under **Cookies → https://www.pathofexile.com**, find the row named `POESESSID`
5. Copy the **Value** — it's a long hex string

> Treat POESESSID like a password. Anyone with it can use your PoE account on the trade site. Don't share it, don't paste it anywhere public, don't commit it to git.

### 3. Clone the repo and create `.env`

```
git clone https://github.com/cboyd421-max/poe2-forge.git
cd poe2-forge
```

Create a file called `.env` in the project root with this content:
```
POESESSID=paste_your_cookie_value_here
PORT=3001
```

The included `.gitignore` already blocks `.env`, so you won't accidentally commit it.

### 4. Run the proxy

```
node poe2forge-proxy.js
```

You should see a banner:
```
╔══════════════════════════════════════════════╗
║       POE2 FORGE — Trade API Proxy           ║
║       Running on http://localhost:3001       ║
╚══════════════════════════════════════════════╝
```

Leave this window open while you use the app.

### 5. Open the UI

Either visit https://cboyd421-max.github.io/poe2-forge with the proxy running, or open `POE2Forge_v4.html` from your local clone in a browser. The header pill should say something like "FATE OF THE VAAL" with a green dot — that means the proxy connected.

## Using it

- **Adjust priorities** with the sliders on the left. They're weights from 0–10, so cranking Resistance to 10 and Life to 5 will rank items with high resistance higher even if they have less life.
- **Click a gear slot** (RING, AMULET, etc.) to search just that slot, or hit **SCAN ALL UPGRADES** to sweep every slot.
- **Set a budget** in divine orbs to cap the search.
- **Click a result** to see the full mod breakdown, upgrade deltas vs. your character, and trade options.
- **Copy Whisper** copies the in-game whisper command — paste it into PoE chat to start the trade.

## Troubleshooting

**"PROXY OFFLINE" pill in the header.** The proxy isn't running, or it crashed. Check the terminal window — restart it with `node poe2forge-proxy.js`.

**Rate limit errors (429).** GGG caps trade API calls to ~12/minute. The proxy enforces this, but if you spam SCAN ALL repeatedly you'll hit it. Wait 60 seconds.

**Empty results / 401 / 403.** Your POESESSID expired. Log out and back in at pathofexile.com, get a fresh cookie, update `.env`, restart the proxy.

**Wrong league shown.** The proxy fetches the league list from GGG and picks the first non-Standard one. If you play a different league, edit `currentLeague` near the top of the `<script>` block in `POE2Forge_v4.html`.

**Anything else.** DM me — easier than you debugging it.

## What's coming

- **v5 UI** — paperdoll gear layout with real item icons, welcome/setup tab so you don't need to follow this README
- **Auto character import** — once GGG approves the OAuth flow, stats pull from your actual character
- **Theory Crafter** — class/ascendancy picker, skill gems, DPS calc, passive tree, Path of Building export

## Stack

Vanilla HTML/CSS/JS frontend, Node.js stdlib proxy (no dependencies). The proxy forwards requests to `pathofexile.com/api/trade2/*` with your POESESSID, then strips wiki markup and reshapes the response for the UI. CORS is handled at the proxy layer so the frontend can be served from anywhere.

## Files

- `POE2Forge_v4.html` — the optimizer (single-file HTML/CSS/JS)
- `poe2forge-proxy.js` — local Node proxy for the trade API
- `index.html` — redirects to the v4 file for GitHub Pages
- `.gitignore` — blocks `.env`, `node_modules/`, `*.log`
