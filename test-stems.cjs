const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
  const server=spawn('python',['-m','http.server','8933'],{cwd:__dirname,stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const browser=await chromium.launch(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:8933/index.html');
    const r=await page.evaluate(async()=>{
      AC=AC||new (window.AudioContext||window.webkitAudioContext)();
      const N=4410,l=new Float32Array(N).fill(0.1),r2=new Float32Array(N).fill(0.1);
      const db=await new Promise((res,rej)=>{const q=indexedDB.open('stage',1);
        q.onupgradeneeded=()=>q.result.createObjectStore('stems');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
      await new Promise((res,rej)=>{const t=db.transaction('stems','readwrite').objectStore('stems')
        .put({name:'t',rate:44100,vocals:{l,r:r2},drums:{l,r:r2},bass:{l,r:r2},other:{l,r:r2}},'set1');
        t.onsuccess=res;t.onerror=()=>rej(t.error);});
      stemBufs={};stemNames=[];await loadStemsFromCache();
      return {rate:AC.sampleRate,names:stemNames,dur:stemBufs.vocals?+stemBufs.vocals.duration.toFixed(3):0};
    });
    assert.equal(r.names.length,4,'all four stems load at '+r.rate+'Hz');
    assert(Math.abs(r.dur-0.1)<0.01,'duration preserved after resample: '+r.dur+'s');
    assert.deepEqual(errors,[],'no browser errors');
    console.log('PASS: cached 44.1k stems load with correct duration at '+r.rate+'Hz context.');
  }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
