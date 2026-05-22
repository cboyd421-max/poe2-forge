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
const USER_AGENT = 'POE2Forge/2.1 BuildOptimizer (contact: your@email.com)';
const GGG_HOST = 'www.pathofexile.com';

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
function forwardToGGG(method, path, body, callback) {
  const options = {
    hostname: GGG_HOST,
    port: 443,
    path: path,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `POESESSID=${POESESSID}`,
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Origin': 'https://www.pathofexile.com',
      'Referer': 'https://www.pathofexile.com/trade2',
    }
  };

  if (body) {
    const bodyStr = JSON.stringify(body);
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

  if (body) req.write(JSON.stringify(body));
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

// POST /smart-search — build-aware upgrade finder
function handleSmartSearch(body, res) {
  const { league = 'Runes of Aldur', slot, stats = {}, budget } = body;

  const query = buildSmartQuery(slot, stats, budget);

  if (isRateLimited()) {
    res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit reached. Wait 60s.' })); return;
  }

  forwardToGGG('POST', `/api/trade2/search/${encodeURIComponent(league)}`, query, (err, searchData, status) => {
    if (err || !searchData.id) {
      res.writeHead(status || 500);
      res.end(JSON.stringify({ error: err?.message || 'Search failed', raw: searchData }));
      return;
    }

    const hashes = (searchData.result || []).slice(0, 10).join(',');
    if (!hashes) {
      res.writeHead(200);
      res.end(JSON.stringify({ results: [], queryId: searchData.id, total: 0 }));
      return;
    }

    setTimeout(() => {
      if (isRateLimited()) {
        res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit hit on fetch.' })); return;
      }
      const fetchPath = `/api/trade2/fetch/${hashes}?query=${searchData.id}&realm=poe2`;
      forwardToGGG('GET', fetchPath, null, (err2, fetchData, status2) => {
        if (err2) { res.writeHead(500); res.end(JSON.stringify({ error: err2.message })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          queryId: searchData.id,
          total: searchData.total,
          slot,
          results: (fetchData.result || []).map(parseItem)
        }));
      });
    }, 500);
  });
}

// ── SMART QUERY BUILDER ───────────────────────────────────────────────────────
function buildSmartQuery(slot, stats, budget) {
  const { fireRes, coldRes, lightRes, life, es, int: intel } = stats;

  const needsFireRes = (fireRes || 0) < 75;
  const needsColdRes = (coldRes || 0) < 75;
  const needsLightRes = (lightRes || 0) < 75;
  const needsLife = (life || 0) < 3000;

  const filters = {};
  const statFilters = [];

  const typeMap = {
    helmet: 'armour.head',
    body: 'armour.chest',
    gloves: 'armour.gloves',
    boots: 'armour.boots',
    ring: 'accessory.ring',
    amulet: 'accessory.amulet',
    weapon: 'weapon',
    offhand: 'armour.shield',
    belt: 'accessory.belt',
  };

  if (slot && typeMap[slot]) {
    filters.type_filters = { filters: { category: { option: typeMap[slot] } } };
  }

  if (needsFireRes) {
    statFilters.push({ id: 'explicit.stat_3372524247', value: { min: 25 }, disabled: false });
  }
  if (needsColdRes) {
    statFilters.push({ id: 'explicit.stat_4220027924', value: { min: 25 }, disabled: false });
  }
  if (needsLightRes) {
    statFilters.push({ id: 'explicit.stat_1671376347', value: { min: 25 }, disabled: false });
  }
  if (needsLife) {
    statFilters.push({ id: 'explicit.stat_3299347043', value: { min: 60 }, disabled: false });
  }

  if (budget) {
    filters.trade_filters = {
      filters: {
        price: { max: budget, option: 'divine' }
      }
    };
  }

  filters.trade_filters = {
    ...(filters.trade_filters || {}),
    filters: {
      ...(filters.trade_filters?.filters || {}),
      sale_type: { option: 'priced' }
    }
  };

  return {
    query: {
      status: { option: 'online' },
      stats: statFilters.length ? [{ type: 'and', filters: statFilters }] : [],
      filters,
    },
    sort: { price: 'asc' }
  };
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', proxy: 'POE2Forge v2.1', port: PORT }));
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

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Unknown route', path }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       POE2 FORGE — Trade API Proxy           ║');
  console.log(`║       Running on http://localhost:${PORT}       ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Routes:                                     ║');
  console.log('║  GET  /health         — health check         ║');
  console.log('║  GET  /leagues        — available leagues    ║');
  console.log('║  GET  /stats          — stat filter IDs      ║');
  console.log('║  GET  /known-stats    — curated stat map     ║');
  console.log('║  POST /search/:league — search items         ║');
  console.log('║  GET  /fetch/:hashes  — fetch item details   ║');
  console.log('║  POST /smart-search   — build-aware search   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Kill existing process first.`);
  } else {
    console.error('Server error:', e);
  }
});
