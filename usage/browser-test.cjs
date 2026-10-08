// Local cryptographic compatibility test. No key/ciphertext in process arguments.
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const path=require('node:path');
(async()=>{
const {makeScratch,browserPayload}=await import('./test-fixture.mjs');
const {encryptPayload,validatePayload}=await import('./collect.mjs');
const {dir,cleanup}=makeScratch('aimf-usage-browser-');
try {
const {chromium,webkit,devices}=require(process.env.AIMF_TEST_PLAYWRIGHT||'playwright');
// Real-artifact compatibility is explicit opt-in; the default is independent.
const base=process.env.AIMF_TEST_ARTIFACT_DIR;
const plain=base?JSON.parse(fs.readFileSync(path.join(base,'usage-real.local.json'))):browserPayload();
const key=base?fs.readFileSync(path.join(base,'usage-real.testkey'),'utf8').trim():crypto.randomBytes(32).toString('base64url');
validatePayload(plain);
const envelope=base?JSON.parse(fs.readFileSync(path.join(base,'usage-real.enc.json'))):encryptPayload(plain,Buffer.from(key,'base64url'));
const json=JSON.stringify(plain),expected=crypto.createHash('sha256').update(json).digest('hex');
function fixture(text,withAAD){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'base64url'),iv);
  if(withAAD)cipher.setAAD(Buffer.from('aimf-usage-enc/1|A256GCM|gzip'));
  const ct=Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(text))),cipher.final(),cipher.getAuthTag()]);
  return {schema:'aimf-usage-enc/1',alg:'A256GCM',zip:'gzip',iv:iv.toString('base64url'),ct:ct.toString('base64url')};
}
const withoutAAD=fixture(json,false),oversized=fixture(json+' '.repeat(8*1024*1024-Buffer.byteLength(json)+1),true);
const html=fs.readFileSync(__dirname+'/decrypt-test.html');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port,reports=[];
  try {
    for(const scenario of [
      {name:'chromium-desktop-light',type:chromium,opts:{viewport:{width:1280,height:900},colorScheme:'light'}},
      {name:'chromium-desktop-dark',type:chromium,opts:{viewport:{width:1100,height:800},colorScheme:'dark'}},
      {name:'webkit-iphone',type:webkit,opts:{...devices['iPhone 12 Pro']}},
    ]) {
      const browser=await scenario.type.launch({headless:true,downloadsPath:dir});
      try {
        const context=await browser.newContext(scenario.opts),page=await context.newPage();let errors=0;
        page.on('pageerror',()=>errors++);page.on('console',msg=>{if(msg.type()==='error')errors++;});await page.goto(url);
        const result=await page.evaluate(async({envelope,key,withoutAAD,oversized})=>{
          const result=await decryptUsage(envelope,key);
          const encode=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
          const bad=decode(key);bad[0]^=1;
          const corrupted=decode(envelope.ct);corrupted[0]^=1;
          const reject=async(e,k)=>{try{await decryptUsage(e,k);return '';}catch(error){return error.name+':'+error.message;}};
          const wrongKey=await reject(envelope,encode(bad));
          const tampered=await reject({...envelope,ct:encode(corrupted)},key);
          const missingAAD=await reject(withoutAAD,key);
          const badAlg=await reject({...envelope,alg:'none'},key);
          const badZip=await reject({...envelope,zip:'none'},key);
          const overCap=await reject(oversized,key);
          document.getElementById('result').textContent='PASS — WebCrypto AES-256-GCM + AAD + gzip\n'+result.days+' local days · '+result.models+' models · '+result.rows+' aggregate rows\nAuthentication, pinned metadata and 8 MiB cap checked.';
          return {...result,wrongKey,tampered,missingAAD,badAlg,badZip,overCap};
        },{envelope,key,withoutAAD,oversized});
        assert.equal(result.digest,expected);
        for(const name of ['wrongKey','tampered','missingAAD'])assert.match(result[name],/^OperationError:/);
        assert.match(result.badAlg,/Unexpected envelope/);assert.match(result.badZip,/Unexpected envelope/);assert.match(result.overCap,/exceeds 8 MiB/);assert.equal(errors,0);
        await page.reload();const again=await page.evaluate(async({envelope,key})=>decryptUsage(envelope,key),{envelope,key});assert.equal(again.digest,expected);
        reports.push({browser:scenario.name,passed:true,days:result.days,models:result.models,rows:result.rows,aad:true,cap:true,consoleErrors:errors});
        await context.close();
      } finally {await browser.close();}
    }
  } finally {server.close();}
  console.log(JSON.stringify(reports,null,2));
} finally {cleanup();}
})().catch(()=>{console.error('Browser decryption check failed; details suppressed');process.exitCode=1;});
