const assert=require('node:assert/strict');
const {createServer}=require('./server.cjs');
const {closeServer,launchBrowser,listen}=require('./test-helpers.cjs');

(async()=>{
  const server=createServer(),base=await listen(server);let browser;
  try{
    browser=await launchBrowser();
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/index.html');
    const loaded=await page.evaluate(async()=>{
      AC=AC||new (window.AudioContext||window.webkitAudioContext)();const N=4410,left=new Float32Array(N).fill(.1),right=new Float32Array(N).fill(.1);
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('stage',2);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('stems'))request.result.createObjectStore('stems');if(!request.result.objectStoreNames.contains('meta'))request.result.createObjectStore('meta');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise((resolve,reject)=>{const request=db.transaction('stems','readwrite').objectStore('stems').put({name:'Legacy test',rate:44100,vocals:{l:left,r:right},drums:{l:left,r:right},bass:{l:left,r:right},other:{l:left,r:right}},'set1');request.onsuccess=resolve;request.onerror=()=>reject(request.error);});db.close();stemBufs={};stemNames=[];await loadStemsFromCache();return {rate:AC.sampleRate,names:stemNames,duration:stemBufs.vocals?+stemBufs.vocals.duration.toFixed(3):0,title:currentTrack.title};
    });
    assert.equal(loaded.names.length,4,'all four legacy stems load');assert(Math.abs(loaded.duration-.1)<.01,'duration preserved across sample rates');assert.equal(loaded.title,'Legacy test');assert.deepEqual(errors,[]);

    const stemPage=await browser.newPage();const stemErrors=[],requests=[];stemPage.on('pageerror',error=>stemErrors.push(error.message));stemPage.on('request',request=>requests.push(request.url()));
    await stemPage.route('**/onnxruntime-web@1.20.0/dist/ort.bundle.min.mjs',route=>route.fulfill({contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:'export const env={wasm:{}}; export class InferenceSession{}; export class Tensor{};'}));
    await stemPage.route('**/demucs-web@1.0.2/src/index.js',route=>route.fulfill({contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:"export class DemucsProcessor{}; export const CONSTANTS={DEFAULT_MODEL_URL:'https://example.invalid/model.onnx'};"}));
    await stemPage.goto(base+'/stems.html');await stemPage.waitForFunction(()=>document.querySelector('#runtimeBadge').textContent!=='Runtime checking…');
    assert(requests.some(url=>url.includes('/onnxruntime-web@1.20.0/dist/ort.bundle.min.mjs')),'correct ONNX module requested');assert.equal(await stemPage.locator('#bar').getAttribute('max'),'1');assert.equal(await stemPage.locator('#stat').getAttribute('aria-live'),'polite');assert(await stemPage.getByRole('button',{name:'Separate track'}).isDisabled());assert.deepEqual(stemErrors,[],'stem tool initializes without page errors');
    console.log(`PASS: legacy ${loaded.rate}Hz stem cache loads with correct duration; hardened stem UI initializes.`);
  }finally{if(browser)await browser.close();await closeServer(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
