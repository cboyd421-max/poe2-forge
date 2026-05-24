#!/usr/bin/env node
/**
 * scrape-poe2db.js — PoE2DB datamine scraper for POE2 Forge Phase 5
 *
 * Runs entirely on Node built-ins (https + fs). Polite rate limiting via a
 * single global request queue with a configurable delay between hits.
 *
 * USAGE
 *   node scrape-poe2db.js                      # full run (skills + bases)
 *   node scrape-poe2db.js --skills-only
 *   node scrape-poe2db.js --bases-only
 *   node scrape-poe2db.js --verbose
 *   node scrape-poe2db.js --limit 20           # stop after N gems (debug)
 *
 * OUTPUT (alongside this script)
 *   poe2db-skills.json     — { [skillName]: { description, qualityBonus, altQuality, level, tags, page } }
 *   poe2db-base-types.json — { [typeLine]: { icon, slot, category } }
 *
 * WHEN 0.5 LAUNCHES
 *   PoE2DB updates over the 24–48h after patch ship. Re-run this scraper
 *   once they've ingested the new gem/item data. If selectors stop matching
 *   (PoE2DB occasionally adjusts markup), tweak the regex constants at the
 *   top of the file — they're flagged with the SELECTOR_ prefix.
 *
 * INTEGRATION
 *   v11+ POE2Forge_v<n>.html loads both JSON files at boot. Missing files
 *   degrade gracefully to empty-state UI. No code change needed to consume
 *   re-scraped data — drop the new JSONs next to the HTML and reload.
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

// ── CONFIG ─────────────────────────────────────────────────────────────────
const HOST = 'poe2db.tw';
const LANG = 'us';                          // English
const POLITE_DELAY_MS = 750;                // between requests
const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT = 'POE2Forge/0.5 Phase-5-scraper (contact: cboyd421@gmail.com)';
const OUT_DIR = __dirname;
const ICONS_DIR = path.join(OUT_DIR, 'icons');
const SKILLS_OUT = path.join(OUT_DIR, 'poe2db-skills.json');
const BASES_OUT = path.join(OUT_DIR, 'poe2db-base-types.json');
const UNIQUES_OUT = path.join(OUT_DIR, 'poe2db-uniques.json');
// PoE2DB's CDN blocks direct browser fetches without a poe2db Referer
// (HTTP 403). To make icons load reliably we download them server-side
// (where we can set Referer) and serve from a local /icons/ folder.
const REFERER = 'https://poe2db.tw/';

// CLI flags
const argv = new Set(process.argv.slice(2));
const VERBOSE = argv.has('--verbose');
const SKILLS_ONLY = argv.has('--skills-only');
const BASES_ONLY = argv.has('--bases-only');
const UNIQUES_ONLY = argv.has('--uniques-only');
const SKIP_ICONS = argv.has('--skip-icon-download');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) || Infinity : Infinity;
})();

// ── SELECTORS (regex, adjust here if PoE2DB markup changes post-0.5) ──────
// PoE2DB renders the page server-side enough that the gem index links + most
// per-page text are present in raw HTML. Where content is JS-rendered, we
// pull from the embedded data attributes.
const SELECTOR_SKILL_LINKS = /href="\/us\/([A-Za-z0-9_]+)"[^>]*data-i18n="SkillGems\|[^"]+/g;
// Fallback that catches anything that LOOKS like a skill-gem detail link
const SELECTOR_GEM_NAME = /<span class="lc">\s*([^<]+?)\s*<\/span>/;
const SELECTOR_TAGS = /Tag:\s*<[^>]*>\s*([^<]+?)\s*</i;
const SELECTOR_QUALITY_PER_LEVEL = /(?:Per\s+1%\s+Quality|Quality)[^<]*?<[^>]*>([^<]+)</i;
// 0.5 Advanced Thaumaturgy alt-quality strings — selectors PENDING actual
// post-launch DOM. PoE2DB historically labels these "Alternate Quality".
const SELECTOR_ALT_QUALITY = /Advanced\s+Thaumaturgy[^<]*<[^>]*>([^<]+)</i;
const SELECTOR_ALT_QUALITY_FALLBACK = /Alternate\s+Quality[^<]*<[^>]*>([^<]+)</i;
// Base-type icon — PoE2DB serves icons from its CDN. The actual item icon
// lives under /image/Art/2DItems/<Category>/Basetypes/<Name>.webp. There
// are many other images on each page (league banners, navigation icons,
// suggested-uniques thumbnails) — we want only the canonical base-type
// asset and prefer /Basetypes/ paths to avoid grabbing the unique-item art.
// IMPORTANT: case-SENSITIVE on the path prefix (PascalCase `Art/2DItems`).
// Page chrome uses lowercase paths like `art/2ditems/maps/endgamemaps/` —
// without case sensitivity we'd grab those by mistake.
const SELECTOR_BASE_ICON =
  /src="(https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/[^"]*?Basetypes\/[^"]+\.(?:webp|png))"/;
const SELECTOR_BASE_ICON_FALLBACK =
  /src="(https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/[^"]+\.(?:webp|png))"/;
// Skill gem icons sit at /image/Art/2DItems/Gems/<Name>.webp or similar.
const SELECTOR_SKILL_ICON =
  /src="(https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/Gems\/[^"]+\.(?:webp|png))"/;

// Collect ALL /2DItems/ image URLs from a page (case-sensitive), then pick
// the one whose filename most closely matches the slug. PoE2DB pages often
// show several related items in a grid — without this, we grab the first
// match which is frequently another item (e.g. PilgrimsImage for Temporalis).
const SELECTOR_ALL_ITEM_ICONS_G =
  /src="(https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/[^"]+\.(?:webp|png))"/g;

function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
}
function similarityScore(filename, slug) {
  // Strip path + extension, then tokenize the filename
  const base = filename.split('/').pop().replace(/\.(webp|png)$/i, '');
  const a = new Set(tokenize(base));
  const b = new Set(tokenize(slug));
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of b) if (a.has(t)) hits++;
  // Bonus if any token is contained as substring (catches "Hyrri" inside "HyrrisIre")
  for (const t of b) for (const x of a) if (x.includes(t) || t.includes(x)) hits += 0.25;
  return hits / Math.max(b.size, 1);
}

// Pick the best image from HTML that matches the slug, restricted to a path
// filter (e.g. /Uniques/ or /Basetypes/). Returns null if no acceptable match.
//
// `minScore` enforces a similarity floor. PoE2DB pages frequently embed
// related-items grids; if the page doesn't contain THIS item's actual icon
// (often the case for newer/JS-rendered uniques) we'd otherwise pick the
// first related-item icon and gaslight the user. Returning null is honest —
// the frontend falls back to base-type art or shows no icon.
function pickBestIcon(html, slug, opts = {}) {
  const { mustInclude = null, minScore = 0 } = opts;
  const matches = [...html.matchAll(SELECTOR_ALL_ITEM_ICONS_G)].map(m => m[1]);
  const filtered = mustInclude
    ? matches.filter(u => u.includes(mustInclude))
    : matches;
  if (!filtered.length) return null;
  // If exactly one candidate, take it — no ambiguity. PoE2DB sometimes
  // names icons after the BASE (ThawingUniqueCharm for Nascent Hope) so
  // slug-similarity wrongly rejects valid single-result pages.
  const unique = [...new Set(filtered)];
  if (unique.length === 1) return unique[0];
  // Multiple candidates → enforce similarity floor against slug
  let best = null, bestScore = -1;
  for (const url of unique) {
    const s = similarityScore(url, slug);
    if (s > bestScore) { best = url; bestScore = s; }
  }
  return bestScore >= minScore ? best : null;
}
const SELECTOR_BASE_CATEGORY = /data-i18n="ItemClasses\|([^|]+)\|Name"/;

// Curated skill gem URL list. The full list explodes post-launch (PoE2 ships
// ~200 skill gems). For now we seed with skills the project cares about —
// the cross-class S-rank pattern targets from Phase 4. Expand once 0.5 hits.
const SEED_SKILLS = [
  'Hollow_Form', 'Rolling_Slam', 'Whirling_Assault', 'Tempest_Flurry',
  'Ice_Strike', 'Storm_Wave', 'Flicker_Strike', 'Falling_Thunder',
  'Time_of_Need', 'Vaal_Pact', 'Cannibalism', 'Vitality', 'Mysticism',
  'Impurity', 'Poisonburst_Arrow', 'Lightning_Arrow', 'Bursting_Plague',
  'Detonate_Dead', 'Firestorm', 'Fireball', 'Ice_Nova', 'Frostbolt',
  'Combat_Frenzy', 'Brutality', 'Heightened_Curse', 'Despair', 'Enfeeble',
  'Cast_on_Critical', 'Rapid_Casting', 'Spell_Echo', 'Wildshards',
  'Concentrated_Area', 'Magnified_Area', 'Compressed_Duration',
];

// Unique item seed list. Uniques have their own distinctive art under
// /image/Art/2DItems/<Category>/Uniques/<Filename>.webp. We scrape each
// unique's PoE2DB page to discover the exact filename (which doesn't always
// match the display name — Hyrri's Ire = HyrrisIre.webp, etc.). Add new
// uniques as builds use them. URL slugs use spaces-as-underscores; the
// apostrophe in names is preserved unencoded in the URL (PoE2DB tolerates it).
const SEED_UNIQUES = [
  // From Jungroan's Warrior Titan caster (Phase 3 gallery)
  "Palm_of_the_Dreamer", "Veil_of_the_Night", "Rathpith_Globe",
  "The_Brass_Dome", "Headhunter", "Grip_of_Kulemak",
  // From Fubgun's Pathfinder Poisonburst (Phase 3 gallery)
  "Hyrri's_Ire", "Plaguefinger",
  // From Fubgun's Oracle Autobomb Deadeye (Phase 3 gallery)
  "Sine_Aequo",
  "Olroth's_Resolve", "Lavianga's_Spirits",
  "Nascent_Hope", "Rite_of_Passage", "The_Fall_of_the_Axe",
  // Common project-mentioned uniques worth pre-fetching (PoE2-existing only)
  "Atziri's_Acuity", "Astramentis", "Original_Sin",
  "Hand_of_Wisdom_and_Action",
  // SKIPPED — PoE2DB pages don't expose the actual icon in static HTML
  // (only show related items as Pilgrim's Image / Kulemak's Birth / Token
  // of Passage). Let the frontend fall back to base-type art. Revisit
  // post-0.5 when PoE2DB ingests new patch data.
  //   "Temporalis", "The_Unborn_Lich", "Grip_of_Kulemak", "Hollow_Form"
];

// Base-type seed list — slot mapping is hand-curated here since PoE2DB
// doesn't surface slot directly. Add new bases as they show up in builds.
// Initial set covers everything used by the Phase 3 gallery's curated PoBs
// (Jungroan Warrior Titan Caster + Fubgun Pathfinder/Deadeye). Expand as
// more creator builds get loaded.
const SEED_BASES = [
  // Amulets
  { name: 'Stellar_Amulet', slot: 'amulet' }, { name: 'Solar_Amulet', slot: 'amulet' },
  { name: 'Gold_Amulet', slot: 'amulet' }, { name: 'Lazuli_Amulet', slot: 'amulet' },
  { name: 'Crimson_Amulet', slot: 'amulet' }, { name: 'Bloodstone_Amulet', slot: 'amulet' },
  // Belts
  { name: 'Heavy_Belt', slot: 'belt' }, { name: 'Mind_Belt', slot: 'belt' },
  { name: 'Utility_Belt', slot: 'belt' }, { name: 'Linen_Belt', slot: 'belt' },
  // Rings
  { name: 'Lapis_Ring', slot: 'ring_l' }, { name: 'Iolite_Ring', slot: 'ring_l' },
  { name: 'Pearl_Ring', slot: 'ring_l' }, { name: 'Topaz_Ring', slot: 'ring_l' },
  { name: 'Gold_Ring', slot: 'ring_l' }, { name: 'Sapphire_Ring', slot: 'ring_l' },
  { name: 'Ruby_Ring', slot: 'ring_l' }, { name: 'Emerald_Ring', slot: 'ring_l' },
  { name: 'Amethyst_Ring', slot: 'ring_l' }, { name: 'Prismatic_Ring', slot: 'ring_l' },
  { name: 'Abyssal_Signet', slot: 'ring_l' },
  // Body armours
  { name: 'Vaal_Regalia', slot: 'body' }, { name: 'Astral_Plate', slot: 'body' },
  { name: 'Armoured_Vest', slot: 'body' }, { name: 'Champion_Cuirass', slot: 'body' },
  { name: 'Wyrmscale_Doublet', slot: 'body' }, { name: 'Crystalline_Robe', slot: 'body' },
  { name: 'Smuggler_Coat', slot: 'body' },
  // Helmets
  { name: 'Soul_Mask', slot: 'helmet' }, { name: 'Ancestral_Tiara', slot: 'helmet' },
  { name: 'Martyr_Crown', slot: 'helmet' }, { name: 'Pilgrim_Hood', slot: 'helmet' },
  { name: 'Heavy_Crown', slot: 'helmet' }, { name: 'Iron_Hat', slot: 'helmet' },
  // Gloves
  { name: 'Stealth_Gloves', slot: 'gloves' }, { name: 'Gauze_Wraps', slot: 'gloves' },
  { name: 'Massive_Mitts', slot: 'gloves' }, { name: 'Knit_Gloves', slot: 'gloves' },
  { name: 'Visceral_Bracers', slot: 'gloves' },
  // Boots
  { name: 'Stealth_Boots', slot: 'boots' }, { name: 'Charmed_Shoes', slot: 'boots' },
  { name: 'Tasalian_Greaves', slot: 'boots' }, { name: 'Vaal_Greaves', slot: 'boots' },
  { name: 'Pilgrim_Sandals', slot: 'boots' }, { name: 'Heelstrap_Boots', slot: 'boots' },
  // Weapons
  { name: 'Crude_Bow', slot: 'weapon' }, { name: 'Long_Bow', slot: 'weapon' },
  { name: 'Obliterator_Bow', slot: 'weapon' }, { name: 'Recurve_Bow', slot: 'weapon' },
  { name: 'Heavy_Crossbow', slot: 'weapon' }, { name: 'Tense_Crossbow', slot: 'weapon' },
  { name: 'Quarterstaff', slot: 'weapon' }, { name: 'Pact_Quarterstaff', slot: 'weapon' },
  { name: 'Shrine_Sceptre', slot: 'weapon' }, { name: 'Omen_Sceptre', slot: 'weapon' },
  { name: 'Iron_Sceptre', slot: 'weapon' }, { name: 'Attuned_Wand', slot: 'weapon' },
  // Offhands (quivers / foci / shields)
  { name: 'Visceral_Quiver', slot: 'offhand' }, { name: 'Heavy_Quiver', slot: 'offhand' },
  { name: 'Sacred_Focus', slot: 'offhand' }, { name: 'Crystal_Focus', slot: 'offhand' },
  { name: 'Ironwood_Buckler', slot: 'offhand' }, { name: 'Plumed_Round_Shield', slot: 'offhand' },
  // Extra bases from the Fubgun Oracle Autobomb Deadeye build
  { name: 'Maji_Talisman', slot: 'weapon' },
  { name: 'Silk_Robe', slot: 'body' },
  { name: 'Grand_Manchettes', slot: 'gloves' },
  { name: 'Wanderer_Shoes', slot: 'boots' },
  // Life/Mana flask base tiers (low → high). PoB stores the full identified
  // typeLine including magic affixes (e.g. "Transcendent Mana Flask of the
  // Doctor") so the lookup falls back to substring match against these.
  { name: 'Glass_Life_Flask',         slot: 'flask' },
  { name: 'Granite_Life_Flask',       slot: 'flask' },
  { name: 'Gargantuan_Life_Flask',    slot: 'flask' },
  { name: 'Ultimate_Life_Flask',      slot: 'flask' },
  { name: 'Transcendent_Life_Flask',  slot: 'flask' },
  { name: 'Glass_Mana_Flask',         slot: 'flask' },
  { name: 'Granite_Mana_Flask',       slot: 'flask' },
  { name: 'Gargantuan_Mana_Flask',    slot: 'flask' },
  { name: 'Ultimate_Mana_Flask',      slot: 'flask' },
  { name: 'Transcendent_Mana_Flask',  slot: 'flask' },
  // Charm bases
  { name: 'Thawing_Charm',     slot: 'charm' },
  { name: 'Golden_Charm',      slot: 'charm' },
  { name: 'Silver_Charm',      slot: 'charm' },
  { name: 'Stone_Charm',       slot: 'charm' },
  { name: 'Staunching_Charm',  slot: 'charm' },
  { name: 'Topaz_Charm',       slot: 'charm' },
  { name: 'Sapphire_Charm',    slot: 'charm' },
  { name: 'Ruby_Charm',        slot: 'charm' },
  { name: 'Emerald_Charm',     slot: 'charm' },
  { name: 'Bismuth_Charm',     slot: 'charm' },
  { name: 'Pyrolytic_Charm',   slot: 'charm' },
  { name: 'Quartz_Charm',      slot: 'charm' },
];

// ── HTTP CLIENT ────────────────────────────────────────────────────────────
let lastRequestAt = 0;
function rateLimit() {
  const wait = Math.max(0, POLITE_DELAY_MS - (Date.now() - lastRequestAt));
  return new Promise(resolve => setTimeout(() => { lastRequestAt = Date.now(); resolve(); }, wait));
}

function fetchText(urlPath) {
  return new Promise(async (resolve, reject) => {
    await rateLimit();
    const req = https.request({
      hostname: HOST,
      path: `/${LANG}/${urlPath}`,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchText(res.headers.location.replace(/^\/?us\//, '')));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} on /${LANG}/${urlPath}`));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// Download a CDN image binary and save under icons/. Returns the local
// path relative to the HTML file (e.g. "icons/Belt09.webp"). Caches by
// filename — re-running the scraper won't re-download icons already present.
function downloadIcon(cdnUrl) {
  return new Promise(async (resolve, reject) => {
    if (!cdnUrl) return resolve(null);
    if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });
    const fileName = cdnUrl.split('/').pop();
    const localPath = path.join(ICONS_DIR, fileName);
    const relPath = `icons/${fileName}`;
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
      log(`  (cached) ${relPath}`);
      return resolve(relPath);
    }
    await rateLimit();
    const url = new URL(cdnUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,  // critical — bypasses CDN hotlink 403
        'Accept': 'image/webp,image/png,image/*,*/*;q=0.8',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading ${cdnUrl}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(localPath, Buffer.concat(chunks));
        resolve(relPath);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

