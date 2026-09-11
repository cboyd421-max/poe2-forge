// Browser integration tests. Playwright is a test-only dependency; NODE_PATH
// may point at an existing installation. All requests stay on the fixture server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'POE2Forge_v17.html'), 'utf8');
const itemText = `Rarity: RARE
Original Crossbow
Twin Crossbow
Unique ID: synthetic-fixture
Item Level: 62
Quality: 20
Sockets: S S
Custom Future Header: preserved
Implicits: 1
{rune}Adds 2 to 4 Fire Damage
100% increased Physical Damage
+25 to Accuracy Rating
Corrupted`;
const replacement = itemText.replace('Original Crossbow','Candidate Crossbow').replace('100% increased','150% increased').replace('Quality: 20','Quality: 15');
const xml = `<?xml version="1.0"?><PathOfBuilding2>
<Build className="Mercenary" ascendClassName="Gemling Legionnaire" level="62" targetVersion="0_1"><PlayerStat stat="Life" value="1467"/><PlayerStat stat="CombinedDPS" value="200"/></Build>
<Tree activeSpec="2"><Spec treeVersion="0_5" nodes="1,2,3"><URL>https://example.invalid/tree</URL><Sockets><Socket nodeId="2" itemId="17"/></Sockets></Spec><Spec title="Alternate" treeVersion="0_5" nodes="4,5"/></Tree>
<Items activeItemSet="2" futureFlag="retain"><Item id="7" variant="3">${itemText}</Item><Item id="17">Rarity: NORMAL
Ruby
Implicits: 0</Item><Item id="21">Rarity: NORMAL
Charm
Implicits: 0</Item>
<ItemSet id="1" title="Original"><Slot name="Weapon 1" itemId="7"/><Slot name="Charm 1" itemId="21"/></ItemSet>
<ItemSet id="2" title="Selected"><Slot name="Weapon 1" itemId="7" itemPbURL="old" futureFlag="keep"/><Slot name="Weapon 1 Swap" itemId="7"/><Slot name="Charm 1" itemId="21"/><Slot name="Flask 1" itemId="17"/></ItemSet></Items>
<Skills activeSkillSet="1"><SkillSet id="1"><Skill slot="Weapon 1"><Gem nameSpec="Explosive Shot" skillId="example" level="12" quality="5" futureGemFlag="keep"/></Skill></SkillSet><SkillSet id="2"><Skill><Gem nameSpec="Other Skill" level="6"/></Skill></SkillSet></Skills>
<Config><Input name="futureSetting" string="preserve &amp; keep"/></Config><Notes>Unmapped notes &lt;keep&gt;</Notes><FutureSection><Unknown value="keep"/></FutureSection></PathOfBuilding2>`;
const encode = text => zlib.deflateSync(text).toString('base64url');
const originalCode = encode(xml), results = [];
let browser, server, base;
async function test(name, run) {
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept(dialog.type()==='prompt'?'Saved candidate':undefined));
  try {
    await page.goto(base+'/poe2-forge/POE2Forge_v17.html');
    await page.waitForFunction(() => typeof encodePobCode === 'function');
    await run(page); assert.deepEqual(errors,[]); results.push({name,status:'PASS'});
  } catch(error) { results.push({name,status:'FAIL',error:error.stack}); }
  finally { await context.close(); }
}
async function importCode(page, code=originalCode) {
  await page.evaluate(async code => {setCurrentBuild(mapPobToBuild(parsePobXml(await decodePobCode(code)),code));switchTab('optimizer');},code);
}
async function exportBuild(page) {return page.evaluate(() => encodePobCode(currentBuild));}
async function modifyWeapon(page) {
  await page.evaluate(() => {currentBuild.gear.weapon.mods=currentBuild.gear.weapon.mods.map(mod=>mod.replace('100% increased','150% increased'));markBuildEdited();setCurrentBuild(currentBuild);});
}
async function summary(page,text) {
  return page.evaluate(text => {
    const d=new DOMParser().parseFromString(text,'text/xml'), s=new XMLSerializer(), items=d.querySelector('Items');
    const selected=items.querySelector('ItemSet[id="2"]'), slot=selected.querySelector('Slot[name="Weapon 1"]'), id=slot.getAttribute('itemId');
    const newItem=[...items.querySelectorAll(':scope > Item')].find(item=>item.getAttribute('id')===id);
    return {
      sections:['Tree','Skills','Config','Notes','FutureSection'].map(name=>s.serializeToString(d.querySelector(name))),
      inactive:s.serializeToString(items.querySelector('ItemSet[id="1"]')), originalItem:s.serializeToString(items.querySelector('Item[id="7"]')),
      id, raw:newItem?.textContent, variant:newItem?.getAttribute('variant'), futureSlot:slot.getAttribute('futureFlag'),
      swap:selected.querySelector('Slot[name="Weapon 1 Swap"]').getAttribute('itemId'), stats:d.querySelectorAll('PlayerStat').length,
    };
  },text);
}
(async()=>{
  server=http.createServer((req,res)=>{
    const rel=new URL(req.url,'http://local').pathname.replace(/^\/poe2-forge\//,'');
    if(!/^[\w.-]+$/.test(rel)&&!/^icons\/[\w.-]+$/.test(rel)){res.writeHead(404).end();return;}
    const file=path.join(root,rel);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':rel.endsWith('.html')?'text/html':rel.endsWith('.js')?'text/javascript':rel.endsWith('.json')?'application/json':'image/webp'});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});
  await test('Original full build survives storage reload byte-for-byte',async p=>{
    await importCode(p);await p.reload();assert.equal((await exportBuild(p)).code,originalCode);
  });
  await test('Gear export changes active equipment while preserving unmapped sections and other sets',async p=>{
    await importCode(p);await modifyWeapon(p);const result=await exportBuild(p);
    assert.equal(result.mode,'gear-edited');assert.deepEqual(result.changedSlots,['Weapon 1']);
    const before=await summary(p,xml),after=await summary(p,result.xml);
    for(const key of ['sections','inactive','originalItem','futureSlot','swap'])assert.deepEqual(after[key],before[key],key);
    assert.equal(after.id,'22');assert.equal(after.variant,'3');assert.equal(after.stats,0);
    for(const text of ['150% increased Physical Damage','Quality: 20','Custom Future Header: preserved','{rune}Adds 2 to 4 Fire Damage'])assert.ok(after.raw.includes(text),text);
    assert.equal(zlib.inflateSync(Buffer.from(result.code,'base64url')).toString(),result.xml);
  });
  await test('Edited gear persists across reload and imports through the actual decoder',async p=>{
    await importCode(p);await modifyWeapon(p);await p.reload();const result=await exportBuild(p);await importCode(p,result.code);
    assert.ok(await p.evaluate(()=>currentBuild.gear.weapon.mods.includes('150% increased Physical Damage')));assert.equal((await exportBuild(p)).code,result.code);
  });
  await test('Real editor loads and saves a candidate with its full properties',async p=>{
    await importCode(p);await p.getByRole('button',{name:'◯ EDIT MODE',exact:true}).click();await p.locator('.slot-tile[data-slot="weapon"]').click();
    await p.locator('#edit-pob-item').fill(replacement);await p.getByRole('button',{name:'LOAD ITEM TEXT',exact:true}).click();
    assert.equal(await p.locator('#edit-name').inputValue(),'Candidate Crossbow');
    await p.locator('#slot-editor-overlay').getByRole('button',{name:/Save/i}).click();await p.reload();
    const result=await exportBuild(p),after=await summary(p,result.xml);
    for(const text of ['Candidate Crossbow','Quality: 15','Sockets: S S'])assert.ok(after.raw.includes(text));assert.equal(after.variant,null);
    await p.getByRole('button',{name:'EXPORT TO POB2',exact:true}).click();assert.match(await p.locator('#export-body').innerText(),/Equipment edits included/i);assert.ok(await p.locator('#export-copy-btn').isEnabled());
  });
  await test('Clearing a slot preserves its source item and other item sets',async p=>{
    await importCode(p);await p.evaluate(()=>{currentBuild.gear.weapon=null;markBuildEdited();});
    const before=await summary(p,xml),after=await summary(p,(await exportBuild(p)).xml);
    assert.equal(after.id,'0');assert.equal(after.inactive,before.inactive);assert.equal(after.originalItem,before.originalItem);
  });
  await test('Complete item text fills an empty slot',async p=>{
    await importCode(p);await p.evaluate(text=>{const item=parsePobItemText(text);currentBuild.gear.offhand={...item,mods:[...item.implicits,...item.mods],sockets:[],pobItemText:text};markBuildEdited();},'Rarity: RARE\nTest Guard\nSplintered Tower Shield\nItem Level: 30\nImplicits: 0\n+40 to maximum Life');
    const result=await exportBuild(p);assert.deepEqual(result.changedSlots,['Weapon 2']);await importCode(p,result.code);assert.equal(await p.evaluate(()=>currentBuild.gear.offhand.name),'Test Guard');
  });
  await test('Unsupported skill/tree changes cannot expose a previous successful export',async p=>{
    for(const key of ['skills','tree']){
      await importCode(p);await p.evaluate(()=>openExportModal());
      await p.evaluate(key=>{if(key==='skills')currentBuild.skills[0].gemLevel++;else currentBuild.tree.url='https://poe2.com/new';markBuildEdited();},key);
      await p.evaluate(()=>openExportModal());assert.ok(await p.locator('#export-copy-btn').isDisabled());assert.match(await p.locator('#export-body').innerText(),/equipment edits only/);assert.equal(await p.evaluate(()=>lastExportedCode),null);
    }
  });
  await test('Missing original, unknown active set, and changed base without replacement fail clearly',async p=>{
    await importCode(p);await p.evaluate(()=>{currentBuild.originalPobCode=null;markBuildEdited();});await assert.rejects(exportBuild(p),/missing its original PoB2 code/);
    await importCode(p,encode(xml.replace('activeItemSet="2"','activeItemSet="99"')));await modifyWeapon(p);await assert.rejects(exportBuild(p),/active PoB2 equipment set/);
    await importCode(p);await p.evaluate(()=>{currentBuild.gear.weapon.typeLine='Different Crossbow';markBuildEdited();});await assert.rejects(exportBuild(p),/Paste PoB2 item text/);
  });
  await test('Unrelated decoder preview cannot replace the edited character or gallery entry',async p=>{
    await importCode(p);await modifyWeapon(p);await p.evaluate(async code=>{document.getElementById('pob-input').value=code;await decodePobInput();},encode(xml.replace('Mercenary','Ranger')));
    await p.evaluate(()=>saveCurrentToGallery());const saved=await p.evaluate(()=>loadSavedBuilds()[0]);assert.equal(saved.class,'Mercenary');assert.match(zlib.inflateSync(Buffer.from(saved.code,'base64url')).toString(),/150% increased Physical Damage/);
    await p.evaluate(()=>sendPobToOptimizer());assert.equal(await p.evaluate(()=>currentBuild.character.class),'Ranger');
  });
  await test('Gallery loads its own edited code as a complete source',async p=>{
    await importCode(p);await modifyWeapon(p);await p.evaluate(()=>saveCurrentToGallery());const saved=await p.evaluate(()=>loadSavedBuilds()[0]);
    const handler=/async function (\w+)\(id\) \{[\s\S]*?build\.character\.name = entry\.name/.exec(source.slice(source.indexOf('function renderGalleryCard')))?.[1];assert.ok(handler);
    await p.evaluate(({handler,id})=>window[handler](id),{handler,id:saved.id});assert.equal((await exportBuild(p)).code,saved.code);
  });
  await test('Closing or editing during an export prevents stale output',async p=>{
    for(const action of ['edit','close']){
      await importCode(p);await p.evaluate(()=>{window.realDecode=decodePobCode;decodePobCode=code=>new Promise(resolve=>{window.finishDecode=async()=>resolve(await realDecode(code));});window.pendingExport=openExportModal();});
      await p.evaluate(action=>{if(action==='edit'){markBuildEdited();setCurrentBuild(currentBuild);}else closeExportModal();},action);
      await p.evaluate(async()=>{await finishDecode();await pendingExport;decodePobCode=realDecode;});assert.equal(await p.evaluate(()=>lastExportedCode),null);assert.ok(await p.locator('#export-copy-btn').isDisabled());
    }
  });
  await test('No-op edits restore exact source; malformed source cannot enable export',async p=>{
    await importCode(p);await p.evaluate(()=>markBuildEdited());assert.equal((await exportBuild(p)).code,originalCode);
    await p.evaluate(()=>{currentBuild.originalPobCode='broken';});await p.evaluate(()=>openExportModal());assert.ok(await p.locator('#export-copy-btn').isDisabled());
  });
  await test('Duplicate modifiers and XML-special characters survive gear export',async p=>{
    await importCode(p,encode(xml.replace('{rune}Adds 2 to 4 Fire Damage','+25 to Accuracy Rating')));
    await p.evaluate(()=>{currentBuild.gear.weapon.name='Test <Crossbow> & Copy';currentBuild.gear.weapon.mods.push('+10 to maximum Life');markBuildEdited();});
    await importCode(p,(await exportBuild(p)).code);assert.equal(await p.evaluate(()=>currentBuild.gear.weapon.name),'Test <Crossbow> & Copy');assert.equal(await p.evaluate(()=>currentBuild.gear.weapon.mods.filter(mod=>mod==='+25 to Accuracy Rating').length),2);
  });
  await test('XML download contains the same validated edited build as the code',async p=>{
    await importCode(p);await modifyWeapon(p);await p.evaluate(()=>openExportModal());
    const code=await p.locator('#export-code').inputValue();
    const downloading=p.waitForEvent('download');await p.locator('#export-download-btn').click();const download=await downloading;
    assert.equal(fs.readFileSync(await download.path(),'utf8'),zlib.inflateSync(Buffer.from(code,'base64url')).toString());
    await p.evaluate(()=>markBuildEdited());assert.ok(await p.locator('#export-download-btn').isDisabled());
  });
  await test('Invalid replacement text and metadata in modifiers cannot be exported',async p=>{
    await importCode(p);
    await p.evaluate(()=>{currentBuild.gear.weapon.pobItemText='Rarity: RARE\nIncomplete';markBuildEdited();});
    await assert.rejects(exportBuild(p),/complete item text/);
    await importCode(p);await p.evaluate(()=>{currentBuild.gear.weapon.mods.push('Implicits: 0');markBuildEdited();});
    await assert.rejects(exportBuild(p),/properties must not be entered as modifiers/);
  });
  await test('Edited exports show unknown numbers as requiring recalculation on reimport',async p=>{
    await importCode(p);await modifyWeapon(p);await importCode(p,(await exportBuild(p)).code);
    assert.equal(await p.evaluate(()=>currentBuild.needsCalculation),true);assert.equal(await p.evaluate(()=>currentBuild.stats.fireRes),null);
    assert.ok(await p.getByRole('button',{name:'EXPORT TO POB2',exact:true}).isVisible());
  });
  await test('Numeric amulet edits retain embedded PoB2 modifier-roll selections',async p=>{
    const fixture=xml.replace('100% increased Physical Damage','+2 to Level of all Projectile Skills')
      .replace('Corrupted</Item>','Corrupted<ModRange id="2" range="0.5"/><ModRange id="3" range="1"/></Item>')
      .replaceAll('name="Weapon 1"','name="Amulet"');
    await importCode(p,encode(fixture));
    await p.evaluate(()=>{currentBuild.gear.amulet.mods=currentBuild.gear.amulet.mods.map(mod=>mod.replace('+2 to Level','+4 to Level'));markBuildEdited();setCurrentBuild(currentBuild);});
    await p.getByRole('button',{name:'EXPORT TO POB2',exact:true}).click();
    await p.waitForFunction(()=>document.getElementById('export-body').textContent !== 'Encoding…');
    assert.ok(await p.locator('#export-copy-btn').isEnabled(),await p.locator('#export-body').innerText());
    const exported=await exportBuild(p);
    const preserved=await p.evaluate(xml=>{
      const d=new DOMParser().parseFromString(xml,'text/xml');
      const id=d.querySelector('ItemSet[id="2"] Slot[name="Amulet"]').getAttribute('itemId');
      const item=[...d.querySelectorAll('Items > Item')].find(item=>item.getAttribute('id')===id);
      return {text:item.textContent,ranges:[...item.children].map(node=>[node.tagName,node.getAttribute('id'),node.getAttribute('range')])};
    },exported.xml);
    assert.match(preserved.text,/\+4 to Level of all Projectile Skills/);
    assert.deepEqual(preserved.ranges,[['ModRange','2','0.5'],['ModRange','3','1']]);
    await p.reload();assert.equal((await exportBuild(p)).code,exported.code);
    await p.evaluate(()=>{currentBuild.gear.amulet.mods.unshift('Adds 10 to 20 Fire Damage');markBuildEdited();});
    await assert.rejects(exportBuild(p),/modifier|inconsistent/);
  });
  console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.status==='PASS').length,results},null,2));
  process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();});
