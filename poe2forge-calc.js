'use strict';
// Optional Windows calculation companion. Inputs/results remain on loopback.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function discover(env=process.env){
  if(process.platform!=='win32')return {available:false,reason:'Automatic calculation currently requires Windows PoB2 and 64-bit Python.'};
  const executable=env.POB2_PATH||path.join(env.APPDATA||'','Path of Building Community (PoE2)','Path of Building-PoE2.exe');
  const pob=path.dirname(executable),exists=p=>{try{return fs.statSync(p).isFile();}catch{return false;}};
  if(!exists(executable)||!exists(path.join(pob,'lua51.dll'))||!exists(path.join(pob,'Modules/Build.lua')))return {available:false,reason:'Install PoB2, or set POB2_PATH to its executable in the local server .env.'};
  let python=env.POB2_PYTHON;
  if(!python){
    const base=path.join(env.LOCALAPPDATA||'','Programs/Python');
    try{python=fs.readdirSync(base).filter(n=>/^Python\d+$/.test(n)).sort().reverse().map(n=>path.join(base,n,'python.exe')).find(exists);}catch{}
  }
  if(!python||!path.isAbsolute(python)||!exists(python))return {available:false,reason:'Install 64-bit Python 3, or set POB2_PYTHON to python.exe in the local server .env.'};
  try{
    const manifest=fs.readFileSync(path.join(pob,'manifest.xml'),'utf8');
    const version=manifest.match(/<Version\b[^>]*\bnumber="([^"]+)"/)?.[1]||'installed';
    return {available:true,pob,python,version,identity:hash(manifest)};
  }catch{return {available:false,reason:'PoB2 installation metadata is missing. Finish its installation first.'};}
}
function runNative(config,xml,skillGroup,signal,root){
  return new Promise((resolve,reject)=>{
    const childEnv={};
    for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])childEnv[key]=process.env[key];
    const child=spawn(config.python,['-I',path.join(root,'tools/pob2/worker.py'),config.pob],{cwd:root,windowsHide:true,env:childEnv,stdio:['pipe','pipe','pipe']});
    let output='',errors='',finished=false;
    const done=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child.kill();done(new Error('Calculation cancelled.'));};
    const timer=setTimeout(()=>{child.kill();done(new Error('PoB2 calculation timed out. Try again or use the manual tools.'));},20000);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.on('error',()=>done(new Error('Could not start the local PoB2 calculator. Check the Python and PoB2 paths.')));
    child.stdout.on('data',data=>{output+=data.toString('utf8');if(output.length>1000000){child.kill();done(new Error('Calculator output exceeded its limit.'));}});
    child.stderr.on('data',data=>{errors=(errors+data.toString('utf8')).slice(0,3000);});
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      if(finished)return;
      try{
        const result=JSON.parse(output);
        if(code!==0||result.error)throw new Error(result.error||'PoB2 calculation failed.');
        if(!result.stats||!Object.values(result.stats).every(Number.isFinite)||!Number.isInteger(result.skillGroup))throw new Error('Invalid calculator result.');
        done(null,result);
      }catch(error){done(new Error(output.trim().startsWith('{')?error.message:'The local calculator could not load this build. '+errors.slice(0,400)));}
    });
    child.stdin.end(JSON.stringify({xml,skillGroup}));
  });
}
function decode(code){
  if(typeof code!=='string'||code.length>1500000)throw new Error('A PoB2 code must be at most 1.5 MB.');
  const clean=code.replace(/\s/g,'');
  if(!/^[A-Za-z0-9_+\/-]+={0,2}$/.test(clean))throw new Error('Invalid PoB2 code.');
  let xml;
  try{xml=zlib.inflateSync(Buffer.from(clean,'base64url'),{maxOutputLength:16000000}).toString('utf8');}catch{throw new Error('The PoB2 code could not be decompressed within the size limit.');}
  if(!/<PathOfBuilding2[\s>]/.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('A complete PoB2 XML build without document declarations is required.');
  return {xml,codeHash:hash(clean)};
}
function createCalculator({port,root=__dirname,configuration=()=>discover(),worker=runNative}={}){
  const hosts=new Set([`localhost:${port}`,`127.0.0.1:${port}`]),origins=new Set([...hosts].map(h=>'http://'+h));
  const cache=new Map();let occupied=false;
  const send=(res,status,body)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  async function calculate(body,signal){
    const config=configuration();if(!config.available)throw new Error(config.reason);
    const skill=body.skillGroup??null;
    if(skill!==null&&(!Number.isInteger(skill)||skill<1||skill>200))throw new Error('Invalid calculation skill.');
    const inputs={baseline:decode(body.baselineCode),candidate:decode(body.candidateCode)};
    const result={engine:{version:config.version,identity:config.identity},inputHashes:{}};
    for(const side of ['baseline','candidate']){
      if(signal.aborted)throw new Error('Calculation cancelled.');
      const input=inputs[side],key=hash(config.identity+'\n'+skill+'\n'+input.xml);
      result.inputHashes[side]=input.codeHash;
      let value=cache.get(key);
      if(!value){
        value=await worker(config,input.xml,skill,signal,root);
        if(signal.aborted)throw new Error('Calculation cancelled.');
        cache.set(key,value);while(cache.size>16)cache.delete(cache.keys().next().value);
      }
      result[side]=value;
    }
    const current=configuration();
    if(!current.available||current.identity!==config.identity)throw new Error('PoB2 updated during calculation. Calculate again with the new version.');
    return result;
  }
  function handle(req,res,pathname){
    if(!['/pob2-calculator','/pob2-calculate'].includes(pathname))return false;
    const trusted=origins.has(req.headers.origin);
    if(!hosts.has(req.headers.host)||(req.headers.origin&&!trusted)||(req.headers['sec-fetch-site']==='cross-site'&&!trusted)) {send(res,403,{error:'Calculator accepts only the local Forge page.'});return true;}
    if(trusted){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
    if(pathname==='/pob2-calculator'&&req.method==='GET'){
      const config=configuration();send(res,200,config.available?{available:true,version:config.version,identity:config.identity}:{available:false,reason:config.reason});return true;
    }
    if(pathname!=='/pob2-calculate'||req.method!=='POST'){send(res,405,{error:'Method not allowed.'});return true;}
    if(!trusted){send(res,403,{error:'Calculation requires a trusted browser Origin.'});return true;}
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){send(res,415,{error:'JSON input required.'});return true;}
    if(occupied){send(res,429,{error:'A calculation is finishing. Try again in a moment.'});return true;}
    if(Number(req.headers['content-length'])>4000000){send(res,413,{error:'Calculation request is too large.'});return true;}
    const controller=new AbortController();let chunks=[],bytes=0,ended=false;
    occupied={};const job=occupied;
    const release=()=>{if(occupied===job)occupied=false;};
    const receiveTimer=setTimeout(()=>{if(!ended){ended=true;controller.abort();send(res,408,{error:'Calculation input timed out.'});release();}},10000);
    req.on('data',data=>{if(ended)return;bytes+=data.length;if(bytes>4000000){ended=true;clearTimeout(receiveTimer);chunks=[];send(res,413,{error:'Calculation request is too large.'});release();}else chunks.push(data);});
    req.on('aborted',()=>{ended=true;clearTimeout(receiveTimer);controller.abort();release();});
    req.on('error',()=>{ended=true;clearTimeout(receiveTimer);controller.abort();release();});
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    req.on('end',async()=>{
      clearTimeout(receiveTimer);if(ended)return;ended=true;
      try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object')throw new Error('Invalid request.');const result=await calculate(body,controller.signal);send(res,200,result);}
      catch(error){send(res,400,{error:error.message});}finally{chunks=[];release();}
    });
    return true;
  }
  return {handle};
}
module.exports={createCalculator,discover,decode};
