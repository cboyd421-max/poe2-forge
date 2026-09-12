// Exercise the production static-file handler without opening sockets or .env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
let handler;
const server = {listen(){},on(){}};
const modules = {http:{createServer(fn){handler=fn;return server;}},https:{request(){throw new Error('Unexpected upstream request');}},fs:{readFileSync(){return '';},readFile:fs.readFile},path,child_process:{spawn(){throw new Error('Unexpected process launch');}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'poe2forge-proxy.js'),'utf8'),{require:name=>modules[name],__dirname:root,process:{env:{}},console:{log(){},error(){}},URL});
function request(url,headers={}) {
  return new Promise(resolve=>{
    const result={headers:{}};
    const res={setHeader(k,v){result.headers[k.toLowerCase()]=v;},writeHead(status,headers={}){result.status=status;Object.entries(headers).forEach(([k,v])=>result.headers[k.toLowerCase()]=v);},end(body=''){result.body=body.toString();resolve(result);}};
    handler({url,method:'GET',headers:{host:'localhost:3001',...headers}},res);
  });
}
(async()=>{
  let checks=0;
  for(const file of ['poe2forge-planner.js','poe2forge-planner-data.json','poe2forge-workshop.js','poe2forge-trade.js','poe2forge-workshop.css']) {
    const r=await request('/'+file);assert.equal(r.status,200);assert.equal(r.body,fs.readFileSync(path.join(root,file),'utf8'));assert.match(r.headers['content-type'],file.endsWith('.js')?/javascript/:file.endsWith('.css')?/css/:/json/);checks++;
  }
  for(const file of ['poe2forge-proxy.js','poe2forge-calc.js','tools/pob2/worker.py','tools/pob2/calculate.lua','tools/pob2/optimize.lua','tests/game-planner.cjs','tools/build-planner-catalog.cjs','another.json','poe2forge-planner-data.json.bak']) {assert.equal((await request('/'+file)).status,404);checks++;}
  for(const url of ['/.env','/.git/config','/%2e%2e%2fpoe2forge-planner.js']) {assert.equal((await request(url)).status,403);checks++;}
  assert.equal((await request('/poe2forge-planner.js',{host:'evil.example'})).status,403);checks++;
  assert.equal((await request('/poe2forge-planner-data.json',{origin:'https://evil.example'})).status,403);checks++;
  console.log(JSON.stringify({status:'PASS',checks,scope:'Production allowlist, file bytes/MIME, host/origin gates and private path rejection'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
