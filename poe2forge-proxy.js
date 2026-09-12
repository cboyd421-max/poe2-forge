/**
 * POE2 Forge — Local App Server v3.0
 *
 * v3.0 is the ToS-compliance rewrite. This server makes ZERO requests to
 * pathofexile.com. No trade2 forwarding, no character-window forwarding,
 * no session cookies, no trade logging. See README "Compliance" section.
 *
 * What it does:
 *   - Serves the app's files over HTTP (exact-filename allowlist)
 *   - Builds official-trade-site deep-link URLs (the user's browser opens
 *     pathofexile.com directly; this server never contacts GGG)
 *   - Launches PoB2 for the character-import bridge (PoB2 holds its own
 *     GGG-approved OAuth client)
 *   - Optionally proxies the public poe2scout.com economy API for price
 *     context, with local caching so we're polite to their servers
 *
 * Usage: node poe2forge-proxy.js
 * Runs on: http://localhost:3001 — binds 127.0.0.1 (loopback only); Host and
 * Origin headers are validated against the two supported launch URLs
 *
 * .env keys (all optional):
 *   PORT           — server port (default 3001)
 *   POB2_PATH      — absolute path to PoB2 executable (enables auto-launch)
 *   POB2_PYTHON    — optional 64-bit Python executable for local calculations
 *   CONTACT_EMAIL  — sent in User-Agent to poe2scout per their API guidance
 *
 * POESESSID and POE_ACCOUNT are NO LONGER READ. If present in .env (or the
 * launching shell) they are detected by NAME only — their values are never
 * imported into this process, they are stripped from any launched child's
 * environment, and a notice is printed suggesting you delete them.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Load .env file if present — SUPPORTED KEYS ONLY. Anything else is left
// untouched; retired credential keys are recorded by name for the startup
// notice, but their values never enter process.env.
const SUPPORTED_ENV_KEYS = ['PORT', 'POB2_PATH', 'POB2_PYTHON', 'CONTACT_EMAIL'];
const RETIRED_KEY_NAMES = ['POESESSID', 'POE_ACCOUNT'];
const envFileRetiredKeys = [];
try {
  const envPath = path.join(__dirname, '.env');
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.trim().split('=');
    if (!key || !val.length) return;
    const k = key.trim();
    if (SUPPORTED_ENV_KEYS.includes(k)) process.env[k] = val.join('=').trim();
    else if (RETIRED_KEY_NAMES.includes(k)) envFileRetiredKeys.push(k);
  });
} catch {}

// ── CONFIG ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'cboyd421@gmail.com';
const APP_VERSION = '3.0';
const USER_AGENT = `POE2Forge/${APP_VERSION} (contact: ${CONTACT_EMAIL})`;

// Retired credentials — the union of names found in .env (values not
// imported) and names inherited from the launching shell (not ours to unset,
// but stripped from child environments in handlePob2Launch).
const RETIRED_ENV_KEYS = [...new Set([
  ...envFileRetiredKeys,
  ...RETIRED_KEY_NAMES.filter(k => process.env[k]),
])];

// Official trade site base for deep links. We only construct URLs with it —
// the user's own browser visits pathofexile.com; this process never does.
const TRADE_SITE_BASE = 'https://www.pathofexile.com/trade2/search/poe2';

// Public third-party economy API (https://poe2scout.com) for price context.
const PRICE_API_HOST = 'api.poe2scout.com';
const PRICE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const priceCache = new Map(); // path → { ts, status, body }

// ── RATE LIMITER (poe2scout politeness — NOT a GGG limiter) ─────────────────
const RATE_LIMIT = { requests: 30, windowMs: 60000 };
const requestLog = [];
function isRateLimited() {
  const now = Date.now();
  while (requestLog.length && requestLog[0] < now - RATE_LIMIT.windowMs) {
    requestLog.shift();
  }
  if (requestLog.length >= RATE_LIMIT.requests) return true;
  requestLog.push(now);
  return false;
}

// ── REQUEST GATING (Host / Origin) ───────────────────────────────────────────
// The app is supported at exactly two launch URLs, both served by this
// process on the loopback interface. Host validation defeats DNS rebinding;
// the Origin allowlist replaces the old wildcard CORS, so a request fired by
// any other page running in the user's browser is rejected outright.
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

// Returns false (after writing a 403) if the request may not proceed. When a
// cross-origin request IS allowed (localhost page ↔ 127.0.0.1 API), CORS
// headers echo that one origin — never a wildcard.
function gateRequest(req, res) {
  const host = req.headers.host || '';
  if (!ALLOWED_HOSTS.has(host)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: unrecognized Host header' }));
    return false;
  }
  const origin = req.headers.origin;
  const trustedOrigin = origin !== undefined && ALLOWED_ORIGINS.has(origin);
  if (origin !== undefined && !trustedOrigin) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: origin not allowed' }));
    return false;
  }
  // Browsers stamp every request's relationship in Sec-Fetch-Site, including
  // Origin-less ones (<img>, <script src>, top-level link navigations). An
  // explicitly cross-site request is allowed only with a trusted Origin:
  // that closes the no-Origin drive-by (an <img> pointed at /prices/*),
  // while preserving typed URLs ("none"), the app's own traffic
  // ("same-origin"), and the supported localhost↔127.0.0.1 pairing — which
  // is cross-site by site rules but always carries a trusted Origin.
  const fetchSite = (req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site' && !trustedOrigin) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: cross-site request without a trusted Origin' }));
    return false;
  }
  if (trustedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  return true;
}

// ── TRADE-SITE DEEP LINK BUILDER ─────────────────────────────────────────────
// Replaces the removed /smart-search route. Accepts the same body shape the
// frontend already sends ({ league, slot, stats, budget }), builds the same
// candidate query, but instead of executing it server-side, returns the
// official trade-site URL. The user reviews live listings on pathofexile.com
// itself — same results, GGG's own UI, zero undocumented API traffic.
function buildCandidateQuery(slot, stats, budget) {
  const typeMap = {
    helmet: 'armour.helmet',
    body:   'armour.chest',
    gloves: 'armour.gloves',
    boots:  'armour.boots',
    ring:   'accessory.ring',
    amulet: 'accessory.amulet',
    belt:   'accessory.belt',
    weapon: 'weapon',
    offhand:'armour.shield',
  };

  const filters = {};
  if (slot && typeMap[slot]) {
    filters.type_filters = { filters: { category: { option: typeMap[slot] } } };
  }

  if (stats && stats.level) {
    filters.req_filters = { filters: { lvl: { max: stats.level } } };
  }

  const tradeFilters = { sale_type: { option: 'priced' } };
  if (budget) {
    tradeFilters.price = { max: Number(budget), option: 'divine' };
  }
  filters.trade_filters = { filters: tradeFilters };

  // "At least 1 of these" count group — biases toward items with something
  // useful without hard-requiring any single mod. PSEUDO ids aggregate
  // implicit + explicit + hybrid sources.
  const relevantStatIds = [
    'pseudo.pseudo_total_life',
    'pseudo.pseudo_total_energy_shield',
    'pseudo.pseudo_total_mana',
    'pseudo.pseudo_total_fire_resistance',
    'pseudo.pseudo_total_cold_resistance',
    'pseudo.pseudo_total_lightning_resistance',
    'pseudo.pseudo_total_chaos_resistance',
    'pseudo.pseudo_total_all_elemental_resistances',
    'pseudo.pseudo_total_strength',
    'pseudo.pseudo_total_intelligence',
    'explicit.stat_3261801346', // Dexterity (no pseudo found)
    'explicit.stat_3981240776', // Spirit
  ];

  return {
    query: {
      status: { option: 'online' },
      stats: [{
        type: 'count',
        value: { min: 1 },
        filters: relevantStatIds.map(id => ({ id, disabled: false }))
      }],
      filters,
    },
    sort: { price: 'asc' }
  };
}

function handleTradeLink(body, res) {
  const { league = 'Runes of Aldur', slot, stats = {}, budget } = body || {};
  const payload = buildCandidateQuery(slot, stats, budget);
  const url = `${TRADE_SITE_BASE}/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(payload))}`;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ url, slot, league, query: payload }));
}

// ── PRICE CONTEXT (poe2scout public API passthrough + cache) ────────────────
// GET /prices/<anything> → https://api.poe2scout.com/<anything>
// Cached 30 min per path. This is a third-party community API that exists
// for exactly this purpose; we identify ourselves via User-Agent contact.
function handlePrices(subpath, res) {
  const cached = priceCache.get(subpath);
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
    res.writeHead(cached.status, { 'Content-Type': 'application/json', 'X-Forge-Cache': 'hit' });
    return res.end(cached.body);
  }
  if (isRateLimited()) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Local rate limit reached (30/min to poe2scout). Wait a moment.' }));
  }
  const options = {
    hostname: PRICE_API_HOST,
    port: 443,
    path: '/' + subpath,
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  };
  const upstream = https.request(options, (up) => {
    let data = '';
    up.on('data', c => data += c);
    up.on('end', () => {
      priceCache.set(subpath, { ts: Date.now(), status: up.statusCode || 200, body: data });
      res.writeHead(up.statusCode || 200, { 'Content-Type': 'application/json', 'X-Forge-Cache': 'miss' });
      res.end(data);
    });
  });
  upstream.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'poe2scout unreachable: ' + e.message }));
  });
  upstream.end();
}

// ── PoB2 BRIDGE — character import via PoB2's approved OAuth client ─────────
// PoB2 has a GGG-approved OAuth client and can pull PoE2 characters. Forge
// has no confirmed OAuth registration of its own, so we launch PoB2 and let
// the user run its import flow; the resulting build code comes back via
// clipboard and the in-browser decoder takes it from there.
function handlePob2Status(res) {
  const pob2Path = process.env.POB2_PATH || '';
  const configured = !!pob2Path;
  let exists = false;
  try { exists = configured && fs.statSync(pob2Path).isFile(); } catch {}
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    configured,
    exists,
    // Don't leak the full path back; just the basename is enough for UI hints.
    pathHint: configured ? path.basename(pob2Path) : null,
  }));
}

function handlePob2Launch(res) {
  const pob2Path = process.env.POB2_PATH || '';
  if (!pob2Path) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'POB2_PATH not configured in .env' }));
  }
  let stat;
  try { stat = fs.statSync(pob2Path); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'POB2_PATH points to a file that does not exist: ' + pob2Path }));
  }
  if (!stat.isFile()) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'POB2_PATH is not a file: ' + pob2Path }));
  }
  // Never hand retired credential variables to the child — even when the
  // shell this server was started from still exports them.
  const childEnv = { ...process.env };
  // Windows can preserve mixed casing in inherited environment names.
  for (const k of Object.keys(childEnv)) {
    if (RETIRED_KEY_NAMES.includes(k.toUpperCase())) delete childEnv[k];
  }
  let responded = false;
  const respond = (code, payload) => {
    if (responded) return;
    responded = true;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  try {
    const child = spawn(pob2Path, [], {
      detached: true,
      stdio: 'ignore',
      // Launch from PoB2's own directory so it finds its data files.
      cwd: path.dirname(pob2Path),
      env: childEnv,
    });
    // 'spawn' fires only on success. 'error' (EACCES and friends) arrives
    // ASYNCHRONOUSLY and, unhandled, would crash the whole server. Success
    // is reported only after the process actually spawned — exactly once.
    child.on('spawn', () => { child.unref(); respond(200, { status: 'launched', pid: child.pid }); });
    child.on('error', (e) => respond(500, { error: 'PoB2 launch failed: ' + e.message }));
  } catch (e) {
    respond(500, { error: 'spawn failed: ' + e.message });
  }
}

// ── STATIC FILE SERVER ───────────────────────────────────────────────────────
// Serves the app at http://localhost:3001/ — no second server needed.
// Exact-filename allowlist: these files are the app's public
// surface. Anything else (dotfiles, .env, the server source, git internals,
// traversal attempts) is refused regardless of its extension.
const STATIC_FILES = {
  'index.html':                 'text/html; charset=utf-8',
  'POE2Forge_v17.html':         'text/html; charset=utf-8',
  'poe2forge-gallery-codes.js': 'application/javascript; charset=utf-8',
  'poe2forge-planner.js':       'application/javascript; charset=utf-8',
  'poe2forge-planner-data.json':'application/json; charset=utf-8',
  'poe2forge-workshop.js':     'application/javascript; charset=utf-8',
  'poe2forge-trade.js':        'application/javascript; charset=utf-8',
  'poe2forge-workshop.css':    'text/css; charset=utf-8',
  'poe2db-base-types.json':     'application/json; charset=utf-8',
  'poe2db-skills.json':         'application/json; charset=utf-8',
  'poe2db-uniques.json':        'application/json; charset=utf-8',
};

// Returns true if a response was written (matched + handled). False = let the
// request fall through to the 404 handler so API misses still look like API
// misses, not "file not found".
function serveStatic(reqPath, res) {
  let rel;
  try {
    rel = decodeURIComponent(reqPath.replace(/^\/+/, ''));
  } catch {
    // Malformed percent-encoding (e.g. /% or a truncated UTF-8 escape).
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request: malformed percent-encoding' }));
    return true;
  }
  if (!rel) rel = 'index.html';
  const segs = rel.split(/[\\/]+/);
  // Defense in depth: refuse dotfiles (no .env, no .git/...) and traversal
  // outright, before the allowlist is even consulted.
  if (segs.some(s => s === '..' || s === '.' || s.startsWith('.'))) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return true;
  }
  const type = STATIC_FILES[rel];
  if (!type) return false;   // not on the allowlist → fall through to 404
  const abs = path.resolve(__dirname, rel);
  // Final containment guard: resolved path must live under __dirname.
  if (!abs.startsWith(__dirname + path.sep) && abs !== __dirname) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return true;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', path: rel }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
  return true;
}

// ── MAIN SERVER ───────────────────────────────────────────────────────────────
let localCalculator;
function handleRequest(req, res) {
  if (!gateRequest(req, res)) return;

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const reqPath = url.pathname;

  if (reqPath === '/pob2-calculator' || reqPath === '/pob2-calculate' || reqPath === '/pob2-optimize') {
    localCalculator ||= require('./poe2forge-calc').createCalculator({port:PORT});
    localCalculator.handle(req,res,reqPath);
    return;
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${reqPath}`);

  // GET /health
  if (req.method === 'GET' && reqPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      proxy: `POE2Forge v${APP_VERSION}`,
      port: PORT,
      gggTraffic: false, // this server never contacts pathofexile.com
      pob2Configured: Boolean(process.env.POB2_PATH),
      priceSource: PRICE_API_HOST,
      priceCacheEntries: priceCache.size,
      // Legacy keys kept so older frontends fail soft instead of erroring:
      posessidConfigured: false,
      posessidValid: false,
      accountConfigured: false,
      tradeLog: false,
    }));
    return;
  }

  // POST /trade-link — build an official-trade-site deep link (no GGG traffic)
  if (req.method === 'POST' && reqPath === '/trade-link') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { handleTradeLink(JSON.parse(body || '{}'), res); }
      catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON body' })); }
    });
    return;
  }

  // GET /prices/* — poe2scout public economy API passthrough (cached)
  const pricesMatch = reqPath.match(/^\/prices\/(.+)$/);
  if (req.method === 'GET' && pricesMatch) {
    const sub = pricesMatch[1] + (url.search || '');
    return handlePrices(sub, res);
  }

  // GET /pob2-status — PoB2 bridge config check
  if (req.method === 'GET' && reqPath === '/pob2-status') {
    return handlePob2Status(res);
  }

  // POST /pob2-launch — spawn PoB2 from POB2_PATH. Launching a desktop
  // process is the server's most sensitive action, so beyond gateRequest it
  // REQUIRES a trusted browser Origin (untrusted ones were already 403'd):
  // an Origin-less POST from anything else can never trigger it.
  if (req.method === 'POST' && reqPath === '/pob2-launch') {
    if (req.headers.origin === undefined) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'pob2-launch requires a trusted browser Origin' }));
    }
    return handlePob2Launch(res);
  }

  // ── Retired routes (v2.x) ─────────────────────────────────────────────────
  // These previously forwarded to pathofexile.com endpoints outside GGG's
  // documented developer API. Removed in v3.0 for ToS compliance. Return 410
  // with a pointer so any stale frontend shows a clear message, not a hang.
  const retired = ['/leagues', '/stats', '/known-stats', '/characters', '/smart-search']
    .some(r => reqPath === r) || /^\/(character|search|fetch)\//.test(reqPath);
  if (retired) {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Route retired in v3.0 (ToS compliance): this app no longer calls undocumented pathofexile.com endpoints.',
      see: 'README.md#compliance',
      alternatives: {
        upgrades: 'POST /trade-link → opens the official trade site',
        characters: 'PoB2 bridge (GET /pob2-status, POST /pob2-launch)',
        prices: 'GET /prices/* (poe2scout public API)',
      },
    }));
  }

  // Static-file fall-through — GET requests whose extension is in
  // STATIC_MIME get served from __dirname. Anything else falls to the 404.
  if (req.method === 'GET' && serveStatic(reqPath, res)) return;

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Unknown route', path: reqPath }));
}

// One malformed request (bad percent-encoding, an unparsable URL) must cost
// that request a 400 — never the process. Whatever handleRequest throws
// synchronously is contained here; /health keeps answering afterwards.
const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch {
    if (!res.headersSent) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║      POE2 FORGE — Local App Server v3.0      ║');
  console.log(`║       Running on http://localhost:${PORT}       ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Zero pathofexile.com traffic from this      ║');
  console.log('║  process. Loopback (127.0.0.1) only.         ║');
  console.log('║  See README.md → Compliance.                 ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Routes:                                     ║');
  console.log('║  GET  /health           — server status      ║');
  console.log('║  POST /trade-link       — official-site URL  ║');
  console.log('║  GET  /prices/*         — poe2scout passthru ║');
  console.log('║  GET  /pob2-status      — PoB2 bridge config ║');
  console.log('║  POST /pob2-launch      — spawn PoB2 desktop ║');
  console.log('║  GET  /<file>           — app files only     ║');
  console.log('║                           (exact allowlist)  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`POB2_PATH: ${process.env.POB2_PATH || 'not set (PoB2 bridge auto-launch disabled)'}`);
  if (RETIRED_ENV_KEYS.length) {
    console.log('');
    console.log(`NOTICE: .env contains ${RETIRED_ENV_KEYS.join(' and ')} — these are no`);
    console.log('longer read by Forge (v3.0 removed all pathofexile.com traffic).');
    console.log('You can delete them from .env. If a trade_log.sqlite file exists');
    console.log('from v2.x, it is no longer written to and can be deleted as well.');
  }
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Kill existing process first.`);
  } else {
    console.error('Server error:', e);
  }
});