async function downloadIconSafe(cdnUrl) {
  if (!cdnUrl || SKIP_ICONS) return cdnUrl;
  try { return await downloadIcon(cdnUrl); }
  catch (e) {
    console.error(`  [warn] icon download failed for ${cdnUrl}: ${e.message}`);
    return cdnUrl; // fall back to CDN URL even if it might 403 in browser
  }
}

function log(...args) { if (VERBOSE) console.log('  ', ...args); }

// ── SKILL SCRAPING ─────────────────────────────────────────────────────────
async function scrapeSkillIndex() {
  log('Fetching /us/Skill_Gems index…');
  let html;
  try { html = await fetchText('Skill_Gems'); }
  catch (e) {
    console.error('  [warn] gem index unreachable:', e.message);
    return [];
  }
  const found = new Set();
  let m;
  // Re-create the regex each pass — global state on shared regex bites
  const re = new RegExp(SELECTOR_SKILL_LINKS.source, 'g');
  while ((m = re.exec(html)) !== null) found.add(m[1]);
  return [...found];
}

function extractSkill(html, slug) {
  const out = { slug, page: `https://${HOST}/${LANG}/${slug}` };
  let m;
  if ((m = html.match(SELECTOR_GEM_NAME))) out.name = m[1].trim();
  if ((m = html.match(SELECTOR_TAGS))) out.tags = m[1].trim().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  if ((m = html.match(SELECTOR_QUALITY_PER_LEVEL))) out.qualityBonus = m[1].trim();
  if ((m = html.match(SELECTOR_ALT_QUALITY)) || (m = html.match(SELECTOR_ALT_QUALITY_FALLBACK))) {
    out.altQuality = m[1].trim();
  }
  // Try gem-specific path first; fall back to generic 2DItems
  const iconMatch = html.match(SELECTOR_SKILL_ICON) || html.match(SELECTOR_BASE_ICON_FALLBACK);
  if (iconMatch) out.icon = iconMatch[1];
  return out;
}

