const assert=require('node:assert/strict'),http=require('node:http'),zlib=require('node:zlib');
const {createCalculator}=require('../poe2forge-calc');
const encode=xml=>zlib.deflateSync(xml).toString('base64url');
const xml='<PathOfBuilding2><Build level="62"/></PathOfBuilding2>';
let config={available:true,version:'fixture',identity:'fixture-engine'},calls=0,delay=false,release;
const results=[];let server,base,calculator;
async function test(name,run){try{await run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.stack});}}
function request(route,options={}){const method=options.method||'POST';return fetch(base+route,{method,headers:{Origin:base,'Content-Type':'application/json',...options.headers},...(method==='GET'?{}:{body:options.raw??JSON.stringify(options.body??{baselineCode:encode(xml),candidateCode:encode(xml)})})});}
function rawRequest(headers,body='{}'){return new Promise((resolve,reject)=>{const req=http.request(base+'/pob2-calculate',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});req.on('error',reject);req.end(body);});}
(async()=>{
  server=http.createServer((req,res)=>calculator.handle(req,res,new URL(req.url,base).pathname));await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  calculator=createCalculator({port:server.address().port,configuration:()=>config,worker:async(_c,_xml,skill,signal)=>{calls++;if(delay)await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});return {stats:{Life:123,CombinedDPS:456},skill:'Fixture',skillGroup:skill||1,skills:[{index:1,name:'Fixture'}]};}});
  await test('Status reveals availability and version without executable paths',async()=>{const r=await request('/pob2-calculator',{method:'GET'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{available:true,version:'fixture',identity:'fixture-engine'});});
  await test('Foreign host and origin cannot calculate; missing Origin is refused',async()=>{
    assert.equal((await request('/pob2-calculate',{headers:{Origin:'https://evil.invalid'}})).status,403);
    assert.equal((await rawRequest({Host:'evil.invalid'})).status,403);
    assert.equal((await fetch(base+'/pob2-calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);assert.equal(calls,0);
  });
  await test('JSON, method, declared size and streamed size restrictions precede worker execution',async()=>{
    assert.equal((await request('/pob2-calculate',{method:'GET'})).status,405);
    assert.equal((await request('/pob2-calculate',{headers:{'Content-Type':'text/plain'}})).status,415);
    assert.equal((await request('/pob2-calculate',{raw:'x'.repeat(4000001)})).status,413);
    assert.equal((await rawRequest({'Transfer-Encoding':'chunked'},'x'.repeat(4000001))).status,413);assert.equal(calls,0);
  });
  await test('Malformed, oversized-inflation, entity and invalid skill inputs cannot run',async()=>{
    for(const body of [{baselineCode:'broken',candidateCode:'broken'},{baselineCode:encode(xml),candidateCode:encode(xml),skillGroup:201},{baselineCode:encode('<!DOCTYPE x [<!ENTITY a "b">]>'+xml),candidateCode:encode(xml)},{baselineCode:encode(' '.repeat(16000001)+xml),candidateCode:encode(xml)}])assert.equal((await request('/pob2-calculate',{body})).status,400);assert.equal(calls,0);
  });
  await test('Identical original/candidate calculates once and caches by input and skill',async()=>{
    let r=await request('/pob2-calculate');assert.equal(r.status,200);const result=await r.json();assert.equal(calls,1);assert.deepEqual(result.baseline,result.candidate);assert.match(result.inputHashes.baseline,/^[a-f0-9]{64}$/);
    await request('/pob2-calculate');assert.equal(calls,1);await request('/pob2-calculate',{body:{baselineCode:encode(xml),candidateCode:encode(xml),skillGroup:2}});assert.equal(calls,2);
  });
  await test('Engine updates invalidate old cache entries',async()=>{config={...config,identity:'updated-engine'};await request('/pob2-calculate');assert.equal(calls,3);});
  await test('Overlapping calculations are bounded and cannot release another request lock',async()=>{
    config={...config,identity:'slow-engine'};delay=true;const pending=request('/pob2-calculate');while(!release)await new Promise(r=>setTimeout(r,10));assert.equal((await request('/pob2-calculate')).status,429);delay=false;release();assert.equal((await pending).status,200);
  });
  await test('Unavailable engine gives an actionable response without spawning',async()=>{config={available:false,reason:'Install Python'};const before=calls,r=await request('/pob2-calculate');assert.equal(r.status,400);assert.match((await r.json()).error,/Install Python/);assert.equal(calls,before);});
  console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,total:results.length,results},null,2));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server?.close());
