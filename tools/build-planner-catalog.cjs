// Regenerate the bundled ID map from downloaded, pinned upstream inputs.
// Usage: node tools/build-planner-catalog.cjs tree.json Gems.lua sources.json
// sources.json: {tree:{sha,message,date},gems:{sha,date}}. See README provenance.
// This script performs no network requests and executes no upstream Lua code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [treeFile, gemsFile, sourcesFile] = process.argv.slice(2);
if (!treeFile || !gemsFile || !sourcesFile) throw new Error('Expected tree JSON, Gems.lua, and sources JSON paths');
const treeRaw = fs.readFileSync(treeFile), gemRaw = fs.readFileSync(gemsFile);
const upstream = JSON.parse(fs.readFileSync(sourcesFile,'utf8').replace(/^\uFEFF/,''));
const tree = JSON.parse(treeRaw);
for (const source of [upstream.tree,upstream.gems]) if (!/^[a-f0-9]{40}$/.test(source.sha)) throw new Error('Expected a pinned upstream commit');
if (!/^0\.5(?:\.|$)/.test(upstream.tree.message)) throw new Error('Review PoB tree version compatibility before adopting a new series');
const nodes = {};
for (const [hash,n] of Object.entries({...tree.nodes,...tree.skillOverrides})) {
  if (typeof n.id === 'string') nodes[hash] = [n.id,n.name || n.id,!!n.classStartIndex || n.classStartIndex === 0 || /Start$/.test(n.id)];
}
const classes = tree.classes.map(c=>({name:c.name,overrides:c.overridePairs || {},ascendancies:c.ascendancies.filter(a=>a.name).map(a=>({id:a.id,name:a.name,overrides:a.overridePairs || {}}))}));
const gems = {};
for (const [,id,body] of gemRaw.toString().matchAll(/^\t\["([^"]+)"\] = \{\r?\n([\s\S]*?)^\t\},/gm)) {
  const field = key=>body.match(new RegExp('^\\t\\t'+key+' = "([^"]+)"','m'))?.[1];
  if (!field('name') || !field('gameId')) throw new Error('Incomplete gem '+id);
  gems[id] = {id:field('gameId'),name:field('name'),support:/\bsupport = true/.test(body),meta:/\bmeta = true/.test(body),skillId:field('grantedEffectId')};
}
if (Object.keys(nodes).length < 3000 || Object.keys(gems).length < 500) throw new Error('Unexpected catalog shape');
const sha256 = b=>crypto.createHash('sha256').update(b).digest('hex');
const treeSource = {sha:upstream.tree.sha,message:upstream.tree.message,date:upstream.tree.date};
const gemSource = {sha:upstream.gems.sha,date:upstream.gems.date};
const data = {version:upstream.tree.message,pobTreeVersions:['0_5'],sources:{tree:{...treeSource,url:`https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/${upstream.tree.sha}/data.json`,sha256:sha256(treeRaw)},gems:{...gemSource,url:`https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/${upstream.gems.sha}/src/Data/Gems.lua`,sha256:sha256(gemRaw)}},nodes,classes,gems};
fs.writeFileSync(path.resolve(__dirname,'../poe2forge-planner-data.json'),JSON.stringify(data)+'\n');
console.log(`Built ${data.version} map: ${Object.keys(nodes).length} passive IDs, ${Object.keys(gems).length} gem IDs`);