async function scrapeSkills() {
  console.log('[skills] starting');
  const discovered = await scrapeSkillIndex();
  const slugs = [...new Set([...SEED_SKILLS, ...discovered])].slice(0, LIMIT);
  console.log(`[skills] resolved ${slugs.length} skill slugs (seed ${SEED_SKILLS.length} + discovered ${discovered.length})`);

  const result = {};
  let i = 0;
  for (const slug of slugs) {
    i++;
    try {
      log(`[${i}/${slugs.length}] ${slug}`);
      const html = await fetchText(slug);
      const skill = extractSkill(html, slug);
      // Key by display name when we have one, fall back to slug. Display
      // name is what PoB outputs in <Gem nameSpec="…"/>, so v11 can do a
      // direct lookup.
      const key = skill.name || slug.replace(/_/g, ' ');
      result[key] = skill;
    } catch (e) {
      console.error(`  [warn] ${slug}: ${e.message}`);
    }
  }
  return result;
}

// ── BASE-TYPE SCRAPING ─────────────────────────────────────────────────────
async function scrapeBases() {
  console.log('[bases] starting');
  const result = {};
  let i = 0;
  for (const { name: slug, slot } of SEED_BASES.slice(0, LIMIT)) {
    i++;
    try {
      log(`[${i}/${SEED_BASES.length}] ${slug}`);
      const html = await fetchText(slug);
      // Prefer /Basetypes/ with slug-match scoring; otherwise pick the
      // closest-named /2DItems/ image. Both passes are case-sensitive on
      // path to avoid grabbing lowercase /2dart/ page-chrome icons.
      const cdnIcon =
        pickBestIcon(html, slug, { mustInclude: '/Basetypes/' }) ||
        pickBestIcon(html, slug);
      const catMatch = html.match(SELECTOR_BASE_CATEGORY);
      const displayName = slug.replace(/_/g, ' ');
      const localIcon = await downloadIconSafe(cdnIcon);
      result[displayName] = {
        icon: localIcon,
        cdnIcon,
        slot,
        category: catMatch ? catMatch[1] : null,
        page: `https://${HOST}/${LANG}/${slug}`,
      };
    } catch (e) {
      console.error(`  [warn] ${slug}: ${e.message}`);
    }
  }
  return result;
}

