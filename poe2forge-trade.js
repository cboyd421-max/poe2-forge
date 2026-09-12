/* Official trade UI links only. No listing requests, credentials, or messages.
 * Crossbow stat IDs checked against PoB2 0.23.1 Data/TradeSiteStats.lua.
 * Trade stat data (c) Grinding Gear Games. See tools/pob2/NOTICE.md.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ForgeTrade=api;
})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const definitions=[
    ['803737631','# to Accuracy Rating'],
    ['3261801346','# to Dexterity'],
    ['328541901','# to Intelligence'],
    ['1202301673','# to Level of all Projectile Skills'],
    ['4080418644','# to Strength'],
    ['681332047','#% increased Attack Speed'],
    ['387439868','#% increased Elemental Damage with Attacks'],
    ['1509134228','#% increased Physical Damage'],
    ['518292764','#% to Critical Hit Chance'],
    ['2223678961','Adds # to # Chaos damage'],
    ['1037193709','Adds # to # Cold Damage'],
    ['709508406','Adds # to # Fire Damage'],
    ['3336890334','Adds # to # Lightning Damage'],
    ['1940865751','Adds # to # Physical Damage'],
    ['3695891184','Gain # Life per enemy killed'],
    ['55876295','Leeches #% of Physical Damage as Life'],
    ['669069897','Leeches #% of Physical Damage as Mana']
  ];
  const definitionsByText=new Map(definitions.map(([id,text])=>[text.toLowerCase(),{id:'explicit.stat_'+id,text}]));
  function target(item,level){
    if(!item||!/^.+ Crossbow$/i.test(item.typeLine||'')||String(item.rarity).toLowerCase()!=='rare')throw new Error('Trade matching currently supports a rare crossbow.');
    if(!Number.isInteger(level)||level<1||level>100)throw new Error('Import a character with a valid level before searching.');
    const mapped=new Map(),skipped=[];
    const lines=(item.mods||[]).slice((item.implicits||[]).length);
    for(const raw of lines){
      const line=String(raw).trim();
      // Rune, enchant, and implicit effects must never masquerade as explicit mods.
      if(/[{}]/.test(line)){skipped.push(line);continue;}
      const values=(line.match(/[+-]?\d+(?:\.\d+)?/g)||[]).map(Number);
      const template=line.replace(/[+-]?\d+(?:\.\d+)?/g,'#').toLowerCase();
      const def=definitionsByText.get(template);
      if(!def||!values.length||values.some(n=>!Number.isFinite(n)||n<=0)||values.length>2){skipped.push(line);continue;}
      // The trade site compares the average of the two endpoints of added damage.
      const min=values.reduce((a,b)=>a+b,0)/values.length;
      const previous=mapped.get(def.id);
      if(previous){previous.min+=min;previous.line+='; '+line;}
      else mapped.set(def.id,{...def,min,line,essential:template==='# to level of all projectile skills'});
    }
    const filters=[...mapped.values()];
    if(!filters.length)throw new Error('No supported explicit crossbow stats to search.');
    return {base:item.typeLine,level,filters,skipped};
  }
  function search(item,level,{league,mode='target',budget='',currency='exalted'}={}){
    const selection=target(item,level);
    league=String(league||'').trim();
    if(!league||league.length>100||/[\x00-\x1f\x7f]/.test(league))throw new Error('Enter your trade league.');
    if(!['target','close'].includes(mode))throw new Error('Choose a valid search mode.');
    if(!['exalted','divine','chaos'].includes(currency))throw new Error('Choose a supported price currency.');
    const max=String(budget).trim()===''?null:Number(budget);
    if(max!==null&&(!Number.isFinite(max)||max<=0||max>1000000000))throw new Error('Use a positive maximum price, or leave it blank.');
    const filters={
      type_filters:{filters:{category:{option:'weapon.crossbow'},rarity:{option:'rare'}}},
      req_filters:{filters:{lvl:{max:level}}},
      trade_filters:{filters:{sale_type:{option:'priced'}}}
    };
    if(max!==null)filters.trade_filters.filters.price={max,option:currency};
    const statFilter=(f,ratio=1)=>({id:f.id,value:{min:ratio===1?f.min:Number((f.min*ratio).toFixed(2))},disabled:false});
    let stats;
    if(mode==='target')stats=[{type:'and',filters:selection.filters.map(f=>statFilter(f))}];
    else {
      const essential=selection.filters.filter(f=>f.essential),other=selection.filters.filter(f=>!f.essential);
      stats=[];
      if(essential.length)stats.push({type:'and',filters:essential.map(f=>statFilter(f))});
      if(other.length)stats.push({type:'count',value:{min:Math.max(1,Math.ceil(other.length*.6))},filters:other.map(f=>statFilter(f,.8))});
    }
    // Official trade's combined Instant Buyout + In Person mode.
    const query={query:{status:{option:'available'},stats,filters},sort:{price:'asc'}};
    if(mode==='target')query.query.type=selection.base;
    const url='https://www.pathofexile.com/trade2/search/poe2/'+encodeURIComponent(league)+'?q='+encodeURIComponent(JSON.stringify(query));
    return {url,query,selection};
  }
  return {target,search};
});
