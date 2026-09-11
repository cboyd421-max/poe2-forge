// Real-browser checks using synthetic guides and PoB2 snapshots only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
const catalog = require('../poe2forge-planner-data.json');
const passive = Object.entries(catalog.nodes).find(([,n])=>n[0]==='strength89');
const secondPassive = Object.entries(catalog.nodes).find(([,n])=>n[0]==='strength17');
const activeGem = 'Metadata/Items/Gems/SkillGemExplosiveGrenade';
const supportGem = Object.keys(catalog.gems).find(k=>catalog.gems[k].support);
const metaGem = Object.keys(catalog.gems).find(k=>catalog.gems[k].meta && !catalog.gems[k].support);
assert.ok(passive && secondPassive && catalog.gems[activeGem] && metaGem);
const xml = `<PathOfBuilding2><Build className="Mercenary" ascendClassName="Gemling Legionnaire" level="62"><PlayerStat stat="CombinedDPS" value="11000"/></Build>
<Tree activeSpec="2"><Spec treeVersion="0_5" nodes="99999999"/><Spec treeVersion="0_5" nodes="${passive[0]},${secondPassive[0]}"><WeaponSet1 nodes="${secondPassive[0]}"/><Overrides><AttributeOverride strNodes="${passive[0]}" dexNodes="" intNodes=""/></Overrides></Spec></Tree>
<Items activeItemSet="2"><Item id="1">Rarity: RARE
Fixture Amulet
Jade Amulet
Item Level: 62
Implicits: 0
+2 to Level of all Projectile Skills</Item><ItemSet id="1"><Slot name="Helmet" itemId="1"/></ItemSet><ItemSet id="2"><Slot name="Amulet" itemId="1"/></ItemSet></Items>
<Skills activeSkillSet="2"><SkillSet id="1"><Skill><Gem nameSpec="Wrong inactive skill" gemId="unknown"/></Skill></SkillSet><SkillSet id="2"><Skill enabled="true"><Gem nameSpec="Explosive Grenade" gemId="${activeGem}" level="12" quality="5"/><Gem nameSpec="Support" gemId="${supportGem}" level="1" quality="0"/></Skill><Skill enabled="false"><Gem nameSpec="Disabled" gemId="unknown"/></Skill></SkillSet></Skills><Config><Input name="preserve" string="yes"/></Config></PathOfBuilding2>`;
const guide = {name:'Mercenary guide',author:'Fixture author',link:'https://example.invalid/guide',description:'Keep this description',ascendancy:'Mercenary3',passives:['strength89',{id:'strength89',level_interval:[20,30],weapon_set:2,additional_text:'<gold>{Advice}'},{id:'strength89',level_interval:[31,100],weapon_set:2}],skills:[{id:activeGem,level_interval:0,support_skills:[supportGem,{id:supportGem,level_interval:[0,100],additional_text:'Support note'}]}],inventory_slots:[{inventory_id:'Ring1',slot_x:0,slot_y:0,level_interval:0,unique_name:"Kalandra's Touch",additional_text:'Gear note'},{inventory_id:'Ring1',slot_x:0,slot_y:0,level_interval:[31,100]}],future:{keep:['yes',{n:0}]}};
const encode = s=>zlib.deflateSync(s).toString('base64url');
const beltItems = [
  ['Flask 1','Rarity: MAGIC\nFixture Life Flask\nTranscendent Life Flask\nUnique ID: synthetic-item-id\nLevelReq: 50\nQuality: 20\nRecovers 920 Life over 3 Seconds\nConsumes 10 of 75 Charges on use\nImplicits: 0\n20% increased Recovery'],
  ['Flask 2','Rarity: MAGIC\nFixture Mana Flask\nTranscendent Mana Flask\nItem Level: 60\nQuality: 12\nRecovers 600 Mana over 4 Seconds\nConsumes 8 of 70 Charges on use\nImplicits: 0\n15% reduced Charges per use'],
  ['Charm 1','Rarity: MAGIC\nFixture Topaz Charm\nTopaz Charm\nLasts 4 Seconds\nConsumes 30 of 60 Charges on use\nImplicits: 0\n25% increased Duration'],
  ['Charm 2','Rarity: MAGIC\nAnother Topaz Charm\nTopaz Charm\nImplicits: 0\n35% increased Duration'],
  ['Charm 3',"Rarity: UNIQUE\nBeira's Anguish\nDousing Charm\nItem Level: 62\nImplicits: 0\n20% increased Charges gained"],
];
function beltXml(entries=beltItems) {
  return xml.replace('</Items>',entries.map(([,body],i)=>`<Item id="${10+i}">${body}<ModRange id="1" range="0.5"/></Item>`).join('')+'</Items>').replace('<ItemSet id="2"><Slot name="Amulet" itemId="1"/>','<ItemSet id="2"><Slot name="Amulet" itemId="1"/>'+entries.map(([slot],i)=>`<Slot name="${slot}" itemId="${10+i}"/>`).join(''));
}
const results=[];
let browser,server,base;
async function test(name,run) {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  const p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  try { await p.goto(base+'/poe2-forge/POE2Forge_v17.html');await p.evaluate(()=>{switchTab('theorycraft');switchSubtab('game-planner');});await run(p);assert.deepEqual(errors,[]);results.push({name,status:'PASS'}); }
  catch(error) {results.push({name,status:'FAIL',error:error.stack});}
  finally {await context.close();}
}
async function importFile(p,value=guide) {
  await p.locator('#planner-file').setInputFiles({name:'fixture.build',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await p.locator('#planner-workspace').waitFor({state:'visible'});
}
async function importPob(p,text=xml) {
  await p.evaluate(async code=>{setCurrentBuild(mapPobToBuild(parsePobXml(await decodePobCode(code)),code));},encode(text));
}
async function download(p) {
  const pending=p.waitForEvent('download');await p.locator('#planner-download').click();
  const d=await pending;return {name:d.suggestedFilename(),build:JSON.parse(fs.readFileSync(await d.path(),'utf8'))};
}
(async()=>{
  server=http.createServer((req,res)=>{
    const rel=new URL(req.url,'http://local').pathname.replace(/^\/poe2-forge\//,'');
    if(!/^[\w.-]+$/.test(rel)&&!/^icons\/[\w.-]+$/.test(rel)){res.writeHead(404).end();return;}
    const file=path.join(root,rel);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':rel.endsWith('.html')?'text/html':rel.endsWith('.css')?'text/css':rel.endsWith('.js')?'text/javascript':rel.endsWith('.json')?'application/json':'image/webp'});fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});
  await test('File picker and download preserve all guide fields, phases, zero values and extension fields',async p=>{
    await importFile(p);const result=await download(p);assert.deepEqual(result.build,guide);assert.equal(result.name,'Mercenary guide.build');assert.match(await p.locator('#planner-report').innerText(),/extra fields kept/);
  });
  await test('Guide import, metadata edits and reload never replace the Optimizer character',async p=>{
    await importPob(p);const before=await p.evaluate(()=>JSON.stringify(currentBuild));await importFile(p);
    await p.locator('#planner-name').fill('Renamed guide');await p.locator('#planner-description').fill('My updated notes');
    await p.reload();await p.evaluate(()=>{switchTab('theorycraft');switchSubtab('game-planner');});
    assert.equal(await p.evaluate(()=>JSON.stringify(currentBuild)),before);const d=await download(p);assert.equal(d.build.name,'Renamed guide');assert.equal(d.build.description,'My updated notes');assert.deepEqual(d.build.skills,guide.skills);
  });
  await test('Malformed input cannot replace a valid guide or enable an invalid download',async p=>{
    await importFile(p);const before=await p.evaluate(()=>JSON.stringify(plannerGuide));
    await p.locator('summary').filter({hasText:'Paste guide JSON'}).click();
    const bad=[[],{},null,{name:2},{name:'x',passives:[{id:'a',weapon_set:3}]},{name:'x',skills:[{id:'a',support_skills:[4]}]},{name:'x',inventory_slots:[{inventory_id:'Ring1',slot_x:-1}]},{name:'x',passives:[{id:'a',level_interval:[30,2]}]}];
    for(const value of bad) {await p.locator('#planner-paste').fill(JSON.stringify(value));await p.evaluate(()=>importPlannerText());assert.equal(await p.evaluate(()=>JSON.stringify(plannerGuide)),before);}
    await p.locator('#planner-name').fill('');assert.ok(await p.locator('#planner-download').isDisabled());
  });
  await test('Oversized and deeply nested files are rejected with a readable error',async p=>{
    await p.locator('#planner-file').setInputFiles({name:'large.build',mimeType:'application/json',buffer:Buffer.alloc(1024*1024+1,32)});assert.match(await p.locator('#planner-status').innerText(),/1 MB/);
    const error=await p.evaluate(()=>{try{ForgePlanner.parse('{"name":"x","future":'+'['.repeat(40)+'0'+']'.repeat(40)+'}');}catch(e){return e.message;}});assert.match(error,/deeply nested/);
  });
  await test('JSON edits require apply; invalid edits keep the last guide and prevent stale downloads',async p=>{
    await importFile(p);await p.locator('summary').filter({hasText:'Edit full guide JSON'}).click();
    await p.locator('#planner-json').fill('{broken');assert.ok(await p.locator('#planner-download').isDisabled());await p.getByRole('button',{name:'Apply JSON changes'}).click();assert.match(await p.locator('#planner-status').innerText(),/invalid JSON/);
    await p.locator('#planner-json').fill(JSON.stringify({...guide,name:'Applied'}));await p.getByRole('button',{name:'Apply JSON changes'}).click();assert.equal((await download(p)).build.name,'Applied');
  });
  await test('Untrusted guide text and prototype-like extension keys remain inert',async p=>{
    const hostile=JSON.parse('{"name":"<img src=x onerror=alert(1)>","description":"<script>alert(1)</script>","__proto__":{"polluted":true},"skills":[{"id":"<img src=x onerror=alert(2)>","additional_text":"<b onclick=alert(3)>text</b>"}]}');
    await importFile(p,hostile);assert.equal(await p.locator('#planner-preview img, #planner-preview script, #planner-preview [onclick]').count(),0);assert.equal(await p.evaluate(()=>({}).polluted),undefined);assert.deepEqual((await download(p)).build,hostile);
  });
  await test('Current PoB2 guide uses selected tree, skill set and equipment; maps game IDs and weapon scopes',async p=>{
    await importPob(p);await p.getByRole('button',{name:'Use current PoB2 build'}).click();await p.locator('#planner-workspace').waitFor();
    const d=(await download(p)).build;assert.equal(d.passives.length,2);assert.equal(d.passives[0].id,passive[1][0]);assert.match(d.passives[0].additional_text,/Strength/);assert.equal(d.passives[1].weapon_set,1);
    assert.equal(d.skills.length,1);assert.equal(d.skills[0].id,catalog.gems[activeGem].id);assert.equal(d.skills[0].support_skills[0].id,catalog.gems[supportGem].id);assert.equal(d.inventory_slots.length,1);assert.equal(d.inventory_slots[0].inventory_id,'Amulet1');assert.ok(d.ascendancy.startsWith('Mercenary'));assert.ok(!JSON.stringify(d).includes('Wrong inactive'));
  });
  await test('The tested +2 to +4 amulet edit appears in guide notes and leaves PoB2 export intact',async p=>{
    await importPob(p);await p.evaluate(()=>{currentBuild.gear.amulet.mods=['+4 to Level of all Projectile Skills'];markBuildEdited();setCurrentBuild(currentBuild);});
    await p.getByRole('button',{name:'Use current PoB2 build'}).click();await p.locator('#planner-workspace').waitFor();const d=(await download(p)).build;assert.match(d.inventory_slots[0].additional_text,/\+4 to Level/);
    const exported=await p.evaluate(()=>encodePobCode(currentBuild));assert.match(exported.xml,/\+4 to Level/);assert.match(exported.xml,/<Config>/);
  });
  await test('Unmapped nodes and unsupported meta gems require a partial download with durable notes',async p=>{
    const changed=xml.replace(`${passive[0]},${secondPassive[0]}`,`${passive[0]},99999999`).replace(activeGem,metaGem);
    await importPob(p,changed);await p.getByRole('button',{name:'Use current PoB2 build'}).click();await p.locator('#planner-workspace').waitFor();
    assert.ok(await p.locator('#planner-download').isDisabled());assert.match(await p.locator('#planner-report').innerText(),/99999999/);assert.match(await p.locator('#planner-report').innerText(),/meta/);
    await p.locator('#planner-partial').check();const d=await download(p);assert.match(d.name,/partial/);assert.match(d.build.description,/99999999/);assert.equal(d.build.skills.length,0);
    await p.reload();await p.evaluate(()=>{switchTab('theorycraft');switchSubtab('game-planner');});assert.ok(await p.locator('#planner-download').isDisabled());
  });
  await test('Unknown tree versions never map numeric IDs using a different version',async p=>{
    await importPob(p,xml.replaceAll('0_5','0_99'));await p.getByRole('button',{name:'Use current PoB2 build'}).click();await p.locator('#planner-workspace').waitFor();assert.equal(await p.evaluate(()=>plannerGuide.passives.length),0);assert.match(await p.locator('#planner-report').innerText(),/0_99/);
  });
  await test('An invalid selected set fails without replacing an existing guide',async p=>{
    await importFile(p);await importPob(p,xml.replace('activeSkillSet="2"','activeSkillSet="999"'));await p.getByRole('button',{name:'Use current PoB2 build'}).click();await p.waitForFunction(()=>document.getElementById('planner-status').classList.contains('error'));assert.match(await p.locator('#planner-status').innerText(),/selected SkillSet/);assert.equal(await p.evaluate(()=>plannerGuide.name),guide.name);
  });
  await test('An import made during generation wins over the stale asynchronous result',async p=>{
    await importPob(p);await p.evaluate(()=>{window.originalEncoder=encodePobCode;encodePobCode=b=>new Promise(resolve=>window.finishPlannerExport=async()=>resolve(await originalEncoder(b)));window.pendingGuide=createPlannerFromCurrent();});
    await importFile(p);await p.evaluate(async()=>{await finishPlannerExport();await pendingGuide;});assert.equal(await p.evaluate(()=>plannerGuide.name),guide.name);
  });
  await test('Windows-safe filenames and BOM input produce a reusable .build file',async p=>{
    const checks=await p.evaluate(()=>({name:ForgePlanner.filename('CON'),empty:ForgePlanner.filename('...'),safe:ForgePlanner.filename('../A:B?.build'),bom:ForgePlanner.parse('\uFEFF{"name":"BOM"}').build.name}));assert.deepEqual(checks,{name:'Forge-CON.build',empty:'Forge-guide.build',safe:'..AB.build',bom:'BOM'});
  });
  await test('Imported guide files work even when the optional ID catalog is unavailable',async p=>{
    await p.route('**/poe2forge-planner-data.json',r=>r.fulfill({status:404,body:'Missing'}));await importFile(p);assert.deepEqual((await download(p)).build,guide);
  });
  await test('The PoB2 export window opens Game Planner through an enabled action',async p=>{
    await importPob(p);await p.evaluate(()=>openExportModal());await p.getByRole('button',{name:'Game Planner (.build)',exact:true}).click();assert.ok(await p.locator('#subtab-game-planner').isVisible());assert.equal(await p.locator('#export-overlay').evaluate(e=>e.classList.contains('open')),false);
  });
  await test('Flasks and charms use five distinct positions and retain their full reference details',async p=>{
    await importPob(p,beltXml());await p.getByRole('button',{name:'Use current PoB2 build'}).click();await p.locator('#planner-workspace').waitFor();
    const d=(await download(p)).build, belt=d.inventory_slots.filter(s=>s.inventory_id==='Flask1');
    assert.deepEqual(belt.map(s=>[s.slot_x,s.slot_y]),[[0,0],[1,0],[2,0],[3,0],[4,0]]);
    for(const text of ['Fixture Life Flask','Transcendent Life Flask','Quality: 20','Requires Level: 50','Recovers 920 Life over 3 Seconds','Consumes 10 of 75 Charges on use','20% increased Recovery'])assert.ok(belt[0].additional_text.includes(text),text);
    for(const text of ['Fixture Mana Flask','Quality: 12','Recovers 600 Mana over 4 Seconds','Consumes 8 of 70 Charges on use','15% reduced Charges per use'])assert.ok(belt[1].additional_text.includes(text),text);
    assert.match(belt[2].additional_text,/25% increased Duration/);assert.match(belt[3].additional_text,/35% increased Duration/);assert.match(belt[4].additional_text,/20% increased Charges gained/);
    assert.ok(!JSON.stringify(belt).includes('synthetic-item-id'));assert.ok(!JSON.stringify(belt).includes('Implicits:'));
    assert.equal(belt[4].unique_name,"Beira's Anguish");assert.ok(!JSON.stringify(belt).includes('ModRange'));assert.equal(await p.locator('#planner-belt-preview .planner-entry').count(),5);
    for(const label of ['Life flask','Mana flask','Charm 1','Charm 2','Charm 3'])assert.match(await p.locator('#planner-belt-preview').innerText(),new RegExp(label));
    await importFile(p,d);await p.reload();await p.evaluate(()=>{switchTab('theorycraft');switchSubtab('game-planner');});assert.deepEqual((await download(p)).build,d);
  });
  await test('A missing flask or charm does not shift the remaining positions or use inactive equipment',async p=>{
    const selected=[beltItems[1],beltItems[3]];
    const source=beltXml(selected).replace('<ItemSet id="1"><Slot name="Helmet" itemId="1"/>','<ItemSet id="1"><Slot name="Helmet" itemId="1"/><Slot name="Flask 1" itemId="1"/>');
    await importPob(p,source);await p.getByRole('button',{name:'Use current PoB2 build'}).click();await p.locator('#planner-workspace').waitFor();const belt=(await download(p)).build.inventory_slots.filter(s=>s.inventory_id==='Flask1');assert.deepEqual(belt.map(s=>s.slot_x),[1,3]);assert.match(belt[0].additional_text,/Fixture Mana Flask/);assert.match(belt[1].additional_text,/Another Topaz Charm/);
  });
  await test('Unexpected belt slots remain explicit omissions instead of guessing positions',async p=>{
    await importPob(p,beltXml([['Flask 3',beltItems[0][1]]]));await p.getByRole('button',{name:'Use current PoB2 build'}).click();await p.locator('#planner-workspace').waitFor();assert.ok(await p.locator('#planner-download').isDisabled());assert.match(await p.locator('#planner-report').innerText(),/Flask 3/);assert.equal(await p.evaluate(()=>plannerGuide.inventory_slots.filter(s=>s.inventory_id==='Flask1').length),0);
  });
  await browser.close();await new Promise(r=>server.close(r));
  console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.status==='PASS').length,results},null,2));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
})().catch(async e=>{console.error(e);if(browser)await browser.close();server?.close();process.exitCode=1;});
