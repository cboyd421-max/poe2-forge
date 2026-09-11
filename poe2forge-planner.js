/* GGG Build Planner v1 interchange. Game data belongs to Grinding Gear Games.
 * Format: https://www.pathofexile.com/developer/docs/game
 * A guide is independent of the full PoB2 character saved by Forge. */
'use strict';
const ForgePlanner = (() => {
  const MAX_BYTES = 1024 * 1024;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const uint = v => Number.isSafeInteger(v) && v >= 0 && v <= 4294967295;
  const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
  function validate(build) {
    const warnings = [];
    function text(v, path, required = false) {
      if (typeof v !== 'string' || (required && !v.trim())) fail(path, 'enter a '+(required ? 'nonempty ' : '')+'text value');
      if (v.length > 32768) fail(path, 'text exceeds 32,768 characters');
    }
    function array(v, path, fn) {
      if (!Array.isArray(v)) fail(path, 'expected a list');
      if (v.length > 10000) fail(path, 'too many entries (maximum 10,000)');
      v.forEach((entry, i) => fn(entry, `${path}[${i}]`));
    }
    function entry(v, path, kind) {
      if (kind !== 'slot' && typeof v === 'string') { text(v, path, true); return; }
      if (!object(v)) fail(path, 'expected an object'+(kind !== 'slot' ? ' or an ID string' : ''));
      const key = kind === 'slot' ? 'inventory_id' : 'id';
      text(v[key], path+'.'+key, true);
      if (own(v, 'level_interval')) {
        const iv = v.level_interval;
        if (!(uint(iv) || (Array.isArray(iv) && iv.length === 2 && iv.every(uint) && iv[0] <= iv[1]))) fail(path+'.level_interval', 'use a nonnegative whole number or an ordered pair such as [0, 100]');
      }
      if (own(v, 'additional_text')) text(v.additional_text, path+'.additional_text');
      const keys = [key, 'level_interval', 'additional_text'];
      if (kind === 'passive') {
        keys.push('weapon_set');
        if (own(v, 'weapon_set') && (!uint(v.weapon_set) || v.weapon_set > 2)) fail(path+'.weapon_set', 'use 0, 1, or 2');
      }
      if (kind === 'skill') {
        keys.push('support_skills');
        if (own(v, 'support_skills')) array(v.support_skills, path+'.support_skills', (s,p)=>entry(s,p,'support'));
      }
      if (kind === 'slot') {
        keys.push('slot_x','slot_y','unique_name');
        for (const key of ['slot_x','slot_y']) if (own(v,key) && !uint(v[key])) fail(path+'.'+key, 'use a nonnegative whole number');
        if (own(v,'unique_name')) text(v.unique_name,path+'.unique_name');
      }
      unknown(v, keys, path);
    }
    function unknown(v, keys, path) {
      const extra = Object.keys(v).filter(k=>!keys.includes(k));
      if (extra.length) warnings.push(`${path}: extra fields kept (${extra.join(', ')}). Their game support is unverified.`);
    }
    if (!object(build)) fail('Guide', 'expected one JSON object');
    text(build.name, 'name', true);
    for (const key of ['author','link','description','ascendancy']) if (own(build,key)) text(build[key],key);
    if (own(build,'passives')) array(build.passives,'passives',(v,p)=>entry(v,p,'passive'));
    if (own(build,'skills')) array(build.skills,'skills',(v,p)=>entry(v,p,'skill'));
    if (own(build,'inventory_slots')) array(build.inventory_slots,'inventory_slots',(v,p)=>entry(v,p,'slot'));
    unknown(build,['name','author','link','description','ascendancy','passives','skills','inventory_slots'],'Guide');
    return warnings;
  }
  function parse(raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) fail('File', 'maximum size is 1 MB');
    let build;
    try { build = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { fail('File', 'invalid JSON. Choose a .build file; PoB2 codes belong in PoB2 Decoder.'); }
    // Limit unknown extension nesting too; do not merge imported keys into app objects.
    let count = 0;
    function walk(v, depth) {
      if (++count > 100000 || depth > 32) fail('File', 'too large or deeply nested');
      if (v && typeof v === 'object') Object.values(v).forEach(child=>walk(child,depth+1));
    }
    walk(build,0);
    return {build, warnings:validate(build)};
  }
  function serialize(build) { validate(build); const raw = JSON.stringify(build,null,2)+'\n'; parse(raw); return raw; }
  function filename(name) {
    let stem = name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().replace(/[. ]+$/,'').slice(0,100).replace(/[. ]+$/,'') || 'Forge-guide';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = 'Forge-'+stem;
    return stem.replace(/\.build$/i,'')+'.build';
  }
  const slots = {
    'Weapon 1':'Weapon1', 'Weapon 2':'Offhand1', 'Weapon 1 Swap':'Weapon2', 'Weapon 2 Swap':'Offhand2',
    'Helmet':'Helm1', 'Body Armour':'BodyArmour1', 'Gloves':'Gloves1', 'Boots':'Boots1',
    'Amulet':'Amulet1', 'Belt':'Belt1', 'Ring 1':'Ring1', 'Ring 2':'Ring2',
  };
  // PoB2's generated game inventory mapping, pinned at ce566eac45ea8a86477f513c7ee65a1ebe60014e:
  // src/Data/InventorySlots.lua. All five belt positions share Flask1; coordinates
  // distinguish the two flasks from the three charms. Never collapse by ID alone.
  const beltPositions = {'Flask 1':0,'Flask 2':1,'Charm 1':2,'Charm 2':3,'Charm 3':4};
  function fromPob(xml, catalog, parseItem, name) {
    const doc = new DOMParser().parseFromString(xml,'text/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'PathOfBuilding2') fail('PoB2', 'a complete Path of Building 2 export is required');
    const omissions = [], notes = [];
    const buildEl = doc.querySelector('Build');
    if (!buildEl) fail('PoB2','missing character information');
    const out = {name: name || `${buildEl.getAttribute('className') || 'PoB2'} guide`, description:'Equipment references and skill recommendations from a PoB2 snapshot. Item values and gem levels below are guide notes; this file does not calculate stats or equip items.', passives:[], skills:[], inventory_slots:[]};
    function active(parent, tag, attr) {
      if (!parent) return null;
      const sets = [...parent.querySelectorAll(':scope > '+tag)];
      if (!sets.length) return parent;
      const id = parent.getAttribute(attr);
      const matches = id === null ? [sets[0]] : sets.filter(s=>s.getAttribute('id')===id);
      if (matches.length !== 1) fail('PoB2', 'could not identify the selected '+tag);
      return matches[0];
    }
    const characterClass = catalog.classes.find(c=>c.name===buildEl.getAttribute('className'));
    const ascendName = buildEl.getAttribute('ascendClassName');
    const ascendancy = characterClass?.ascendancies.find(a=>a.name===ascendName || a.id===ascendName);
    if (ascendancy) out.ascendancy = ascendancy.id;
    else if (ascendName && ascendName !== 'None') omissions.push(`Ascendancy not mapped: ${ascendName}.`);
    const tree = doc.querySelector('Tree');
    const specs = [...(tree?.querySelectorAll(':scope > Spec') || [])];
    const index = Number(tree?.getAttribute('activeSpec') || 1)-1;
    if (specs.length && (!Number.isInteger(index) || !specs[index])) fail('PoB2','could not identify the selected passive tree');
    const spec = specs[index];
    if (spec) {
      const version = spec.getAttribute('treeVersion');
      const supported = catalog.pobTreeVersions.includes(version);
      if (!supported) omissions.push(`Passive tree version ${version || '(missing)'} is not supported by the bundled ${catalog.version} map; no passives were translated.`);
      const csv = raw => (raw || '').split(',').map(s=>s.trim()).filter(Boolean);
      const hashes = csv(spec.getAttribute('nodes'));
      if (!spec.hasAttribute('nodes') && spec.querySelector('URL')) omissions.push('This passive tree is stored only as a URL; export it again from current PoB2 to include allocations.');
      const scopes = new Map();
      for (const n of [1,2]) for (const hash of csv(spec.querySelector('WeaponSet'+n)?.getAttribute('nodes'))) {
        if (!scopes.has(hash)) scopes.set(hash,[]);
        scopes.get(hash).push(n);
        if (!hashes.includes(hash)) hashes.push(hash);
      }
      const annotations = new Map();
      spec.querySelectorAll('Notes > Note').forEach(n=>annotations.set(n.getAttribute('nodeId'),n.textContent || n.getAttribute('text') || ''));
      spec.querySelectorAll('Overrides > AttributeOverride').forEach(n=>{
        for (const [attr, label] of [['strNodes','Strength'],['dexNodes','Dexterity'],['intNodes','Intelligence']]) {
          for (const hash of csv(n.getAttribute(attr))) annotations.set(hash,[annotations.get(hash),label+' is recommended.'].filter(Boolean).join('\n'));
        }
      });
      const overrides = {...characterClass?.overrides, ...ascendancy?.overrides};
      if (supported) for (const hash of new Set(hashes)) {
        const node = catalog.nodes[own(overrides,hash) ? overrides[hash] : hash];
        if (!node) { omissions.push(`Passive node not mapped: ${hash}.`); continue; }
        if (node[2]) continue; // Class/ascendancy start is implied by the chosen character.
        for (const scope of scopes.get(hash) || [0]) {
          const p = {id:node[0]};
          if (scope) p.weapon_set = scope;
          if (annotations.get(hash)) p.additional_text = annotations.get(hash);
          out.passives.push(p);
        }
      }
      if (spec.getAttribute('masteryEffects')) omissions.push('Passive mastery selections are not translated.');
      if (spec.querySelector('Sockets > Socket[itemId]:not([itemId="0"])')) omissions.push('Socketed passive jewels and their effects are not translated.');
      if (specs.length > 1) notes.push('Only the selected passive tree is included.');
    }
    const skillsEl = doc.querySelector('Skills');
    const selectedSkills = active(skillsEl,'SkillSet','activeSkillSet');
    if ((skillsEl?.querySelectorAll(':scope > SkillSet').length || 0) > 1) notes.push('Only the selected skill set is included.');
    let disabled = 0;
    for (const group of selectedSkills?.querySelectorAll(':scope > Skill') || []) {
      if (group.getAttribute('enabled') === 'false') { disabled++; continue; }
      const gems = [...group.querySelectorAll(':scope > Gem')].filter(g=>g.getAttribute('enabled') !== 'false');
      const resolved = [];
      for (const gem of gems) {
        const id = gem.getAttribute('gemId');
        // Use canonical IDs, never infer an ID from a display name or skill name.
        const data = id && (own(catalog.gems,id) ? catalog.gems[id] : Object.values(catalog.gems).find(g=>g.id===id));
        if (!data) { omissions.push(`Gem or granted skill not mapped: ${gem.getAttribute('nameSpec') || id || gem.getAttribute('skillId') || '(unnamed)'}.`); continue; }
        resolved.push({gem,data});
      }
      const mains = resolved.filter(g=>!g.data.support);
      if (!mains.length) { if (resolved.length) omissions.push('A support-only group has no mapped skill and was omitted.'); continue; }
      if (mains.length !== 1 || mains[0].data.meta) { omissions.push(`Unsupported meta or multi-skill group: ${mains.map(g=>g.data.name).join(', ')}. The whole group was omitted.`); continue; }
      const asSkill = ({gem,data}) => {
        const entry = {id:data.id};
        const level = gem.getAttribute('level'), quality = gem.getAttribute('quality');
        const info = [level && `Gem level in PoB2: ${level}`, quality && `Quality in PoB2: ${quality}%`].filter(Boolean);
        if (info.length) entry.additional_text = info.join(' · ');
        return entry;
      };
      const skill = asSkill(mains[0]);
      skill.support_skills = resolved.filter(g=>g.data.support).map(asSkill);
      out.skills.push(skill);
    }
    if (disabled) notes.push(`${disabled} disabled skill group(s) were left out.`);
    const itemsEl = doc.querySelector('Items');
    const itemSet = active(itemsEl,'ItemSet','activeItemSet');
    const items = new Map();
    for (const item of itemsEl?.querySelectorAll(':scope > Item') || []) {
      const id = item.getAttribute('id');
      if (items.has(id)) fail('PoB2','duplicate item IDs');
      items.set(id,item);
    }
    for (const slot of itemSet?.querySelectorAll(':scope > Slot') || []) {
      const id = slot.getAttribute('itemId');
      if (!id || id === '0') continue;
      const slotName = slot.getAttribute('name');
      const isBeltItem = own(beltPositions,slotName);
      const inventoryId = isBeltItem ? 'Flask1' : own(slots,slotName) ? slots[slotName] : null;
      if (!inventoryId) { omissions.push(`Equipment slot not translated: ${slotName}.`); continue; }
      const raw = items.get(id);
      if (!raw) { omissions.push(`Missing item for ${slotName}.`); continue; }
      // XML child metadata is not item text. Keep every direct text/CDATA line
      // for belt items: the display parser does not retain all flask properties.
      const itemText = [...raw.childNodes].filter(n=>n.nodeType===3 || n.nodeType===4).map(n=>n.nodeValue).join('').trim();
      const item = parseItem(itemText);
      const entry = {inventory_id:inventoryId};
      if (item.rarity === 'unique') entry.unique_name = item.name;
      if (isBeltItem) {
        entry.slot_x = beltPositions[slotName];
        entry.slot_y = 0;
        const reference = itemText.split(/\r?\n/)
          .filter(line=>!/^\s*(?:Unique ID|Implicits):/i.test(line))
          .map(line=>line.replace(/^LevelReq:\s*/i,'Requires Level: ')).join('\n');
        entry.additional_text = 'Reference item from PoB2:\n'+reference;
      } else {
        entry.additional_text = [item.name !== item.typeLine ? item.name : '', item.typeLine, 'Reference item from PoB2:', ...item.implicits, ...item.mods].filter(Boolean).join('\n');
      }
      out.inventory_slots.push(entry);
    }
    validate(out);
    return {build:out, omissions, notes, source:`PoB2 → GGG ${catalog.version}`};
  }
  return {MAX_BYTES, parse, validate, serialize, filename, fromPob};
})();
