const assert=require('node:assert/strict');
const trade=require('../poe2forge-trade.js'),results=[];
function test(name,fn){try{fn();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.stack});process.exitCode=1;}}
const item={rarity:'rare',typeLine:'Twin Crossbow',implicits:['Loads an additional bolt'],mods:['Loads an additional bolt','{enchant}{rune}36% increased Physical Damage','154% increased Physical Damage','Adds 44 to 75 Physical Damage','Adds 97 to 149 Fire Damage','+4.4% to Critical Hit Chance','+4 to Level of all Projectile Skills','+27 to Dexterity']};
const opts={league:'Forbidden Rites'};
test('Target requires all six explicit stats, same base and character level, without rune double-counting',()=>{
  const {query,selection}=trade.search(item,62,opts);
  assert.deepEqual(query.query.status,{option:'available'});
  assert.equal(query.query.type,'Twin Crossbow');assert.equal(query.query.filters.req_filters.filters.lvl.max,62);
  assert.deepEqual(query.query.stats,[{type:'and',filters:[
    ['1509134228',154],['1940865751',59.5],['709508406',123],['518292764',4.4],['1202301673',4],['3261801346',27]
  ].map(([id,min])=>({id:'explicit.stat_'+id,value:{min},disabled:false}))}]);
  assert.equal(selection.skipped.length,1);assert.equal(query.query.filters.trade_filters.filters.price,undefined);
});
test('Close matches retain projectile levels and level cap, broaden base and require three of five softer stats',()=>{
  const {query}=trade.search(item,62,{...opts,mode:'close'});
  assert.deepEqual(query.query.status,{option:'available'});
  assert.equal(query.query.type,undefined);assert.equal(query.query.filters.type_filters.filters.category.option,'weapon.crossbow');
  assert.equal(query.query.filters.req_filters.filters.lvl.max,62);
  assert.deepEqual(query.query.stats[0],{type:'and',filters:[{id:'explicit.stat_1202301673',value:{min:4},disabled:false}]});
  assert.equal(query.query.stats[1].type,'count');assert.equal(query.query.stats[1].value.min,3);
  assert.deepEqual(query.query.stats[1].filters.map(f=>f.value.min),[123.2,47.6,98.4,3.52,21.6]);
});
test('Price and currency are explicit and searches sort by price',()=>{
  for(const currency of ['divine','exalted','chaos']){
    const {query}=trade.search(item,62,{...opts,budget:'2.5',currency});
    assert.deepEqual(query.query.filters.trade_filters.filters.price,{max:2.5,option:currency});
    assert.deepEqual(query.sort,{price:'asc'});
  }
});
test('URL safely encodes league and includes only search data',()=>{
  const league='Hardcore / Test?x=1#"';const {url,query}=trade.search(item,62,{league});const parsed=new URL(url);
  assert.equal(parsed.origin,'https://www.pathofexile.com');assert.equal(parsed.pathname,'/trade2/search/poe2/'+encodeURIComponent(league));
  assert.deepEqual(JSON.parse(parsed.searchParams.get('q')),query);assert.deepEqual([...parsed.searchParams.keys()],['q']);
  assert.equal(parsed.hash,'');assert.ok(!url.includes('originalPobCode'));
});
test('Invalid league, price, currency, level and unsupported equipment are rejected',()=>{
  for(const value of ['', 'A\nB','x'.repeat(101)])assert.throws(()=>trade.search(item,62,{league:value}),/league/);
  for(const budget of ['-1','0','NaN','Infinity','1000000001'])assert.throws(()=>trade.search(item,62,{...opts,budget}),/price/);
  assert.throws(()=>trade.search(item,62,{...opts,currency:'invalid'}),/currency/);
  for(const level of [0,101,NaN,62.5])assert.throws(()=>trade.search(item,level,opts),/level/);
  assert.throws(()=>trade.search({...item,typeLine:'Bow'},62,opts),/crossbow/);
  assert.throws(()=>trade.search({...item,rarity:'unique'},62,opts),/crossbow/);
});
test('Unknown, negative, rune and enchant lines are disclosed and never guessed',()=>{
  const t=trade.target({...item,implicits:[],mods:['{rune}20% increased Physical Damage','{enchant}20% increased Physical Damage','-4 to Level of all Projectile Skills','50% reduced Attack Speed','Unmapped special effect','+4 to Level of all Projectile Skills']},62);
  assert.equal(t.filters.length,1);assert.equal(t.skipped.length,5);
  assert.throws(()=>trade.target({...item,implicits:[],mods:['Unmapped special effect']},62),/No supported/);
});
test('Hybrid lines sharing a stat aggregate once and preserve exact decimal target values',()=>{
  const {query}=trade.search({...item,implicits:[],mods:['130% increased Physical Damage','24% increased Physical Damage','Leeches 7.11% of Physical Damage as Mana']},62,opts);
  assert.equal(query.query.stats[0].filters.length,2);assert.equal(query.query.stats[0].filters[0].value.min,154);assert.equal(query.query.stats[0].filters[1].value.min,7.11);
});
test('Single-stat targets produce valid close searches without empty groups',()=>{
  for(const mod of ['+4 to Level of all Projectile Skills','130% increased Physical Damage']){
    const {query}=trade.search({...item,implicits:[],mods:[mod]},62,{...opts,mode:'close'});
    assert.equal(query.query.stats.length,1);assert.equal(query.query.stats[0].filters.length,1);
  }
});
console.log(JSON.stringify({status:process.exitCode?'FAIL':'PASS',checks:results.length,results},null,2));
