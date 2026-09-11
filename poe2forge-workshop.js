/* A local candidate workspace. PoB2 remains the source of calculated results. */
(() => {
  'use strict';
  const KEY = 'forge:workshop:v1';
  const slots = {weapon:'Weapon',offhand:'Off hand',helmet:'Helmet',body:'Body armour',gloves:'Gloves',boots:'Boots',belt:'Belt',amulet:'Amulet',ring_l:'Left ring',ring_r:'Right ring'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const el = id => document.getElementById('workshop-'+id);
  const esc = value => escHtml(String(value ?? ''));
  let state = null, proposal = null, returned = null, revision = 0, busy = false;
  let calculatorInfo=null, calculationAbort=null, calculationSequence=0, calculating=false;
  const buildKey = build => JSON.stringify(build);
  const numeric = /[+-]?\d+(?:\.\d+)?/g;

  function status(message, error=false) {
    el('status').textContent = message;
    el('status').className = 'workshop-status' + (error ? ' error' : '');
  }
  function invalidate() { revision++; proposal=null; returned=null; calculationAbort?.abort();calculationSequence++;calculating=false;el('export-code').value='';el('export-panel').hidden=true; }
  function persist(next) {
    // Save first: a quota failure must never silently discard the original.
    localStorage.setItem(KEY,JSON.stringify(next));
    state=next; invalidate(); render();
  }
  function attrs(node, omit=[]) {
    return Object.fromEntries([...node?.attributes || []].filter(a=>!omit.includes(a.name)).map(a=>[a.name,a.value]).sort(([a],[b])=>a.localeCompare(b)));
  }
  function canonical(node, omit=[]) {
    if (!node) return null;
    return [node.tagName,attrs(node,omit),[...node.childNodes].map(n=>n.nodeType===1?canonical(n):n.nodeType===3||n.nodeType===4?n.textContent.trim():null).filter(v=>v!==null&&v!=='')];
  }
  function activeSection(parent, tag, attribute, positional=false) {
    if (!parent) return null;
    const entries=[...parent.children].filter(n=>n.tagName===tag);
    if (!entries.length) return parent;
    const id=parent.getAttribute(attribute)||'1';
    const active=positional?entries[Number(id)-1]:entries.find(n=>n.getAttribute('id')===id);
    if (!active) throw new Error('Select a valid '+tag+' in PoB2 and export the build again.');
    return active;
  }
  function calculationInput(xml) {
    const doc=new DOMParser().parseFromString(xml,'text/xml');
    if (doc.querySelector('parsererror')||doc.documentElement.tagName!=='PathOfBuilding2') throw new Error('Import a complete Path of Building 2 code.');
    const root=doc.documentElement, build=root.querySelector(':scope > Build');
    if (!build) throw new Error('This code has no character.');
    const items=root.querySelector(':scope > Items'), activeItems=activeSection(items,'ItemSet','activeItemSet');
    const tree=activeSection(root.querySelector(':scope > Tree'),'Spec','activeSpec',true);
    const skills=activeSection(root.querySelector(':scope > Skills'),'SkillSet','activeSkillSet');
    const gear=[...activeItems?.children||[]].filter(n=>n.tagName==='Slot').map(slot=>{
      const id=slot.getAttribute('itemId');
      const matches=[...items.children].filter(n=>n.tagName==='Item'&&n.getAttribute('id')===id);
      if (id&&id!=='0'&&matches.length!==1) throw new Error('The active equipment set has a missing or duplicate item.');
      const item=matches[0];
      // Item IDs can change when PoB2 saves. Match the actual item and its roll data.
      const text=item?[...item.childNodes].filter(n=>n.nodeType===3||n.nodeType===4).map(n=>n.textContent).join('\n').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!/^Unique ID:/.test(s)).join('\n'):null;
      return [attrs(slot,['itemId','itemPbURL']),item?[attrs(item,['id']),text,[...item.children].map(n=>canonical(n))]:null];
    }).sort((a,b)=>JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
    const character=attrs(build,['viewMode','buildName']);
    const input={character,gear:[attrs(items,['activeItemSet']),attrs(activeItems,['id','title','activeItemSet']),gear],tree:canonical(tree,['title']),skills:canonical(skills,['id','title']),configuration:canonical(root.querySelector(':scope > Config')),
      other:[...root.children].filter(n=>!['Build','Items','Tree','Skills','Config','Notes'].includes(n.tagName)).map(n=>canonical(n))};
    const groups=[...skills?.children||[]].filter(n=>n.tagName==='Skill');
    const group=groups[Number(build.getAttribute('mainSocketGroup')||1)-1];
    const skill=group?.getAttribute('label')||group?.querySelector('Gem')?.getAttribute('nameSpec')||'Selected PoB2 skill';
    const stats={};
    for(const stat of build.querySelectorAll(':scope > PlayerStat')) {
      const raw=stat.getAttribute('value');
      if(raw!==null&&raw.trim()!==''&&Number.isFinite(Number(raw))) stats[stat.getAttribute('stat')]=Number(raw);
    }
    return {input,skill,stats};
  }
  async function exported(build) {
    const result=await encodePobCode(build);
    const xml=result.xml||await decodePobCode(result.code);
    return {...result,xml,context:calculationInput(xml)};
  }
  function resultFrom(context) {
    return Object.keys(context.stats).length ? {stats:context.stats,skill:context.skill,receivedAt:new Date().toISOString()} : null;
  }

  // Deliberately consume the complete request. Unsupported or ambiguous text
  // must not turn a partial interpretation into an equipment change.
  function interpret(text,build) {
    const request=String(text).trim().replace(/[.!]$/,'').replace(/\s+/g,' ');
    if(request.length>400) throw new Error('Keep the request to one equipment modifier.');
    if(/\b(?:optimal|optimi[sz]e|best|maximi[sz]e)\b/i.test(request)) throw new Error('Choosing optimal weapon stats is not available yet. Forge can calculate a specific modifier change with PoB2. Try “Change crossbow +2 to +4 proj skills”, or compare a complete replacement item through the Optimizer.');
    const slotPattern='(left ring|right ring|body armour|body armor|off hand|offhand|crossbow|weapon|helmet|helm|chest|gloves|boots|belt|amulet|ring)';
    const start='^(?:please )?(?:change|set|increase|raise|reduce|lower|adjust|update) (?:my |the )?'+slotPattern+' ';
    const number='([+-]?\\d+(?:\\.\\d+)?%?)';
    let match,slot,from=null,to,phrase='';
    if((match=request.match(new RegExp(start+'(?:from )?'+number+' to '+number+'(?: (.+))?$','i')))) [,slot,from,to,phrase='']=match;
    else if((match=request.match(new RegExp(start+'(.+?) (?:from '+number+' )?to '+number+'$','i')))) [,slot,phrase,from,to]=match;
    else if((match=request.match(new RegExp(start+'to '+number+'(?: (.+))?$','i')))) [,slot,to,phrase='']=match;
    else throw new Error('Try “Change crossbow +2 to +4 proj skills” or “Set my boots life to +80”. Use one existing numeric modifier at a time.');
    slot=slot.toLowerCase();
    if(slot==='ring') throw new Error('Choose the left ring or right ring so the edit has one clear target.');
    slot=({'left ring':'ring_l','right ring':'ring_r','body armour':'body','body armor':'body','chest':'body','off hand':'offhand','crossbow':'weapon','helm':'helmet'})[slot]||slot;
    const item=build.gear?.[slot];
    if(!item) throw new Error('There is no item in the '+slots[slot].toLowerCase()+' slot. Add complete item text in the Optimizer first.');
    const descriptions={
      'projectile skill':/^\+?\d+ to Level of all Projectile Skills$/i,
      'projectile skills':/^\+?\d+ to Level of all Projectile Skills$/i,
      'proj skills':/^\+?\d+ to Level of all Projectile Skills$/i,
      'projectile skill levels':/^\+?\d+ to Level of all Projectile Skills$/i,
      'life':/^\+?\d+ to maximum Life$/i,
      'maximum life':/^\+?\d+ to maximum Life$/i,
      'mana':/^\+?\d+ to maximum Mana$/i,
      'fire resistance':/^[+-]?\d+% to Fire Resistance$/i,
      'cold resistance':/^[+-]?\d+% to Cold Resistance$/i,
      'lightning resistance':/^[+-]?\d+% to Lightning Resistance$/i,
      'chaos resistance':/^[+-]?\d+% to Chaos Resistance$/i,
      'strength':/^\+?\d+ to Strength$/i,
      'dexterity':/^\+?\d+ to Dexterity$/i,
      'intelligence':/^\+?\d+ to Intelligence$/i,
      'physical damage':/^\d+% increased Physical Damage$/i,
      'attack speed':/^\d+% increased Attack Speed$/i,
      'movement speed':/^\d+% increased Movement Speed$/i,
      'accuracy':/^\+?\d+ to Accuracy Rating$/i,
    };
    phrase=phrase.toLowerCase().trim();
    if(phrase&&!Object.hasOwn(descriptions,phrase)) throw new Error('That modifier description is not supported yet. Use an exact “from … to …” value, or edit the item in the Optimizer.');
    const target=Number(to.replace('%','')), oldValue=from==null?null:Number(from.replace('%',''));
    if(!Number.isFinite(target)||Math.abs(target)>99999) throw new Error('Use a finite modifier value between -99999 and 99999.');
    const matches=(item.mods||[]).map((line,index)=>({line,index,numbers:line.match(numeric)||[]})).filter(m=>m.numbers.length===1&&(!phrase||descriptions[phrase].test(m.line))&&(oldValue===null||Number(m.numbers[0])===oldValue));
    if(matches.length!==1) throw new Error(matches.length?'More than one modifier matches. Add its name, such as “life” or “fire resistance”.':'No existing modifier matches that request. Check the original value and modifier on the candidate.');
    const {line,index,numbers}=matches[0],token=numbers[0];
    if((to.includes('%')||from?.includes('%'))&&!line.includes(token+'%')) throw new Error('This modifier is not a percentage.');
    if(target===Number(token)) throw new Error('The candidate already has that value. Choose a different value to preview a change.');
    const value=target>=0&&token.startsWith('+')?'+'+target:String(target);
    const after=line.replace(numeric,value);
    const next=clone(build);
    next.gear[slot].mods[index]=after;
    if(index<(next.gear[slot].implicits||[]).length) next.gear[slot].implicits[index]=after;
    next.editedSinceImport=true;
    next.needsCalculation=true;
    return {slot,index,before:line,after,next,request};
  }

  function changedSlots() {
    return state?Object.keys(slots).filter(slot=>!same(state.baseline.gear?.[slot],state.candidate.gear?.[slot])):[];
  }
  function itemCard(item,other,side,slot) {
    if(!item) return '<div class="workshop-item empty">Empty slot</div>';
    const icon=lookupItemIcon(item),remaining=[...(other?.mods||[])];
    const mods=(item.mods||[]).map(line=>{
      const i=remaining.indexOf(line),changed=i<0;
      if(i>=0)remaining.splice(i,1);
      return '<li class="'+(changed?side==='before'?'removed':'added':'')+'">'+esc(line)+'</li>';
    }).join('');
    return `<article class="workshop-item"><div class="workshop-item-head">${icon?`<img src="${esc(icon)}" alt="" loading="lazy" onerror="this.hidden=true">`:'<span class="workshop-gem" aria-hidden="true">◇</span>'}<div><span class="workshop-eyebrow">${esc(slots[slot])} · ${esc(item.rarity||'item')}</span><h3>${esc(item.name||item.typeLine)}</h3><p>${esc(item.typeLine)}${item.ilvl?' · Item level '+esc(item.ilvl):''}</p></div></div><ul>${mods}</ul></article>`;
  }
  const statRows=[['CombinedDPS','DPS','TotalDPS'],['Life','Life'],['EnergyShield','Energy shield'],['TotalEHP','Effective hit pool'],['FireResist','Fire resistance'],['ColdResist','Cold resistance'],['LightningResist','Lightning resistance'],['ChaosResist','Chaos resistance']];
  function statValue(result,key,fallback) {return result?(result.stats[key]??(fallback?result.stats[fallback]:undefined)):undefined;}
  function format(value,resist=false) {return Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:1})+(resist?'%':''):'—';}
  function renderStats() {
    const a=calculating?null:state.baselineResult,b=calculating?null:state.candidateResult;
    el('stats-note').textContent=calculating?'Calculating both versions with your local PoB2 engine…':b?.native?'Calculated locally by PoB2 '+b.engineVersion+'. Both versions use the same skill and configuration.':b?'Values reported by PoB2 exports. Keep the same selected skill and configuration when comparing.':'Candidate numbers are pending. Try a change or choose Calculate impact.';
    el('impact').innerHTML=[['CombinedDPS','Damage / second','TotalDPS'],['TotalEHP','Effective hit pool'],['Life','Life'],['EnergyShield','Energy shield']].map(([key,label,fallback])=>{
      const av=statValue(a,key,fallback),bv=statValue(b,key,fallback),comparable=!fallback||!a||!b||(Object.hasOwn(a.stats,key)===Object.hasOwn(b.stats,key));
      const delta=Number.isFinite(av)&&Number.isFinite(bv)&&comparable?bv-av:null;
      return `<div class="workshop-impact-card"><span>${label}</span><strong>${calculating?'…':format(bv)}</strong><small>Original ${format(av)}</small><em class="${delta>0?'positive':delta<0?'negative':''}">${delta===null?'Awaiting calculation':delta===0?'No change':(delta>0?'+':'')+format(delta)+(av!==0?' ('+(delta>0?'+':'')+(delta/Math.abs(av)*100).toFixed(1)+'%)':'')}</em></div>`;
    }).join('');
    el('stats').innerHTML=statRows.map(([key,label,fallback])=>{
      const av=statValue(a,key,fallback),bv=statValue(b,key,fallback),resist=key.endsWith('Resist');
      // CombinedDPS and TotalDPS are different metrics; never subtract unlike values.
      const sameMetric=!fallback||(!a||!b)||(Object.hasOwn(a.stats,key)===Object.hasOwn(b.stats,key));
      const delta=Number.isFinite(av)&&Number.isFinite(bv)&&sameMetric?bv-av:null;
      const displayLabel=fallback?(!sameMetric?'DPS · different measures':a?.stats[key]!=null||b?.stats[key]!=null?'Combined DPS':'Total DPS'):label;
      return `<tr><th scope="row">${displayLabel}</th><td>${format(av,resist)}</td><td>${format(bv,resist)}</td><td class="${delta>0?'positive':delta<0?'negative':''}">${delta===null?'—':(delta>0?'+':'')+format(delta)+(resist?' pp':'')}</td></tr>`;
    }).join('');
    el('baseline-source').textContent=a?(a.native?'Local PoB2 '+a.engineVersion:'PoB2 export')+' · '+a.skill:'Awaiting original PoB2 results';
    el('candidate-source').textContent=b?(b.native?'Local PoB2 '+b.engineVersion:'PoB2 export')+' · '+b.skill:'Recalculation needed';
  }
  function render() {
    el('empty').hidden=!!state; el('workspace').hidden=!state;
    el('start').disabled=busy||!currentBuild?.originalPobCode;
    el('start').textContent=state?'Start a new comparison':'Use current build';
    el('current').textContent=currentBuild?.character?`${currentBuild.character.ascendancy||currentBuild.character.class} · Level ${currentBuild.character.level}`:'Import a PoB2 build to begin';
    if(!state)return;
    const changed=changedSlots();
    el('character').textContent=`${state.baseline.character?.ascendancy||state.baseline.character?.class||'Character'} · Level ${state.baseline.character?.level||'?'}`;
    el('count').textContent=changed.length?changed.length+' equipment slot'+(changed.length===1?'':'s')+' changed':'Candidate matches original';
    el('undo').disabled=busy||!state.history.length;
    el('reset').disabled=busy||!changed.length;
    el('preview').disabled=busy;
    el('try').disabled=busy;
    el('apply').disabled=busy||!proposal;
    el('proposal').hidden=!proposal;
    el('return-preview').hidden=!returned;
    el('adopt-result').disabled=busy||!returned;
    el('export').disabled=busy;
    el('export-original').disabled=busy;
    el('open').disabled=busy;
    el('capture').disabled=busy||!currentBuild?.originalPobCode;
    el('calculate').disabled=busy||calculating;
    el('calculate').textContent=calculating?'Calculating…':'Calculate impact';
    el('engine-status').textContent=calculatorInfo?.available?'PoB2 '+calculatorInfo.version+' connected · calculations stay on this PC':calculatorInfo?.reason||'Checking the local calculator…';
    el('engine-status').className='workshop-engine-status'+(calculatorInfo?.available?' connected':'');
    const selected=el('slot').value;
    el('slot').innerHTML=Object.entries(slots).map(([key,label])=>`<option value="${key}">${label}${changed.includes(key)?' · changed':''}</option>`).join('');
    el('slot').value=selected||changed[0]||'amulet';
    renderGear(); renderStats();
  }
  function renderGear() {
    if(!state)return;
    const slot=el('slot').value;
    el('before-item').innerHTML=itemCard(state.baseline.gear?.[slot],state.candidate.gear?.[slot],'before',slot);
    el('after-item').innerHTML=itemCard(state.candidate.gear?.[slot],state.baseline.gear?.[slot],'after',slot);
  }
  async function start() {
    if(busy)return;
    if(state&&!confirm('Start a new comparison from the current Optimizer build? This replaces the saved comparison and its undo history.'))return;
    const snapshot=clone(currentBuild),key=buildKey(currentBuild),token=++revision;
    busy=true;render();status('Preparing the original and candidate…');
    try {
      const source=await exported(snapshot);
      if(token!==revision||key!==buildKey(currentBuild))throw new Error('The current build changed. Start the comparison again.');
      const result=resultFrom(source.context);
      persist({version:1,baseline:snapshot,candidate:clone(snapshot),baselineResult:result,candidateResult:clone(result),history:[]});
      status('Original saved. Describe one gear change to preview your candidate.');
      void calculateImpact();
    }catch(e){status(e.message,true);}finally{busy=false;render();}
  }
  async function preview(applyImmediately=false) {
    if(busy||!state)return;
    invalidate();const token=revision,key=buildKey(state.candidate),request=el('request').value;
    busy=true;render();status('Checking the proposed equipment change…');
    try {
      const proposed=interpret(request,state.candidate);
      await exported(proposed.next);
      if(token!==revision||request!==el('request').value||key!==buildKey(state.candidate))return;
      proposal={...proposed,key};
      el('proposal-slot').textContent=slots[proposed.slot];
      el('proposal-before').textContent=proposed.before;el('proposal-after').textContent=proposed.after;
      status('Preview ready. Applying changes only the candidate. PoB2 calculates the impact; this does not validate item availability or equip requirements.');
    }catch(e){status(e.message,true);}finally{busy=false;render();}
    if(applyImmediately&&proposal)apply();
  }
  function apply() {
    if(!proposal||busy||proposal.key!==buildKey(state.candidate))return;
    const next=clone(state),p=proposal;
    next.history.push({candidate:next.candidate,result:next.candidateResult});next.history=next.history.slice(-10);
    next.candidate=p.next;next.candidateResult=null;
    try{persist(next);el('slot').value=p.slot;renderGear();status(calculatorInfo?.available?'Candidate updated. Calculating its impact…':'Candidate saved. Use the manual PoB2 tools below to calculate its impact.');void calculateImpact();}catch(e){status('Could not save the change: '+e.message,true);}
  }
  function undo(reset=false) {
    if(!state||busy)return;
    const next=clone(state),prior=reset?{candidate:next.baseline,result:next.baselineResult}:next.history.pop();
    if(!prior)return;
    if(reset)next.history.push({candidate:next.candidate,result:next.candidateResult});
    next.history=next.history.slice(-10);next.candidate=clone(prior.candidate);next.candidateResult=clone(prior.result);
    try{persist(next);status(reset?'Candidate restored to the original. You can undo this reset.':'Last candidate change undone.');void calculateImpact();}catch(e){status(e.message,true);}
  }
  async function prepareExport(side='candidate') {
    if(!state||busy)return;
    invalidate();
    busy=true;const token=revision,key=buildKey(state[side]);render();
    try {
      const result=await exported(clone(state[side]));
      if(token!==revision||key!==buildKey(state[side]))return;
      el('export-label').textContent=side==='baseline'?'Original PoB2 code':'Candidate PoB2 code';
      el('export-code').value=result.code;el('export-panel').hidden=false;
      el('result-side').value=side;
      status('Import this code into a separate PoB2 build. Keep the same selected skill and configuration, then export a new code back to the Workshop.');
    }catch(e){status(e.message,true);}finally{busy=false;render();}
  }
  async function previewReturn() {
    if(!state||busy)return;
    invalidate();const token=revision,side=el('result-side').value,code=el('result-code').value.trim(),key=buildKey(state[side]);
    busy=true;render();status('Matching the returned PoB2 build…');
    try {
      if(!code||code.length>1500000)throw new Error('Paste a PoB2 export code, up to 1.5 MB.');
      const [expected,xml]=await Promise.all([exported(clone(state[side])),decodePobCode(code)]);
      const context=calculationInput(xml),result=resultFrom(context);
      const different=Object.keys(expected.context.input).filter(k=>!same(expected.context.input[k],context.input[k]));
      if(different.length)throw new Error('The returned code differs in '+different.join(', ')+'. Use the matching build, selected sets, skill and configuration in PoB2, then export again.');
      if(!result)throw new Error('This code has no calculated PoB2 results. Open it in PoB2, let it calculate, and copy a fresh export.');
      if(token!==revision||side!==el('result-side').value||code!==el('result-code').value.trim()||key!==buildKey(state[side]))return;
      returned={side,key,result,build:mapPobToBuild(parsePobXml(xml),code)};
      returned.build.character.name=state[side].character.name;
      returned.build.character.league=state[side].character.league;
      el('returned-label').textContent=`Matches ${side==='baseline'?'original':'candidate'} · ${result.skill} · PoB2 DPS ${format(result.stats.CombinedDPS??result.stats.TotalDPS)}`;
      status('The returned inputs match. Review and attach these PoB2-reported results.');
    }catch(e){status(e.message,true);}finally{busy=false;render();}
  }
  function adoptResult() {
    if(!returned||busy||returned.key!==buildKey(state[returned.side]))return;
    const next=clone(state),r=returned;
    // Keep the original snapshot; results are separately attributed to it.
    next[r.side+'Result']=r.result;
    if(r.side==='candidate') {
      next.history.push({candidate:next.candidate,result:state.candidateResult});next.history=next.history.slice(-10);
      next.candidate=r.build;
    }
    try{persist(next);el('result-code').value='';status('PoB2 results attached. No damage estimate was generated by Forge.');}catch(e){status(e.message,true);}
  }
  function openCandidate() {
    if(!state||busy)return;
    setCurrentBuild(clone(state.candidate));switchTab('optimizer');toast('Candidate opened. Original remains saved in Build Workshop.','ok');
  }
  async function captureCandidate() {
    if(!state||busy||!currentBuild)return;
    const snapshot=clone(currentBuild),key=buildKey(currentBuild),token=++revision;
    busy=true;render();status('Checking the Optimizer equipment against the original…');
    try {
      const [source,base]=await Promise.all([exported(snapshot),exported(clone(state.baseline))]);
      const different=Object.keys(base.context.input).filter(k=>k!=='gear'&&!same(base.context.input[k],source.context.input[k]));
      if(different.length)throw new Error('The Optimizer differs in '+different.join(', ')+'. Keep the same character, skills, tree and configuration for this equipment comparison.');
      if(token!==revision||key!==buildKey(currentBuild))throw new Error('The Optimizer changed during the check. Try again.');
      const next=clone(state);next.history.push({candidate:next.candidate,result:next.candidateResult});next.history=next.history.slice(-10);
      next.candidate=snapshot;next.candidateResult=resultFrom(source.context);persist(next);
      status('Optimizer equipment captured as the candidate. Your original is preserved.');
      void calculateImpact();
    }catch(e){status(e.message,true);}finally{busy=false;render();}
  }
  function refresh() { if(el('start'))render(); }
  async function refreshCalculator() {
    if(!['localhost','127.0.0.1'].includes(location.hostname)) {
      calculatorInfo={available:false,reason:'Automatic calculation runs in local Forge on your PC. Manual PoB2 tools remain available here.'};
    }else{
      try{
        const response=await fetch(new URL('pob2-calculator',document.baseURI),{signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw new Error('The local calculator is not connected. Restart the updated Forge server, or use manual tools.');
        calculatorInfo=await response.json();
      }catch(error){calculatorInfo={available:false,reason:error.message};}
    }
    el('manual').open=!calculatorInfo.available;render();return calculatorInfo;
  }
  async function codeHash(code) {
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code.replace(/\s/g,'')));
    return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function calculateImpact() {
    if(!state||calculating)return;
    const captured=state,rev=revision;
    if(!calculatorInfo)await refreshCalculator();
    if(captured!==state||rev!==revision)return;
    if(!calculatorInfo?.available){render();return;}
    calculationAbort?.abort();calculationAbort=new AbortController();
    const controller=calculationAbort,sequence=++calculationSequence;
    const key=buildKey([state.baseline,state.candidate]),skillGroup=state.calculationSkill??null;
    calculating=true;render();status('Calculating damage and survivability with PoB2…');
    try{
      const [baseline,candidate]=await Promise.all([exported(clone(state.baseline)),exported(clone(state.candidate))]);
      if(sequence!==calculationSequence||rev!==revision)return;
      let response;
      for(let attempt=0;attempt<4;attempt++){
        if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
        response=await fetch(new URL('pob2-calculate',document.baseURI),{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({baselineCode:baseline.code,candidateCode:candidate.code,skillGroup})});
        if(response.status!==429||attempt===3)break;
        await response.text();await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
      }
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Calculation failed.');
      const hashes=await Promise.all([codeHash(baseline.code),codeHash(candidate.code)]);
      if(payload.inputHashes?.baseline!==hashes[0]||payload.inputHashes?.candidate!==hashes[1])throw new Error('Calculation inputs did not match this comparison. Calculate again.');
      if(sequence!==calculationSequence||rev!==revision||key!==buildKey([state.baseline,state.candidate]))return;
      if(payload.baseline?.skillGroup!==payload.candidate?.skillGroup)throw new Error('PoB2 selected different skills for the two builds. Choose a common skill and calculate again.');
      const next=clone(state);
      for(const side of ['baseline','candidate']){
        const value=payload[side];
        if(!value?.stats||!Object.values(value.stats).every(Number.isFinite)||typeof value.skill!=='string')throw new Error('The calculator returned invalid results.');
        next[side+'Result']={stats:value.stats,skill:value.skill,skillGroup:value.skillGroup,receivedAt:new Date().toISOString(),native:true,engineVersion:payload.engine.version,engineIdentity:payload.engine.identity};
      }
      next.calculationSkills=payload.candidate.skills||[];
      next.calculationSkill=payload.candidate.skillGroup;
      localStorage.setItem(KEY,JSON.stringify(next));state=next;
      el('skill').innerHTML=next.calculationSkills.map(s=>`<option value="${Number(s.index)}">${esc(s.name)}</option>`).join('');el('skill').value=String(next.calculationSkill);
      status('Impact updated · '+payload.candidate.skill+' · PoB2 '+payload.engine.version+'.');
    }catch(error){if(sequence===calculationSequence&&error.name!=='AbortError')status(error.message,true);}
    finally{if(sequence===calculationSequence){calculating=false;render();}}
  }
  function init() {
    el('start').onclick=start;el('preview').onclick=()=>preview();el('try').onclick=()=>preview(true);el('apply').onclick=apply;
    el('calculate').onclick=async()=>{await refreshCalculator();if(!calculatorInfo?.available)status(calculatorInfo?.reason||'Use the manual PoB2 tools.',true);else void calculateImpact();};
    el('skill').onchange=()=>{if(!state)return;const next=clone(state);next.calculationSkill=Number(el('skill').value);next.baselineResult=null;next.candidateResult=null;try{persist(next);void calculateImpact();}catch(error){status(error.message,true);}};
    el('undo').onclick=()=>undo();el('reset').onclick=()=>undo(true);el('slot').onchange=renderGear;
    el('export').onclick=()=>prepareExport();el('export-original').onclick=()=>prepareExport('baseline');el('open').onclick=openCandidate;
    el('capture').onclick=captureCandidate;
    el('check-result').onclick=previewReturn;el('adopt-result').onclick=adoptResult;
    el('request').oninput=()=>{proposal=null;el('proposal').hidden=true;el('apply').disabled=true;};
    el('result-code').oninput=el('result-side').onchange=()=>{invalidate();render();};
    el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('export-code').value);status('PoB2 code copied. Paste it into PoB2.');}catch{el('export-code').select();status('Select and copy the code with Ctrl+C.');}};
    try {
      const saved=JSON.parse(localStorage.getItem(KEY)||'null');
      if(saved) {
        if(saved.version!==1||!saved.baseline?.originalPobCode||!saved.candidate?.originalPobCode||!Array.isArray(saved.history))throw new Error('Invalid saved comparison');
        state=saved;state.history=state.history.slice(-10);
      }
    }catch{status('The saved comparison could not be restored. Your Optimizer build is unchanged; start a new comparison.',true);}
    render();
    if(state?.calculationSkills){el('skill').innerHTML=state.calculationSkills.map(s=>`<option value="${Number(s.index)}">${esc(s.name)}</option>`).join('');el('skill').value=String(state.calculationSkill);}
    void refreshCalculator().then(()=>calculateImpact());
  }
  // Expose only page integration hooks; the candidate stays private to this workspace.
  window.ForgeWorkshop={refresh};
  init();
})();
