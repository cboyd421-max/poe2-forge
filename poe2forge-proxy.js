/**
 * POE2 Forge — Trade API Proxy Server
 * Runs locally via Claude Code. Forwards requests to GGG trade API
 * with your session cookie, bypassing browser CORS restrictions.
 *
 * Usage: node poe2forge-proxy.js
 * Runs on: http://localhost:3001
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

// Load .env file if present
try {
  const envPath = path.join(__dirname, '.env');
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.trim().split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch {}

// ── CONFIG ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const POESESSID = process.env.POESESSID || '';
// POE_ACCOUNT includes the discriminator, e.g. "Keep_it_55th#5010".
// Required by /character-window/get-characters when fetching by public profile
// — the discriminator-less form returns 403.
const POE_ACCOUNT = process.env.POE_ACCOUNT || '';
const USER_AGENT = 'POE2Forge/2.3 BuildOptimizer (contact: cboyd421@gmail.com)';
const GGG_HOST = 'www.pathofexile.com';
const REALM = 'poe2';
const TRADE_LOG_PATH = path.join(__dirname, 'trade_log.sqlite');

// ── AUTH ABSTRACTION ────────────────────────────────────────────────────────
// Phase 1 uses POESESSID. When GGG OAuth approval lands, swap the impl behind
// this function — callers never have to change.
function getAuthHeaders() {
  return { 'Cookie': `POESESSID=${POESESSID}` };
}

// ── TRADE LOGGING (SQLite, for Phase 10 market-intelligence ingest) ─────────
let db = null;
try {
  db = new DatabaseSync(TRADE_LOG_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      league TEXT NOT NULL,
      slot TEXT,
      query_hash TEXT,
      response_summary TEXT,
      item_count INTEGER,
      min_price REAL,
      median_price REAL,
      price_currency TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trade_log_league_ts ON trade_log(league, timestamp);
  `);
  console.log(`[trade-log] ready: ${TRADE_LOG_PATH}`);
} catch (e) {
  console.error('[trade-log] init failed (logging disabled):', e.message);
  db = null;
}

function hashQuery(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function summarizePrices(items) {
  const priced = items
    .map(it => ({ amount: it?.listing?.price?.amount, currency: it?.listing?.price?.currency }))
    .filter(p => typeof p.amount === 'number' && p.currency);
  if (!priced.length) return { item_count: items.length, min_price: null, median_price: null, price_currency: null };
  const bucket = {};
  for (const p of priced) (bucket[p.currency] ||= []).push(p.amount);
  const dominant = Object.entries(bucket).sort((a, b) => b[1].length - a[1].length)[0];
  const amounts = dominant[1].slice().sort((a, b) => a - b);
  const median = amounts.length % 2 ? amounts[(amounts.length - 1) / 2] : (amounts[amounts.length/2 - 1] + amounts[amounts.length/2]) / 2;
  return { item_count: items.length, min_price: amounts[0], median_price: median, price_currency: dominant[0] };
}

function logTradeSearch({ league, slot, query, items }) {
  if (!db) return;
  try {
    const summary = summarizePrices(items || []);
    const stmt = db.prepare(`
      INSERT INTO trade_log (timestamp, league, slot, query_hash, response_summary, item_count, min_price, median_price, price_currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      new Date().toISOString(),
      league || '',
      slot || null,
      hashQuery(query || {}),
      JSON.stringify({ total: items?.length || 0, currencies: Object.keys((items || []).reduce((acc, it) => { const c = it?.listing?.price?.currency; if (c) acc[c] = true; return acc; }, {})) }),
      summary.item_count,
      summary.min_price,
      summary.median_price,
      summary.price_currency
    );
  } catch (e) {
    console.error('[trade-log] write failed:', e.message);
  }
}

// Rate limiting — GGG enforces strict limits
// Max ~12 requests per 60 seconds on trade API
const RATE_LIMIT = { requests: 12, windowMs: 60000 };
const requestLog = [];

// ── CORS HEADERS ─────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── RATE LIMITER ─────────────────────────────────────────────────────────────
function isRateLimited() {
  const now = Date.now();
  while (requestLog.length && requestLog[0] < now - RATE_LIMIT.windowMs) {
    requestLog.shift();
  }
  if (requestLog.length >= RATE_LIMIT.requests) return true;
  requestLog.push(now);
  return false;
}

// ── GGG REQUEST FORWARDER ────────────────────────────────────────────────────
function forwardToGGG(method, path, body, callback, extraHeaders = {}) {
  const options = {
    hostname: GGG_HOST,
    port: 443,
    path: path,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Origin': 'https://www.pathofexile.com',
      'Referer': 'https://www.pathofexile.com/trade2',
      ...getAuthHeaders(),
      ...extraHeaders,
    }
  };

  const bodyStr = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  if (bodyStr != null) {
    options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        callback(null, JSON.parse(data), res.statusCode, res.headers);
      } catch (e) {
        callback(null, { raw: data }, res.statusCode, res.headers);
      }
    });
  });

  req.on('error', (e) => callback(e));

  if (bodyStr != null) req.write(bodyStr);
  req.end();
}

// ── WIKI MARKUP CLEANER ───────────────────────────────────────────────────────
function cleanWikiMarkup(text) {
  return text
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1');
}

// ── ROUTE HANDLERS ────────────────────────────────────────────────────────────

// GET /leagues — fetch available PoE2 leagues
function handleLeagues(res) {
  forwardToGGG('GET', '/api/trade2/data/leagues', null, (err, data, status) => {
    if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
}

// GET /stats — fetch available stat filters (mod IDs)
function handleStats(res) {
  forwardToGGG('GET', '/api/trade2/data/stats', null, (err, data, status) => {
    if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
}

// GET /known-stats — return a curated map of well-known stat IDs
function handleKnownStats(res) {
  const knownStats = {
    life:         { id: 'explicit.stat_3299347043', label: 'Maximum Life' },
    mana:         { id: 'explicit.stat_1050105434', label: 'Maximum Mana' },
    es:           { id: 'explicit.stat_1571891556', label: 'Maximum Energy Shield' },
    fireRes:      { id: 'explicit.stat_3372524247', label: 'Fire Resistance' },
    coldRes:      { id: 'explicit.stat_4220027924', label: 'Cold Resistance' },
    lightRes:     { id: 'explicit.stat_1671376347', label: 'Lightning Resistance' },
    chaosRes:     { id: 'explicit.stat_2923486259', label: 'Chaos Resistance' },
    allRes:       { id: 'explicit.stat_2901986750', label: 'All Elemental Resistances' },
    strength:     { id: 'explicit.stat_4080418644', label: 'Strength' },
    dexterity:    { id: 'explicit.stat_3261801346', label: 'Dexterity' },
    intelligence: { id: 'explicit.stat_328541901',  label: 'Intelligence' },
    flatPhys:     { id: 'explicit.stat_1940865751', label: 'Adds Physical Damage' },
    flatFire:     { id: 'explicit.stat_709508406',  label: 'Adds Fire Damage' },
    flatCold:     { id: 'explicit.stat_327541901',  label: 'Adds Cold Damage' },
    flatLight:    { id: 'explicit.stat_1754445556', label: 'Adds Lightning Damage' },
    critChance:   { id: 'explicit.stat_587431675',  label: 'Critical Strike Chance' },
    critMult:     { id: 'explicit.stat_3556462833', label: 'Critical Strike Multiplier' },
    attackSpeed:  { id: 'explicit.stat_210067635',  label: 'Attack Speed' },
    castSpeed:    { id: 'explicit.stat_2891184298', label: 'Cast Speed' },
    movementSpeed:{ id: 'explicit.stat_2176571093', label: 'Movement Speed' },
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(knownStats));
}

// POST /search/:league — search for items
function handleSearch(league, body, res) {
  if (isRateLimited()) {
    res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit reached. Wait 60s.' })); return;
  }
  forwardToGGG('POST', `/api/trade2/search/${league}`, body, (err, data, status) => {
    if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
    // Log search metadata — Phase 10 market-intelligence ingest.
    // No items here (just search IDs); /fetch returns the priced items.
    logTradeSearch({ league, slot: body?._slot, query: body?.query || body, items: [] });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
}

// GET /fetch/:hashes?query=:id&league=:league — fetch item details
function handleFetch(hashes, queryId, league, res) {
  if (isRateLimited()) {
    res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit reached. Wait 60s.' })); return;
  }
  const path = `/api/trade2/fetch/${hashes}?query=${queryId}&realm=poe2`;
  forwardToGGG('GET', path, null, (err, data, status) => {
    if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
}

// ── CHARACTER ENDPOINTS (public-profile route) ──────────────────────────────
// GGG's character-window/* endpoints work for any account whose "Hide
// characters tab" privacy setting is OFF, even without POESESSID — provided
// you pass accountName with the discriminator (e.g. Keep_it_55th#5010).
// Without the discriminator the endpoint returns 403 Forbidden code 6, which
// is what was stumping Phase 1 earlier in this session.
// POESESSID is still sent (in case GGG later requires it for private accounts
// or richer fields), but it isn't doing the auth work here.
function ggCharacterCall(subpath, params, callback) {
  const body = new URLSearchParams({
    realm: REALM,
    ...(POE_ACCOUNT ? { accountName: POE_ACCOUNT } : {}),
    ...params,
  }).toString();
  forwardToGGG(
    'POST',
    `/character-window/${subpath}`,
    body,
    callback,
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://www.pathofexile.com/account/view-profile',
    }
  );
}

// GET /characters — list this account's PoE2 characters
function handleCharacters(res) {
  if (!POE_ACCOUNT) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'POE_ACCOUNT not configured in .env (need accountName#discriminator, e.g. Keep_it_55th#5010)' }));
  }
  ggCharacterCall('get-characters', {}, (err, data, status) => {
    if (err) { res.writeHead(500); return res.end(JSON.stringify({ error: err.message })); }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
}

// GET /character/:name — full equipped items + passives for one character
function handleCharacter(name, res) {
  if (!POE_ACCOUNT) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'POE_ACCOUNT not configured in .env' }));
  }
  const itemsP = new Promise((resolve) => {
    ggCharacterCall('get-items', { character: name }, (err, data, status) =>
      resolve({ err, data, status }));
  });
  const passivesP = new Promise((resolve) => {
    ggCharacterCall('get-passive-skills', { character: name }, (err, data, status) =>
      resolve({ err, data, status }));
  });
  Promise.all([itemsP, passivesP]).then(([items, passives]) => {
    if (items.err) { res.writeHead(500); return res.end(JSON.stringify({ error: items.err.message })); }
    if (items.status >= 400) {
      res.writeHead(items.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'GGG character fetch failed', detail: items.data }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      character: items.data?.character || null,
      items: items.data?.items || [],
      passives: passives.status < 400 ? (passives.data || null) : null,
    }));
  });
}

// Lightweight reachability check for the character API. Returns true if we
// can list this account's characters (accountName + public-profile path).
function checkPosessidValid(callback) {
  if (!POE_ACCOUNT) return callback(false);
  ggCharacterCall('get-characters', {}, (err, data, status) => {
    if (err) return callback(false);
    callback(status >= 200 && status < 300 && Array.isArray(data));
  });
}

// POST /smart-search — candidate-pool finder (Phase A)
// New strategy: do NOT AND-stack stat needs. Pull a wide pool of
// equippable candidates per slot, ranked by GGG's built-in weight.
// All scoring + ranking happens client-side for transparency.
function handleSmartSearch(body, res) {
  const { league = 'Runes of Aldur', slot, stats = {}, budget, poolSize = 20 } = body;

  const query = buildCandidateQuery(slot, stats, budget);

  if (isRateLimited()) {
    res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit reached. Wait 60s.' })); return;
  }

  forwardToGGG('POST', `/api/trade2/search/${encodeURIComponent(league)}`, query, (err, searchData, status) => {
    if (err || !searchData.id) {
      res.writeHead(status || 500);
      res.end(JSON.stringify({ error: err?.message || 'Search failed', raw: searchData }));
      return;
    }

    const all = searchData.result || [];
    if (!all.length) {
      res.writeHead(200);
      res.end(JSON.stringify({ results: [], queryId: searchData.id, total: 0, slot }));
      return;
    }

    // Fetch up to poolSize items, batched in groups of 10 (API limit per /fetch call)
    const targetCount = Math.min(poolSize, all.length);
    const batches = [];
    for (let i = 0; i < targetCount; i += 10) {
      batches.push(all.slice(i, i + 10));
    }

    const fetchAll = async () => {
      const results = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        if (i > 0) await new Promise(r => setTimeout(r, 500)); // be polite to GGG
        if (isRateLimited()) {
          return { rateLimited: true, results };
        }
        const items = await new Promise((resolve) => {
          const hashes = batch.join(',');
          const fetchPath = `/api/trade2/fetch/${hashes}?query=${searchData.id}&realm=poe2`;
          forwardToGGG('GET', fetchPath, null, (err2, fetchData) => {
            if (err2) return resolve([]);
            resolve(fetchData.result || []);
          });
        });
        results.push(...items);
      }
      return { rateLimited: false, results };
    };

    fetchAll().then(({ rateLimited, results }) => {
      logTradeSearch({ league, slot, query, items: results });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        queryId: searchData.id,
        total: searchData.total,
        slot,
        rateLimited,
        fetched: results.length,
        results: results.map(parseItem).filter(Boolean)
      }));
    });
  });
}

// ── CANDIDATE QUERY BUILDER (Phase A) ────────────────────────────────────────
// Goal: pull a wide, well-ordered pool of items that the character could
// realistically wear. Equippability gating + price cap only — scoring is
// client-side. Use 'count' stat group to bias toward items with relevant mods
// without making any single mod a hard requirement.
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

  // Equippability: cap by character level if provided
  if (stats.level) {
    filters.req_filters = {
      filters: {
        lvl: { max: stats.level }
      }
    };
  }

  // Trade filters: priced listings, optional budget
  const tradeFilters = { sale_type: { option: 'priced' } };
  if (budget) {
    tradeFilters.price = { max: Number(budget), option: 'divine' };
  }
  filters.trade_filters = { filters: tradeFilters };

  // Build a 'count' stat group: "at least 1 of these mods" — biases toward
  // items with SOMETHING useful, without hard-requiring any single mod.
  // Uses PoE2 PSEUDO stat IDs where available — these aggregate across
  // implicit + explicit + hybrid mods, giving a much truer match.
  const relevantStatIds = [
    'pseudo.pseudo_total_life',                  // any source of Life
    'pseudo.pseudo_total_energy_shield',         // any source of ES
    'pseudo.pseudo_total_mana',                  // any source of Mana
    'pseudo.pseudo_total_fire_resistance',       // any source of Fire Res
    'pseudo.pseudo_total_cold_resistance',       // any source of Cold Res
    'pseudo.pseudo_total_lightning_resistance',  // any source of Lightning Res
    'pseudo.pseudo_total_chaos_resistance',      // any source of Chaos Res
    'pseudo.pseudo_total_all_elemental_resistances',  // "all res" mods
    'pseudo.pseudo_total_strength',              // any source of Str
    'pseudo.pseudo_total_intelligence',          // any source of Int
    'explicit.stat_3261801346',                  // Dexterity (no pseudo found)
    'explicit.stat_3981240776',                  // Spirit
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
    // Sort by relevance — GGG ranks by mod weight by default
    sort: { price: 'asc' }
  };
}

// Legacy buildSmartQuery kept for /search route backward compat — unused
function buildSmartQuery(slot, stats, budget) {
  return buildCandidateQuery(slot, stats, budget);
}

// ── PoB2 BRIDGE (v16) — workaround for PoE2 OAuth gating character API ──────
// PoB2 has an approved OAuth client and can pull PoE2 characters. We can't
// replicate that without our own approval, so we launch PoB2 here and let
// the user do the 5-click import inside its window. The resulting build
// code is read via clipboard back in the browser (Phase 2 decoder takes it
// from there).
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
  try {
    const child = spawn(pob2Path, [], {
      detached: true,
      stdio: 'ignore',
      // Launch from PoB2's own directory so it finds its data files.
      cwd: path.dirname(pob2Path),
    });
    child.unref();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'launched', pid: child.pid }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'spawn failed: ' + e.message }));
  }
}

// ── STATIC FILE SERVER (Phase 7C+) ───────────────────────────────────────────
// Serve project files (HTML, JSON, icons, PDF) from __dirname so the app
// works at http://localhost:3001/POE2Forge_v15.html — no second server
// needed. Whitelist-extension only; blocks .env + any dotfile + traversal.
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.pdf':  'application/pdf',
  '.webp': 'image/webp',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

// Returns true if a response was written (matched + handled). False = let the
// request fall through to the 404 handler so API misses still look like API
// misses, not "file not found".
function serveStatic(reqPath, res) {
  let rel = decodeURIComponent(reqPath.replace(/^\/+/, ''));
  if (!rel) rel = 'index.html';
  const segs = rel.split(/[\\/]+/);
  // Block dotfiles (no .env, no .git/...) and traversal.
  if (segs.some(s => s === '..' || s === '.' || s.startsWith('.'))) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return true;
  }
  const ext = path.extname(rel).toLowerCase();
  if (!STATIC_MIME[ext]) return false;   // unknown ext → not a static route
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
      'Content-Type': STATIC_MIME[ext],
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
  return true;
}

// ── ITEM PARSER ───────────────────────────────────────────────────────────────
function parseItem(raw) {
  if (!raw?.listing || !raw?.item) return null;
  const { listing, item } = raw;
  return {
    id: raw.id,
    name: item.name || item.typeLine,
    typeLine: item.typeLine,
    rarity: item.frameType === 0 ? 'normal' : item.frameType === 1 ? 'magic' : item.frameType === 2 ? 'rare' : item.frameType === 3 ? 'unique' : 'other',
    ilvl: item.ilvl,
    mods: [
      ...(item.implicitMods || []),
      ...(item.explicitMods || []),
    ].map(cleanWikiMarkup),
    price: listing.price ? `${listing.price.amount} ${listing.price.currency}` : 'unpriced',
    priceAmount: listing.price?.amount,
    priceCurrency: listing.price?.currency,
    seller: listing.account?.lastCharacterName || listing.account?.name,
    online: listing.account?.online !== undefined,
    whisper: listing.whisper,
    icon: item.icon,
  };
}

// ── MAIN SERVER ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);

  // GET /health
  if (req.method === 'GET' && path === '/health') {
    checkPosessidValid((valid) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        proxy: 'POE2Forge v2.3',
        port: PORT,
        posessidConfigured: Boolean(POESESSID),
        accountConfigured: Boolean(POE_ACCOUNT),
        // 'posessidValid' is a misnomer now that auth is by accountName public
        // profile — kept for v7 frontend compatibility. The actual signal:
        // "can we list this account's characters?"
        posessidValid: valid,
        tradeLog: Boolean(db),
        rateLimitRemaining: Math.max(0, RATE_LIMIT.requests - requestLog.length),
      }));
    });
    return;
  }

  // GET /characters
  if (req.method === 'GET' && path === '/characters') {
    return handleCharacters(res);
  }

  // GET /character/:name
  const characterMatch = path.match(/^\/character\/(.+)$/);
  if (req.method === 'GET' && characterMatch) {
    return handleCharacter(decodeURIComponent(characterMatch[1]), res);
  }

  // GET /leagues
  if (req.method === 'GET' && path === '/leagues') {
    return handleLeagues(res);
  }

  // GET /stats
  if (req.method === 'GET' && path === '/stats') {
    return handleStats(res);
  }

  // GET /known-stats
  if (req.method === 'GET' && path === '/known-stats') {
    return handleKnownStats(res);
  }

  // POST /search/:league
  const searchMatch = path.match(/^\/search\/(.+)$/);
  if (req.method === 'POST' && searchMatch) {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { handleSearch(decodeURIComponent(searchMatch[1]), JSON.parse(body), res); }
      catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON body' })); }
    });
    return;
  }

  // GET /fetch/:hashes
  const fetchMatch = path.match(/^\/fetch\/(.+)$/);
  if (req.method === 'GET' && fetchMatch) {
    const queryId = url.searchParams.get('query') || '';
    const league = url.searchParams.get('league') || 'Runes of Aldur';
    return handleFetch(fetchMatch[1], queryId, league, res);
  }

  // GET /pob2-status (v16 — PoB2 bridge)
  if (req.method === 'GET' && path === '/pob2-status') {
    return handlePob2Status(res);
  }

  // POST /pob2-launch (v16 — spawn PoB2 from POB2_PATH)
  if (req.method === 'POST' && path === '/pob2-launch') {
    return handlePob2Launch(res);
  }

  // POST /smart-search
  if (req.method === 'POST' && path === '/smart-search') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { handleSmartSearch(JSON.parse(body), res); }
      catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON body' })); }
    });
    return;
  }

  // Static-file fall-through (Phase 7C+) — GET requests whose extension is in
  // STATIC_MIME get served from __dirname. Anything else falls to the 404.
  if (req.method === 'GET' && serveStatic(path, res)) return;

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Unknown route', path }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       POE2 FORGE — Trade API Proxy v2.5      ║');
  console.log(`║       Running on http://localhost:${PORT}       ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Open the app:                               ║');
  console.log(`║   http://localhost:${PORT}/POE2Forge_v16.html   ║`);
  console.log('║  (or just http://localhost:' + PORT + '/ → redirects) ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  API routes:                                 ║');
  console.log('║  GET  /health           — health + auth      ║');
  console.log('║  GET  /leagues          — available leagues  ║');
  console.log('║  GET  /stats            — stat filter IDs    ║');
  console.log('║  GET  /known-stats      — curated stat map   ║');
  console.log('║  GET  /characters       — user character list║');
  console.log('║  GET  /character/:name  — items + passives   ║');
  console.log('║  POST /search/:league   — search items       ║');
  console.log('║  GET  /fetch/:hashes    — fetch item details ║');
  console.log('║  POST /smart-search     — build-aware search ║');
  console.log('║  GET  /pob2-status      — PoB2 bridge config ║');
  console.log('║  POST /pob2-launch      — spawn PoB2 desktop ║');
  console.log('║  GET  /<file>           — serves HTML/JS/    ║');
  console.log('║                           JSON/PDF/icons     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`POB2_PATH: ${process.env.POB2_PATH || 'not set (PoB2 bridge disabled)'}`);
  console.log(`POESESSID configured: ${POESESSID ? 'yes' : 'NO — set in .env'}`);
  console.log(`POE_ACCOUNT: ${POE_ACCOUNT || 'NOT SET — required for character endpoints'}`);
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Kill existing process first.`);
  } else {
    console.error('Server error:', e);
  }
});
