const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const source = fs.readFileSync(path.join(__dirname,'../POE2Forge_v17.html'),'utf8').replace(/\r\n/g,'\n');
const results = [];
function fn(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  return source.slice(match.index, source.indexOf('\n}',match.index)+2);
}
function setup(saved) {
  const elements = new Map();
  const storage = new Map(saved ? [['forge:currentBuild',saved]] : []);
  const writes = [];
  const c = vm.createContext({
    JSON, Date, Math, setTimeout:callback=>callback(),
    STORAGE_KEYS:{build:'forge:currentBuild'}, POB_SLOT_TO_KEY:{},
    document:{getElementById:id=>{
      if(!elements.has(id)) elements.set(id,{value:'',innerHTML:'',disabled:false,style:{},classList:{add(){},remove(){}}});
      return elements.get(id);
    }},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    navigator:{clipboard:{writeText:async value=>writes.push(value)}},
    toast(){},renderBuildBadge(){},renderOptimizerLeftPanel(){},renderOptimizerCenterPanel(){},renderItemDetailEmpty(){},
    renderPobSummary(){},setPobStatus(){},switchTab(){},renderPob2Bridge(){},showPob2Result(){},
    escHtml:value=>String(value),
    decodePobCode:async code=>zlib.inflateSync(Buffer.from(code,'base64url')).toString(),
    parsePobXml:xml=>({build:{className:xml.includes('Mercenary')?'Mercenary':'Ranger',level:62},items:[],skills:[],tree:[]}),
    prompt:()=> 'Saved build',loadSavedBuilds:()=>[],persistSavedBuilds:value=>{c.savedGallery=value;},
    populateGalleryFilters(){},renderGallery(){},
  });
  vm.runInContext(`let currentBuild=null, lastDecodedBuild=null, lastExportedCode=null, lastExportedXml=null, exportRequestId=0;
    let allResults=[],filteredResults=[],selectedItem=null,activeSlot=null,pob2StepState=null;`,c);
  ['mapPobToBuild','getOriginalPobCode','encodePobCode','setCurrentBuild','loadStoredBuild','decodePobInput','sendPobToOptimizer','applyPob2Code','saveCurrentToGallery','markBuildEdited','setExportActionsEnabled','openExportModal','closeExportModal','copyExportCode'].forEach(name=>vm.runInContext(fn(name),c));
  return {c,elements,storage,writes};
}
const xmlA='<PathOfBuilding2><Build className="Mercenary" level="62"/><Tree><Spec treeVersion="0_5" nodes="1,2,3"/></Tree><Items><ItemSet id="2"/><Item id="17">Charm</Item></Items><Skills/><Config><Input name="futureSetting"/></Config><Notes>Metadata not mapped by Forge</Notes></PathOfBuilding2>';
const codeA=zlib.deflateSync(xmlA).toString('base64url');
const codeB=zlib.deflateSync(xmlA.replace('Mercenary','Ranger')).toString('base64url');
async function test(name,run) {try{await run();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.stack});}}
(async()=>{
  await test('Decoder stores its source on the selected build and preserves all XML after reload',async()=>{
    const first=setup();first.c.document.getElementById('pob-input').value=codeA;
    await first.c.decodePobInput();first.c.sendPobToOptimizer();
    const reloaded=setup(first.storage.get('forge:currentBuild'));reloaded.c.loadStoredBuild();
    const exported=await vm.runInContext('encodePobCode(currentBuild)',reloaded.c);
    assert.equal(exported.code,codeA);assert.equal(zlib.inflateSync(Buffer.from(exported.code,'base64url')).toString(),xmlA);
  });
  await test('Decoding another character cannot replace the selected character export or gallery entry',async()=>{
    const s=setup();await s.c.applyPob2Code(codeA);
    s.c.document.getElementById('pob-input').value=codeB;await s.c.decodePobInput();
    assert.equal((await vm.runInContext('encodePobCode(currentBuild)',s.c)).code,codeA);
    s.c.saveCurrentToGallery();assert.equal(s.c.savedGallery[0].code,codeA);
    s.c.sendPobToOptimizer();assert.equal((await vm.runInContext('encodePobCode(currentBuild)',s.c)).code,codeB);
  });
  await test('Bridge import retains its source across storage reload',async()=>{
    const s=setup();await s.c.applyPob2Code(codeA);
    const restored=setup(s.storage.get('forge:currentBuild'));restored.c.loadStoredBuild();
    assert.equal((await vm.runInContext('encodePobCode(currentBuild)',restored.c)).code,codeA);
    restored.c.saveCurrentToGallery();assert.equal(restored.c.savedGallery[0].code,codeA);
  });
  await test('Gallery load passes its own source to the shared mapper',async()=>{
    const match=/async function (\w+)\(id\) \{[\s\S]*?build\.character\.name = entry\.name/.exec(source.slice(source.indexOf('function renderGalleryCard')));
    assert.ok(match,'Find actual gallery import handler');
    const s=setup();s.c.allGalleryEntries=()=>[{id:'test',name:'Gallery',code:codeA,_source:'user'}];
    vm.runInContext(fn(match[1]),s.c);await s.c[match[1]]('test');
    assert.equal((await vm.runInContext('encodePobCode(currentBuild)',s.c)).code,codeA);
  });
  await test('Old saved builds without source cannot produce guessed XML',async()=>{
    const s=setup(JSON.stringify({source:'pob2',character:{class:'Mercenary',level:62}}));s.c.loadStoredBuild();
    await assert.rejects(vm.runInContext('encodePobCode(currentBuild)',s.c),/missing its original PoB2 code/);
  });
  await test('Edited builds retain source but cannot export it as current or save it as current in gallery',async()=>{
    const s=setup();await s.c.applyPob2Code(codeA);s.c.markBuildEdited();
    await assert.rejects(vm.runInContext('encodePobCode(currentBuild)',s.c),/edited builds is not supported/);
    assert.equal(vm.runInContext('currentBuild.originalPobCode',s.c),codeA);
    s.c.saveCurrentToGallery();assert.equal(s.c.savedGallery,undefined);
  });
  await test('Failed export clears prior successful output and disables copying and downloading',async()=>{
    const s=setup();await s.c.applyPob2Code(codeA);await s.c.openExportModal();await s.c.copyExportCode();
    assert.deepEqual(s.writes,[codeA]);s.c.markBuildEdited();await s.c.openExportModal();await s.c.copyExportCode();
    assert.deepEqual(s.writes,[codeA]);assert.equal(vm.runInContext('lastExportedCode',s.c),null);
    assert.equal(s.elements.get('export-copy-btn').disabled,true);assert.equal(s.elements.get('export-download-btn').disabled,true);
  });
  await test('Closing an export while decoding cannot enable a stale result',async()=>{
    const s=setup();await s.c.applyPob2Code(codeA);
    let finish;s.c.decodePobCode=()=>new Promise(resolve=>{finish=resolve;});
    const pending=s.c.openExportModal();await Promise.resolve();s.c.closeExportModal();finish(xmlA);await pending;
    assert.equal(vm.runInContext('lastExportedCode',s.c),null);assert.equal(s.elements.get('export-copy-btn').disabled,true);
  });
  await test('Invalid stored source cannot be copied despite previous success',async()=>{
    const s=setup();await s.c.applyPob2Code(codeA);await s.c.openExportModal();
    vm.runInContext('currentBuild.originalPobCode="broken"',s.c);await s.c.openExportModal();
    assert.equal(vm.runInContext('lastExportedCode',s.c),null);assert.equal(s.elements.get('export-copy-btn').disabled,true);
  });
  await test('Every inline script parses and the unsupported synthesis path is removed',()=>{
    [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc\s*=/.test(m[1])).forEach(m=>new vm.Script(m[2]));
    assert.ok(!source.includes('function synthesizePobXml('));assert.ok(!source.includes('const POB_CLASS_ID'));
  });
  console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.status==='PASS').length,results},null,2));
  process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
