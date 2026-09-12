// Real browser flows with synthetic PoB2 exports. No user builds or upstream calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const {chromium}=require('playwright');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),results=[];
const item=`Rarity: RARE\nWorkshop Fixture\nLapis Amulet\nItem Level: 62\nQuality: 20\nImplicits: 1\n+15 to Intelligence\n+2 to Level of all Projectile Skills\n+60 to maximum Life`;
const xml=`<PathOfBuilding2><Build className="Mercenary" ascendClassName="Gemling Legionnaire" level="62" mainSocketGroup="1"><PlayerStat stat="CombinedDPS" value="11000"/><PlayerStat stat="Life" value="1400"/><PlayerStat stat="ChaosResist" value="0"/></Build><Tree activeSpec="1"><Spec treeVersion="0_5" nodes="1,2"><Sockets><Socket nodeId="2" itemId="3"/></Sockets></Spec></Tree><Items activeItemSet="2"><Item id="1">${item}<ModRange id="2" range="0.5"/></Item><Item id="3">Rarity: NORMAL\nRuby\nImplicits: 0</Item><ItemSet id="1"><Slot name="Amulet" itemId="1"/></ItemSet><ItemSet id="2"><Slot name="Amulet" itemId="1"/><Slot name="Flask 1" itemId="3"/><Slot name="Charm 2" itemId="3"/></ItemSet></Items><Skills activeSkillSet="1"><SkillSet id="1"><Skill mainActiveSkill="1"><Gem nameSpec="Explosive Grenade" gemId="Metadata/Items/Gems/SkillGemExplosiveGrenade" level="14" quality="0"/></Skill></SkillSet></Skills><Config><Input name="enemyIsBoss" string="Pinnacle"/></Config><Notes>Keep my complete source</Notes><FutureSection value="preserve"/></PathOfBuilding2>`;
const encode=s=>zlib.deflateSync(s).toString('base64url');
const crossbowItem=`Rarity: RARE\nCrossbow Fixture\nTwin Crossbow\nItem Level: 65\nQuality: 20\nImplicits: 1\nLoads an additional bolt\n{enchant}{rune}36% increased Physical Damage\n130% increased Physical Damage\nAdds 9 to 202 Lightning Damage\n+2 to Level of all Projectile Skills\nAdds 28 to 55 Physical Damage\n+2 to Accuracy Rating`;
const crossbowXml=xml.replace('<Item id="3">',`<Item id="2">${crossbowItem}</Item><Item id="3">`).replace('<ItemSet id="2">','<ItemSet id="2"><Slot name="Weapon 1" itemId="2"/>');
const snapshot=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')));
let browser,server,base;
async function test(name,run){
  if(process.env.FORGE_TEST_FILTER&&!name.includes(process.env.FORGE_TEST_FILTER))return;
  const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  const p=await context.newPage(),errors=[];p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  try{await p.goto(base+'/poe2-forge/POE2Forge_v17.html');await p.waitForFunction(()=>!!window.ForgeWorkshop);await run(p);assert.deepEqual(errors,[]);results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.stack,pageErrors:errors});}finally{await context.close();console.error(results.at(-1).status+': '+name);}
}
async function setup(p,source=xml){
  await p.getByRole('button',{name:/^Theorycraft$/i}).click();await p.locator('#pob-input').fill(encode(source));await p.locator('#pob-decode-btn').click();await p.locator('#pob-send-btn').click();
  await p.getByRole('button',{name:'Build Workshop',exact:true}).click();await p.locator('#workshop-start').click();await p.locator('#workshop-workspace').waitFor();
}
async function edit(p,request='Change my amulet from +2 to +4 projectile skills'){
  await p.locator('#workshop-request').fill(request);await p.locator('#workshop-preview').click();await p.locator('#workshop-proposal').waitFor();await p.locator('#workshop-apply').click();
}
async function exportCandidate(p){await p.locator('#workshop-export').click();await p.locator('#workshop-export-panel').waitFor();return zlib.inflateSync(Buffer.from(await p.locator('#workshop-export-code').inputValue(),'base64url')).toString();}
function calculated(source,dps=14000){return source.replace(/<PlayerStat\b[^>]*\/>/g,'').replace(/<Build\b([^>]*)\/>/,'<Build$1></Build>').replace('</Build>',`<PlayerStat stat="CombinedDPS" value="${dps}"/><PlayerStat stat="Life" value="1400"/><PlayerStat stat="ChaosResist" value="0"/></Build>`);}
async function returnCode(p,source){await p.locator('#workshop-result-code').fill(encode(source));await p.locator('#workshop-check-result').click();}
async function rejected(p,pattern){await p.waitForFunction(()=>!document.getElementById('workshop-preview').disabled);assert.match(await p.locator('#workshop-status').innerText(),pattern);assert.ok(await p.locator('#workshop-apply').isDisabled());}
async function automatic(p,controls={}){
  await p.route('**/pob2-calculator',r=>r.fulfill({json:{available:true,version:'fixture',identity:'browser-fixture'}}));
  await p.route('**/pob2-calculate',async r=>{
    const body=r.request().postDataJSON();
    if(controls.fail)return r.fulfill({status:400,json:{error:'Fixture engine failure'}});
    const result={engine:{version:'fixture',identity:'browser-fixture'},inputHashes:{}};
    for(const side of ['baseline','candidate']){
      const code=body[side+'Code'],text=zlib.inflateSync(Buffer.from(code,'base64url')).toString(),value=Number([...text.matchAll(/\+(\d+) to Level of all Projectile Skills/g)].at(-1)?.[1]||2);
      result.inputHashes[side]=createHash('sha256').update(code.replace(/\s/g,'')).digest('hex');
      result[side]={stats:{CombinedDPS:10000+value*1000,Life:1400,EnergyShield:200,TotalEHP:3000},skill:'Explosive Grenade',skillGroup:body.skillGroup||1,skills:[{index:1,name:'Explosive Grenade'}]};
    }
    if(controls.wrongHash)result.inputHashes.candidate='wrong';
    if(controls.delay){controls.delay=false;await new Promise(resolve=>controls.release=resolve);}
    try{await r.fulfill({json:result});}catch{}
  });
  await p.locator('#workshop-calculate').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.native);
}
async function recommendations(p,controls={}){
  await p.route('**/pob2-optimize',async r=>{
    const body=r.request().postDataJSON();controls.body=body;
    const stats={CombinedDPS:12000,Life:1400,EnergyShield:200,TotalEHP:3000};
    const payload={engine:{version:'fixture',identity:'fixture'},inputHash:createHash('sha256').update(body.candidateCode.replace(/\s/g,'')).digest('hex'),stats,skill:'Explosive Grenade',skillGroup:body.skillGroup,level:body.level,keepDefences:body.keepDefences,evaluated:80,baseName:'Twin Crossbow',itemLevel:65,candidates:[{itemText:crossbowItem.replace('+2 to Level of all Projectile Skills','+5 to Level of all Projectile Skills'),requiredLevel:60,stats:{...stats,CombinedDPS:15000}}]};
    if(controls.wrongHash)payload.inputHash='wrong';if(controls.wrongLevel)payload.candidates[0].requiredLevel=70;if(controls.lowerDefences)payload.candidates[0].stats.Life=1300;
    if(controls.empty)payload.candidates=[];
    if(controls.delay)await new Promise(resolve=>controls.release=resolve);
    try{await r.fulfill({json:payload});}catch{}
  });
}
(async()=>{
  server=http.createServer((req,res)=>{const rel=new URL(req.url,'http://fixture').pathname.replace(/^\/poe2-forge\//,'');if(!/^[\w.-]+$/.test(rel)&&!/^icons\/[\w.-]+$/.test(rel)){res.writeHead(404).end();return;}const file=path.join(root,rel);if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp'};res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain'});fs.createReadStream(file).pipe(res);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});
  await test('Empty workspace guides import and cannot start without a build',async p=>{await p.getByRole('button',{name:'Build Workshop',exact:true}).click();assert.ok(await p.locator('#workshop-start').isDisabled());assert.ok(await p.locator('#workshop-empty').isVisible());});
  await test('Trade links work offline, preserve the build, and contain target stats and a price cap',async p=>{
    await setup(p,crossbowXml);const before=await snapshot(p);
    assert.equal(await p.locator('#workshop-trade-league').inputValue(),'Forbidden Rites');await p.locator('#workshop-trade-budget').fill('25');await p.locator('#workshop-trade-currency').selectOption('exalted');
    const link=p.locator('#workshop-trade-target'),url=new URL(await link.getAttribute('href')),q=JSON.parse(url.searchParams.get('q')).query;
    assert.equal(url.origin,'https://www.pathofexile.com');assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)),'Forbidden Rites');assert.equal(q.status.option,'available');assert.equal(q.type,'Twin Crossbow');assert.equal(q.filters.req_filters.filters.lvl.max,62);
    assert.deepEqual(q.filters.trade_filters.filters.price,{max:25,option:'exalted'});assert.equal(q.stats[0].filters.find(f=>f.id==='explicit.stat_1202301673').value.min,2);
    assert.equal(q.stats[0].filters.find(f=>f.id==='explicit.stat_1509134228').value.min,130);assert.match(await link.getAttribute('rel'),/noopener/);assert.equal(await link.getAttribute('target'),'_blank');
    await p.context().route('https://www.pathofexile.com/**',r=>r.fulfill({contentType:'text/html',body:'<p>Offline trade navigation fixture</p>'}));
    const [popup]=await Promise.all([p.waitForEvent('popup'),link.click()]);await popup.waitForLoadState();assert.equal(popup.url(),url.href);assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();
    assert.deepEqual(await snapshot(p),before);
  });
  await test('Trade preview, apply, undo and request edits always point to the correct crossbow',async p=>{
    await setup(p,crossbowXml);
    const projectile=async()=>JSON.parse(new URL(await p.locator('#workshop-trade-target').getAttribute('href')).searchParams.get('q')).query.stats[0].filters.find(f=>f.id==='explicit.stat_1202301673').value.min;
    await p.locator('#workshop-request').fill('Change crossbow +2 to +4 proj skills');await p.locator('#workshop-preview').click();await p.locator('#workshop-proposal').waitFor();
    assert.equal(await projectile(),4);assert.match(await p.locator('#workshop-trade-item').innerText(),/^Preview:/);
    await p.locator('#workshop-request').fill('Change crossbow +2 to +5 proj skills');assert.equal(await projectile(),2);assert.match(await p.locator('#workshop-trade-item').innerText(),/^Candidate:/);
    await p.locator('#workshop-preview').click();await p.locator('#workshop-proposal').waitFor();await p.locator('#workshop-apply').click();assert.equal(await projectile(),5);
    await p.locator('#workshop-undo').click();assert.equal(await projectile(),2);
  });
  await test('Optimized trade target is searchable before applying and remains after reload',async p=>{
    await setup(p,crossbowXml);await automatic(p);await recommendations(p);
    await p.locator('#workshop-request').fill('Optimize my crossbow for DPS');await p.locator('#workshop-try').click();await p.locator('#workshop-proposal').waitFor();
    const query=async()=>JSON.parse(new URL(await p.locator('#workshop-trade-close').getAttribute('href')).searchParams.get('q')).query;
    assert.equal((await query()).stats[0].filters[0].value.min,5);assert.equal((await snapshot(p)).candidate.gear.weapon.mods.includes('+2 to Level of all Projectile Skills'),true);
    await p.locator('#workshop-apply').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.native);
    await p.reload();await p.getByRole('button',{name:'Build Workshop',exact:true}).click();assert.equal((await query()).stats[0].filters[0].value.min,5);
  });
  await test('Trade form validates league and budget, clears price caps, and remembers preferences',async p=>{
    await setup(p,crossbowXml);await p.locator('#workshop-trade-league').fill('');assert.equal(await p.locator('#workshop-trade-target').getAttribute('href'),null);
    await p.locator('#workshop-trade-league').fill('Hardcore Test');await p.locator('#workshop-trade-budget').fill('-3');assert.equal(await p.locator('#workshop-trade-close').getAttribute('href'),null);assert.match(await p.locator('#workshop-trade-status').innerText(),/positive/);
    await p.locator('#workshop-trade-budget').fill('2.5');await p.locator('#workshop-trade-currency').selectOption('divine');await p.reload();await p.getByRole('button',{name:'Build Workshop',exact:true}).click();
    assert.equal(await p.locator('#workshop-trade-league').inputValue(),'Hardcore Test');assert.equal(await p.locator('#workshop-trade-budget').inputValue(),'2.5');assert.equal(await p.locator('#workshop-trade-currency').inputValue(),'divine');
    await p.locator('#workshop-trade-budget').fill('');const q=JSON.parse(new URL(await p.locator('#workshop-trade-target').getAttribute('href')).searchParams.get('q'));assert.equal(q.query.filters.trade_filters.filters.price,undefined);
  });
  await test('Trade controls fit a narrow screen and remain absent for unsupported equipment',async p=>{
    await setup(p);assert.ok(await p.locator('#workshop-trade').isHidden());await setup(p,crossbowXml);await p.setViewportSize({width:390,height:1000});
    assert.ok(await p.locator('#workshop-trade').isVisible());assert.ok(await p.evaluate(()=>{const el=document.querySelector('.workshop');return el.scrollWidth<=el.clientWidth+1;}));
    if(process.env.FORGE_TEST_OUTPUT){await p.locator('#workshop-trade').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(process.env.FORGE_TEST_OUTPUT,'trade-mobile.png')});await p.setViewportSize({width:1440,height:1100});await p.locator('#workshop-trade').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(process.env.FORGE_TEST_OUTPUT,'trade-desktop.png')});}
  });
  await test('Preview leaves original, candidate, Optimizer and guide untouched; apply changes only candidate',async p=>{
    await setup(p);await p.evaluate(()=>localStorage.setItem('forge:plannerGuide','synthetic guide sentinel'));
    const before=await snapshot(p),optimizer=await p.evaluate(()=>JSON.stringify(currentBuild));
    await p.locator('#workshop-request').fill('Change my amulet from +2 to +4 projectile skills');await p.locator('#workshop-preview').click();await p.locator('#workshop-proposal').waitFor();
    assert.deepEqual(await snapshot(p),before);assert.match(await p.locator('#workshop-proposal-after').innerText(),/^\+4/);
    await p.locator('#workshop-apply').click();const after=await snapshot(p);assert.deepEqual(after.baseline,before.baseline);assert.equal(await p.evaluate(()=>JSON.stringify(currentBuild)),optimizer);assert.equal(await p.evaluate(()=>localStorage.getItem('forge:plannerGuide')),'synthetic guide sentinel');
    assert.ok(after.candidate.gear.amulet.mods.includes('+4 to Level of all Projectile Skills'));assert.equal(after.candidateResult,null);assert.match(await p.locator('#workshop-stats-note').innerText(),/pending/);
  });
  await test('Candidate export preserves inactive equipment, flask/charm bindings, roll data and unknown sections',async p=>{
    await setup(p);await edit(p);const output=await exportCandidate(p);
    const check=await p.evaluate(text=>{const doc=new DOMParser().parseFromString(text,'text/xml');return {old:doc.querySelector('Item[id="1"]').textContent,new:doc.querySelector('Item[id="4"]').textContent,inactive:doc.querySelector('ItemSet[id="1"] Slot').getAttribute('itemId'),roll:doc.querySelector('Item[id="4"] ModRange')?.getAttribute('range'),stats:doc.querySelectorAll('PlayerStat').length,flask:doc.querySelector('ItemSet[id="2"] Slot[name="Flask 1"]').getAttribute('itemId'),charm:doc.querySelector('ItemSet[id="2"] Slot[name="Charm 2"]').getAttribute('itemId'),future:doc.querySelector('FutureSection').getAttribute('value')};},output);
    assert.match(check.old,/\+2 to Level/);assert.match(check.new,/\+4 to Level/);assert.equal(check.inactive,'1');assert.equal(check.roll,'0.5');assert.equal(check.stats,0);assert.equal(check.flask,'3');assert.equal(check.charm,'3');assert.equal(check.future,'preserve');
  });
  await test('Original export remains available after editing and selects the correct return target',async p=>{
    await setup(p);await edit(p);await p.locator('#workshop-export-original').click();await p.locator('#workshop-export-panel').waitFor();
    assert.equal(await p.locator('#workshop-export-code').inputValue(),encode(xml));assert.equal(await p.locator('#workshop-result-side').inputValue(),'baseline');assert.match(await p.locator('#workshop-export-label').innerText(),/Original/);
  });
  await test('Reload, undo and undoable reset retain the original and clear stale export codes',async p=>{
    await setup(p);await edit(p);await exportCandidate(p);await edit(p,'Set my amulet projectile skills to +5');assert.ok(await p.locator('#workshop-export-panel').isHidden());assert.equal(await p.locator('#workshop-export-code').inputValue(),'');
    await p.reload();await p.getByRole('button',{name:'Build Workshop',exact:true}).click();await p.locator('#workshop-undo').click();assert.ok((await snapshot(p)).candidate.gear.amulet.mods.includes('+4 to Level of all Projectile Skills'));
    await p.locator('#workshop-reset').click();assert.ok((await snapshot(p)).candidate.gear.amulet.mods.includes('+2 to Level of all Projectile Skills'));await p.locator('#workshop-undo').click();assert.ok((await snapshot(p)).candidate.gear.amulet.mods.includes('+4 to Level of all Projectile Skills'));
  });
  await test('Ambiguous, broad, multiple and mismatched requests never change the candidate',async p=>{
    await setup(p);const before=await snapshot(p);
    for(const [request,pattern] of [['Make my build stronger',/Try/],['Change my ring from +2 to +4',/left ring/],['Change my amulet from +7 to +4 projectile skills',/No existing modifier/],['Set my amulet projectile skills to +4 and add life',/not supported|Try/],['Change my amulet from +2 to +4 and buy an item',/not supported/],['Set my amulet life to 80%',/not a percentage/]]){
      await p.locator('#workshop-request').fill(request);await p.locator('#workshop-preview').click();await rejected(p,pattern);assert.deepEqual(await snapshot(p),before);
    }
  });
  await test('Crossbow shorthand previews the named stat and automatically calculates only that weapon edit',async p=>{
    await setup(p,crossbowXml);await automatic(p);const before=await snapshot(p);
    for(const request of ['change CROSSBOW +2 TO +4 PROJ SKILLS\n\n','Change my crossbow from +2 to +4 projectile skills.','Change crossbow projectile skills from +2 to +4','Set crossbow proj skills to +4']){
      await p.locator('#workshop-request').fill(request);await p.locator('#workshop-preview').click();await p.locator('#workshop-proposal').waitFor();
      assert.equal(await p.locator('#workshop-proposal-slot').textContent(),'Weapon');assert.equal(await p.locator('#workshop-proposal-before').innerText(),'+2 to Level of all Projectile Skills');assert.equal(await p.locator('#workshop-proposal-after').innerText(),'+4 to Level of all Projectile Skills');assert.deepEqual(await snapshot(p),before);
    }
    await p.locator('#workshop-request').fill('Change crossbow +2 to +4 proj skills');await p.locator('#workshop-try').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.stats.CombinedDPS===14000);
    const after=await snapshot(p);assert.deepEqual(after.baseline,before.baseline);assert.deepEqual(after.candidate.gear.amulet,before.candidate.gear.amulet);
    assert.deepEqual(after.candidate.gear.weapon.mods,before.candidate.gear.weapon.mods.map(m=>m==='+2 to Level of all Projectile Skills'?'+4 to Level of all Projectile Skills':m));
    await p.getByText('Manual PoB2 tools',{exact:true}).click();const output=await exportCandidate(p);const weapon=await p.evaluate(text=>{const doc=new DOMParser().parseFromString(text,'text/xml'),id=doc.querySelector('ItemSet[id="2"] Slot[name="Weapon 1"]').getAttribute('itemId');return doc.querySelector(`Item[id="${id}"]`).textContent;},output);assert.match(weapon,/\+4 to Level of all Projectile Skills/);assert.match(weapon,/Adds 9 to 202 Lightning Damage/);assert.match(weapon,/\{enchant\}\{rune\}36% increased Physical Damage/);
  });
  await test('Crossbow shorthand still rejects wrong values, ambiguous stats and multiple changes',async p=>{
    await setup(p,crossbowXml);const before=await snapshot(p);
    for(const [request,pattern] of [['Change crossbow +7 to +4 proj skills',/No existing modifier/],['Change crossbow +2 to +4',/More than one/],['Change crossbow +2 to +4 proj skills and life to +80',/not supported|Try/]]){
      await p.locator('#workshop-request').fill(request);await p.locator('#workshop-try').click();await rejected(p,pattern);assert.deepEqual(await snapshot(p),before);
    }
  });
  await test('Build-aware optimization previews a measured target and applies it only after review',async p=>{
    await setup(p,crossbowXml);await automatic(p);const controls={};await recommendations(p,controls);const before=await snapshot(p);
    for(const request of ['Change crossbow to include optimal dps stats for level 62 character','Optimize my crossbow for DPS','Give my crossbow the best DPS stats']){
      await p.locator('#workshop-request').fill(request);await p.locator('#workshop-try').click();await p.locator('#workshop-proposal').waitFor();assert.deepEqual(await snapshot(p),before);
      assert.match(await p.locator('#workshop-recommendation-note').innerText(),/80 tested combinations/);assert.equal(controls.body.level,62);assert.equal(controls.body.keepDefences,true);assert.equal(controls.body.skillGroup,1);
    }
    if(process.env.FORGE_TEST_OUTPUT){
      await p.evaluate(()=>document.getElementById('toast').classList.remove('show'));await p.locator('#workshop-proposal').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(process.env.FORGE_TEST_OUTPUT,'optimization-preview-desktop.png')});
      await p.setViewportSize({width:390,height:1000});assert.ok(await p.evaluate(()=>{const el=document.querySelector('.workshop');return el.scrollWidth<=el.clientWidth+1;}));await p.locator('#workshop-proposal').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(process.env.FORGE_TEST_OUTPUT,'optimization-preview-mobile.png')});await p.setViewportSize({width:1440,height:1100});
    }
    await p.locator('#workshop-apply').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.stats.CombinedDPS===15000);
    const after=await snapshot(p);assert.deepEqual(after.baseline,before.baseline);assert.deepEqual(after.candidate.gear.amulet,before.candidate.gear.amulet);assert.match(after.candidate.gear.weapon.pobItemText,/\+5 to Level/);
    await p.locator('#workshop-undo').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.stats.CombinedDPS===12000);assert.deepEqual((await snapshot(p)).candidate.gear,before.candidate.gear);
  });
  await test('Optimization rejects mismatched hashes, unavailable levels and reduced protected defences',async p=>{
    await setup(p,crossbowXml);await automatic(p);const controls={};await recommendations(p,controls);const before=await snapshot(p);
    for(const flag of ['wrongHash','wrongLevel','lowerDefences','empty']){
      controls[flag]=true;await p.locator('#workshop-request').fill('Optimize my crossbow for DPS');await p.locator('#workshop-try').click();await rejected(p,/does not match|level check|protected defence|No DPS improvement/);assert.deepEqual(await snapshot(p),before);controls[flag]=false;
    }
    for(const request of ['Optimize my crossbow for DPS for level 80 character','Optimize my crossbow for DPS with a budget of 10 divine','Optimize my crossbow for DPS and change my amulet']){
      await p.locator('#workshop-request').fill(request);await p.locator('#workshop-try').click();await rejected(p,/imported level|not supported yet/);assert.deepEqual(await snapshot(p),before);
    }
  });
  await test('Cancel and changed requests prevent a delayed recommendation from being applied',async p=>{
    await setup(p,crossbowXml);await automatic(p);const controls={delay:true};await recommendations(p,controls);const before=await snapshot(p);
    await p.locator('#workshop-request').fill('Optimize my crossbow for DPS');await p.locator('#workshop-try').click();while(!controls.release)await new Promise(r=>setTimeout(r,10));
    await p.locator('#workshop-cancel-search').click();controls.release();await rejected(p,/cancelled/);assert.deepEqual(await snapshot(p),before);
    controls.release=null;await p.locator('#workshop-try').click();while(!controls.release)await new Promise(r=>setTimeout(r,10));await p.locator('#workshop-request').fill('Set my amulet life to +90');controls.release();await p.waitForFunction(()=>!document.getElementById('workshop-preview').disabled);assert.ok(await p.locator('#workshop-proposal').isHidden());assert.deepEqual(await snapshot(p),before);
  });
  await test('Complete crossbow text is ingested into a review and preserves the rest of the build',async p=>{
    await setup(p,crossbowXml);await p.locator('#workshop-slot').selectOption('weapon');const before=await snapshot(p);
    await p.locator('#workshop-request').fill(crossbowItem.replace('130% increased Physical Damage','160% increased Physical Damage'));await p.locator('#workshop-try').click();await p.locator('#workshop-proposal').waitFor();assert.deepEqual(await snapshot(p),before);
    await p.locator('#workshop-apply').click();const after=await snapshot(p);assert.deepEqual(after.baseline,before.baseline);assert.deepEqual(after.candidate.gear.amulet,before.candidate.gear.amulet);assert.match(await exportCandidate(p),/160% increased Physical Damage/);
    await p.locator('#workshop-request').fill('Rarity: RARE\nIncomplete crossbow');await p.locator('#workshop-try').click();await rejected(p,/complete item text/);assert.deepEqual(await snapshot(p),after);
  });
  await test('Duplicate numeric matches require a modifier name; implicit edits update both arrays',async p=>{
    await setup(p,xml.replace('+60 to maximum Life','+2 to maximum Life'));
    await p.locator('#workshop-request').fill('Change my amulet from +2 to +4');await p.locator('#workshop-preview').click();await rejected(p,/More than one/);
    await edit(p,'Set my amulet intelligence to +20');const s=await snapshot(p);assert.equal(s.candidate.gear.amulet.implicits[0],'+20 to Intelligence');assert.equal(s.candidate.gear.amulet.mods[0],'+20 to Intelligence');assert.match(await exportCandidate(p),/\+20 to Intelligence/);
  });
  await test('Matching PoB2 results preview before adoption and show 11k to 14k only after attachment',async p=>{
    await setup(p);await edit(p);const fresh=calculated(await exportCandidate(p));await returnCode(p,fresh);await p.locator('#workshop-return-preview').waitFor();assert.equal((await snapshot(p)).candidateResult,null);
    await p.locator('#workshop-adopt-result').click();const s=await snapshot(p);assert.equal(s.baselineResult.stats.CombinedDPS,11000);assert.equal(s.candidateResult.stats.CombinedDPS,14000);assert.ok(s.baseline.gear.amulet.mods.includes('+2 to Level of all Projectile Skills'));
    await p.getByText('Damage and defence details',{exact:true}).click();const row=await p.locator('#workshop-stats tr').first().innerText();assert.match(row,/11,000/);assert.match(row,/14,000/);assert.match(row,/\+3,000/);assert.match(await p.locator('#workshop-stats').innerText(),/0%/);
    await p.locator('#workshop-open').click();assert.equal(await p.evaluate(()=>currentBuild.stats.dps),14000);assert.equal(await p.evaluate(()=>currentBuild.originalPobCode),encode(fresh));
  });
  await test('Returned code with different gear, tree, skill, configuration or character is rejected',async p=>{
    await setup(p);await edit(p);const fresh=calculated(await exportCandidate(p));
    for(const changed of [fresh.replace('+4 to Level','+5 to Level'),fresh.replace('nodes="1,2"','nodes="1,3"'),fresh.replace('level="14"','level="15"'),fresh.replace('string="Pinnacle"','string="None"'),fresh.replace('level="62"','level="63"')]){
      await returnCode(p,changed);await p.waitForFunction(()=>!document.getElementById('workshop-preview').disabled);assert.ok(await p.locator('#workshop-return-preview').isHidden());assert.match(await p.locator('#workshop-status').innerText(),/returned code differs/);assert.equal((await snapshot(p)).candidateResult,null);
    }
  });
  await test('An uncalculated export cannot be attached as computed results',async p=>{
    await setup(p);await edit(p);await returnCode(p,await exportCandidate(p));await p.waitForFunction(()=>!document.getElementById('workshop-preview').disabled);assert.match(await p.locator('#workshop-status').innerText(),/no calculated/);assert.ok(await p.locator('#workshop-adopt-result').isDisabled());
  });
  await test('Original results can be attached after starting with an edited baseline',async p=>{
    await setup(p);await edit(p);await p.locator('#workshop-open').click();await p.getByRole('button',{name:'Build Workshop',exact:true}).click();await p.locator('#workshop-start').click();await p.waitForFunction(()=>document.getElementById('workshop-status').textContent.includes('Original saved'));
    assert.equal((await snapshot(p)).baselineResult,null);const fresh=calculated(await exportCandidate(p));await p.locator('#workshop-result-side').selectOption('baseline');await returnCode(p,fresh);await p.locator('#workshop-return-preview').waitFor();await p.locator('#workshop-adopt-result').click();assert.equal((await snapshot(p)).baselineResult.stats.CombinedDPS,14000);assert.equal((await snapshot(p)).candidateResult,null);
  });
  await test('Changing request or returned code invalidates its previous approval preview',async p=>{
    await setup(p);await p.locator('#workshop-request').fill('Set my amulet life to +80');await p.locator('#workshop-preview').click();await p.locator('#workshop-proposal').waitFor();await p.locator('#workshop-request').fill('Set my amulet life to +90');assert.ok(await p.locator('#workshop-apply').isDisabled());
    await edit(p);await returnCode(p,calculated(await exportCandidate(p)));await p.locator('#workshop-return-preview').waitFor();await p.locator('#workshop-result-code').fill('different');assert.ok(await p.locator('#workshop-adopt-result').isDisabled());
  });
  await test('Editing a request during asynchronous validation discards the pending proposal',async p=>{
    await setup(p);await p.evaluate(()=>{window.savedDecode=decodePobCode;decodePobCode=code=>new Promise(resolve=>{window.finishWorkshopDecode=async()=>resolve(await savedDecode(code));});});
    await p.locator('#workshop-request').fill('Set my amulet life to +80');await p.locator('#workshop-preview').click();await p.waitForFunction(()=>!!window.finishWorkshopDecode);await p.locator('#workshop-request').fill('Set my amulet life to +90');await p.evaluate(async()=>{await finishWorkshopDecode();decodePobCode=savedDecode;});await p.waitForFunction(()=>!document.getElementById('workshop-preview').disabled);assert.ok(await p.locator('#workshop-apply').isDisabled());assert.ok((await snapshot(p)).candidate.gear.amulet.mods.includes('+60 to maximum Life'));
  });
  await test('Optimizer gear edits can be captured and undone without replacing the original',async p=>{
    await setup(p);await edit(p);await p.locator('#workshop-open').click();await p.evaluate(()=>{currentBuild.gear.amulet.mods=currentBuild.gear.amulet.mods.map(m=>m.replace('+60 to maximum Life','+90 to maximum Life'));markBuildEdited();setCurrentBuild(currentBuild);});
    await p.getByRole('button',{name:'Build Workshop',exact:true}).click();await p.locator('#workshop-capture').click();await p.waitForFunction(()=>document.getElementById('workshop-status').textContent.includes('equipment captured'));
    const s=await snapshot(p);assert.ok(s.candidate.gear.amulet.mods.includes('+90 to maximum Life'));assert.ok(s.baseline.gear.amulet.mods.includes('+60 to maximum Life'));await p.locator('#workshop-undo').click();assert.ok((await snapshot(p)).candidate.gear.amulet.mods.includes('+60 to maximum Life'));
  });
  await test('Unsupported Forge skill edits cannot start or enter the equipment comparison',async p=>{
    await setup(p);const before=await snapshot(p);await p.evaluate(()=>{currentBuild.skills[0].gemLevel++;markBuildEdited();});await p.locator('#workshop-capture').click();await p.waitForFunction(()=>!document.getElementById('workshop-preview').disabled);assert.match(await p.locator('#workshop-status').innerText(),/equipment edits only/);assert.deepEqual(await snapshot(p),before);
  });
  await test('A storage quota failure leaves the original and candidate intact',async p=>{
    await setup(p);const before=await snapshot(p);await p.locator('#workshop-request').fill('Set my amulet life to +80');await p.locator('#workshop-preview').click();await p.locator('#workshop-proposal').waitFor();await p.evaluate(()=>{window.realStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='forge:workshop:v1')throw new Error('Quota exceeded');return realStorageSet.call(this,key,value);};});
    await p.locator('#workshop-apply').click();assert.match(await p.locator('#workshop-status').innerText(),/Could not save/);assert.deepEqual(await snapshot(p),before);await p.evaluate(()=>Storage.prototype.setItem=realStorageSet);
  });
  await test('Item markup stays inert and responsive comparison has no horizontal overflow',async p=>{
    await setup(p,xml.replace('Workshop Fixture','&lt;img src=x onerror=alert(1)&gt;'));await edit(p);
    assert.equal(await p.locator('#workshop-before-item h3 img').count(),0);assert.match(await p.locator('#workshop-before-item h3').innerText(),/<img/);
    for(const width of [1440,900,390]){await p.setViewportSize({width,height:1100});assert.ok(await p.evaluate(()=>{const el=document.querySelector('.workshop');return el.scrollWidth<=el.clientWidth+1;}));}
  });
  await test('Desktop and mobile review captures use the actual working interface',async p=>{
    await setup(p);await edit(p);await returnCode(p,calculated(await exportCandidate(p)));await p.locator('#workshop-return-preview').waitFor();await p.locator('#workshop-adopt-result').click();
    const output=process.env.FORGE_TEST_OUTPUT;if(output){await p.evaluate(()=>{document.getElementById('tab-workshop').scrollTop=0;document.getElementById('toast').classList.remove('show');});await p.screenshot({path:path.join(output,'build-workshop-desktop.png')});await p.setViewportSize({width:390,height:1000});await p.evaluate(()=>document.getElementById('tab-workshop').scrollTop=0);await p.screenshot({path:path.join(output,'build-workshop-mobile.png')});}
    assert.match(await p.locator('#workshop-after-item').innerText(),/\+4/);assert.equal(await p.locator('#workshop-stats tr').count(),8);
  });
  await test('Try change performs apply and calculation without opening manual code controls',async p=>{
    await setup(p);await automatic(p);assert.ok(await p.locator('#workshop-manual').evaluate(e=>!e.open));
    await p.locator('#workshop-request').fill('Set my amulet projectile skills to +4');await p.locator('#workshop-try').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.stats.CombinedDPS===14000);
    const s=await snapshot(p);assert.ok(s.baseline.gear.amulet.mods.includes('+2 to Level of all Projectile Skills'));assert.equal(s.baselineResult.stats.CombinedDPS,12000);assert.match(await p.locator('#workshop-impact').innerText(),/14,000/);assert.ok(await p.locator('#workshop-export-panel').isHidden());
    if(process.env.FORGE_TEST_OUTPUT){await p.evaluate(()=>document.getElementById('tab-workshop').scrollTop=0);await p.screenshot({path:path.join(process.env.FORGE_TEST_OUTPUT,'automatic-workshop-desktop.png')});await p.setViewportSize({width:390,height:1000});await p.screenshot({path:path.join(process.env.FORGE_TEST_OUTPUT,'automatic-workshop-mobile.png')});}
  });
  await test('Undo automatically recalculates the restored candidate and preserves skill choice on reload',async p=>{
    await setup(p);await automatic(p);await p.locator('#workshop-request').fill('Set my amulet projectile skills to +4');await p.locator('#workshop-try').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.stats.CombinedDPS===14000);
    await p.locator('#workshop-undo').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.stats.CombinedDPS===12000);await p.reload();await p.getByRole('button',{name:'Build Workshop',exact:true}).click();assert.equal(await p.locator('#workshop-skill').inputValue(),'1');
  });
  await test('Failed or mismatched automatic results never supply candidate statistics',async p=>{
    await setup(p);const controls={};await automatic(p,controls);
    controls.fail=true;await p.locator('#workshop-request').fill('Set my amulet projectile skills to +4');await p.locator('#workshop-try').click();await p.waitForFunction(()=>document.getElementById('workshop-status').textContent.includes('Fixture engine failure'));assert.equal((await snapshot(p)).candidateResult,null);
    controls.fail=false;controls.wrongHash=true;await p.locator('#workshop-calculate').click();await p.waitForFunction(()=>document.getElementById('workshop-status').textContent.includes('inputs did not match'));assert.equal((await snapshot(p)).candidateResult,null);
  });
  await test('A result arriving after another edit cannot replace the new candidate calculation',async p=>{
    await setup(p);const controls={};await automatic(p,controls);controls.delay=true;await p.locator('#workshop-request').fill('Set my amulet projectile skills to +4');await p.locator('#workshop-try').click();while(!controls.release)await new Promise(r=>setTimeout(r,10));
    await p.locator('#workshop-request').fill('Set my amulet projectile skills to +5');await p.locator('#workshop-try').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('forge:workshop:v1')).candidateResult?.stats.CombinedDPS===15000);controls.release();await p.locator('#workshop-undo').waitFor();assert.equal((await snapshot(p)).candidateResult.stats.CombinedDPS,15000);
  });
  console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,total:results.length,results},null,2));
  if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server?.close(r));});