// ── UNIQUE-ITEM SCRAPING ───────────────────────────────────────────────────
// Selector for unique-specific icons (under /Uniques/ instead of /Basetypes/).
const SELECTOR_UNIQUE_ICON =
  /src="(https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/[^"]*?Uniques\/[^"]+\.(webp|png))"/i;

async function scrapeUniques() {
  console.log('[uniques] starting');
  const result = {};
  const slugs = SEED_UNIQUES.slice(0, LIMIT);
  let i = 0;
  for (const slug of slugs) {
    i++;
    try {
      log(`[${i}/${slugs.length}] ${slug}`);
      const html = await fetchText(slug);
      // Uniques MUST match the /Uniques/ path AND share at least one token
      // with the slug. Without the floor, Temporalis grabs PilgrimsImage
      // (the page's only /Uniques/ image, a related item not the actual one).
      const cdnIcon = pickBestIcon(html, slug, { mustInclude: '/Uniques/', minScore: 0.25 });
      const nameMatch = html.match(SELECTOR_GEM_NAME);
      const displayName = (nameMatch ? nameMatch[1] : slug.replace(/_/g, ' ')).trim();
      if (!cdnIcon) {
        console.error(`  [skip] ${slug}: no /Uniques/ icon found (may be PoE1-only or wrong slug)`);
        continue;
      }
      const localIcon = await downloadIconSafe(cdnIcon);
      result[displayName] = {
        icon: localIcon,
        cdnIcon,
        page: `https://${HOST}/${LANG}/${slug}`,
      };
    } catch (e) {
      console.error(`  [warn] ${slug}: ${e.message}`);
    }
  }
  return result;
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`POE2 Forge — PoE2DB scraper`);
  console.log(`  Host: ${HOST}/${LANG}`);
  console.log(`  Delay: ${POLITE_DELAY_MS}ms between requests`);
  console.log(`  Icon download: ${SKIP_ICONS ? 'OFF' : 'ON (downloads to icons/)'}`);
  console.log('');

  const runSkills = !BASES_ONLY && !UNIQUES_ONLY;
  const runBases = !SKILLS_ONLY && !UNIQUES_ONLY;
  const runUniques = !SKILLS_ONLY && !BASES_ONLY;

  if (runSkills) {
    const skills = await scrapeSkills();
    fs.writeFileSync(SKILLS_OUT, JSON.stringify(skills, null, 2));
    const skillCount = Object.keys(skills).length;
    const altQualityCount = Object.values(skills).filter(s => s.altQuality).length;
    console.log(`[skills] wrote ${skillCount} entries to ${SKILLS_OUT}`);
    console.log(`[skills] alt-quality strings captured: ${altQualityCount}/${skillCount}`);
    if (altQualityCount === 0) {
      console.log('[skills] (zero alt-quality strings is expected pre-0.5 — re-run after launch + PoE2DB ingest)');
    }
  }

  if (runBases) {
    const bases = await scrapeBases();
    fs.writeFileSync(BASES_OUT, JSON.stringify(bases, null, 2));
    const baseCount = Object.keys(bases).length;
    const iconCount = Object.values(bases).filter(b => b.icon).length;
    console.log(`[bases] wrote ${baseCount} entries to ${BASES_OUT}`);
    console.log(`[bases] icons captured: ${iconCount}/${baseCount}`);
  }

  if (runUniques) {
    const uniques = await scrapeUniques();
    fs.writeFileSync(UNIQUES_OUT, JSON.stringify(uniques, null, 2));
    const uniqueCount = Object.keys(uniques).length;
    const iconCount = Object.values(uniques).filter(u => u.icon).length;
    console.log(`[uniques] wrote ${uniqueCount} entries to ${UNIQUES_OUT}`);
    console.log(`[uniques] icons captured: ${iconCount}/${uniqueCount}`);
  }

  console.log('');
  console.log('Done. v11+ frontend will pick up new data on next reload.');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
