const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const bases = JSON.parse(fs.readFileSync(path.join(root, 'poe2db-base-types.json')));
const uniques = JSON.parse(fs.readFileSync(path.join(root, 'poe2db-uniques.json')));
const html = fs.readFileSync(path.join(root, 'POE2Forge_v17.html'), 'utf8');
const context = vm.createContext({POE2DB_BASE_TYPES:bases, POE2DB_UNIQUES:uniques});
const start = html.indexOf('function lookupItemIcon(');
const end = html.indexOf('// Kept for back-compat', start);
assert.ok(start >= 0 && end > start, 'Find the actual frontend icon resolver');
vm.runInContext(html.slice(start, end), context);
const files = new Set(fs.readdirSync(path.join(root, 'icons')));
let references = 0;
for (const [name, item] of Object.entries({...bases, ...uniques})) {
  assert.match(item.icon, /^icons\/[\w.-]+\.webp$/, `Local artwork: ${name}`);
  assert.ok(files.has(path.basename(item.icon)), `Asset exists with exact filename case: ${item.icon}`);
  const bytes = fs.readFileSync(path.join(root, item.icon));
  assert.equal(bytes.toString('ascii',0,4), 'RIFF', item.icon);
  assert.equal(bytes.toString('ascii',8,12), 'WEBP', item.icon);
  assert.equal(bytes.readUInt32LE(4)+8, bytes.length, `Complete image: ${item.icon}`);
  references++;
}
const examples = [
  [{typeLine:'Twin Crossbow'}, '2HCrossbow05.webp'],
  [{typeLine:'Runeforged Hallowed Crown'}, 'HelmetIntStr04.webp'],
  [{typeLine:'Juggernaut Plate'}, 'BodyStr09.webp'],
  [{typeLine:'Aged Cuffs'}, 'GlovesIntStr02.webp'],
  [{typeLine:'Covered Sabatons'}, 'BootsStrDex04.webp'],
  [{name:"Meginord's Girdle",typeLine:'Rawhide Belt'}, 'MeginordsGirdle.webp'],
  [{typeLine:'Lapis Amulet'}, 'LapisAmulet.webp'],
  [{typeLine:'Ruby Ring'}, 'RubyRing.webp'],
  [{typeLine:'Prismatic Ring'}, 'PrismaticRing.webp'],
  [{typeLine:'Dizzying Transcendent Life Flask of the Endless'}, 'FlaskLife08.webp'],
  [{typeLine:'Hearty Transcendent Mana Flask of the Bottomless'}, 'FlaskMana08.webp'],
  [{typeLine:'Topaz Charm of the Constant'}, 'TopazCharm.webp'],
  [{typeLine:'Ruby Charm'}, 'RubyCharm.webp'],
  [{typeLine:'Silver Charm'}, 'SilverCharm.webp'],
];
for (const [item, filename] of examples) {
  assert.equal(context.lookupItemIcon(item), `icons/${filename}`, item.typeLine);
}
assert.equal(context.lookupItemIcon({typeLine:'Rawhide Belt'}), 'icons/Belt01.webp');
assert.equal(context.lookupItemIcon({typeLine:'Unknown Base'}), null);
console.log(JSON.stringify({status:'PASS',references,files:files.size-1,equippedExamples:examples.length,uniqueArtOverridesBase:true},null,2));
