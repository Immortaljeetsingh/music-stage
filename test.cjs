const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const {chromium} = require('playwright');
(async()=>{
  const browser=await chromium.launch(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
    const measurements=await page.evaluate(async()=>{
      const out=[];
      for(const band of ['Full','Bass','Tweeter'])for(const precise of [false,true]){
        if(playing.length)stopPb();
        AC=new OfflineAudioContext(2,48000,48000);
        buf=AC.createBuffer(2,48000,48000);
        const freq=band==='Tweeter'?6000:80;
        for(let ch=0;ch<2;ch++)for(let i=0;i<48000;i++)buf.getChannelData(ch)[i]=0.02*Math.sin(2*Math.PI*freq*i/48000);
        sps=[{x:1,y:1,h:1.6,v:1,ch:'L',band},{x:5,y:1,h:1.6,v:1,ch:'R',band}];
        room={w:6,l:8,h:3};listener.x=3;listener.y=4;listener.yaw=0;listener.pitch=0;
        furniture.length=0;TRIM={l:1,r:1};SWAP=false;
        $('hpdev').value='';$('hq').checked=precise;$('width').value=1;$('walls').checked=true;$('roomAmt').value=0.4;$('mvol').value=0.9;
        let seed=17;const random=Math.random;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
        try{startPb(0);}finally{Math.random=random;}
        const rendered=await AC.startRendering();
        const rms=ch=>{let sum=0;const d=rendered.getChannelData(ch);for(let i=24000;i<48000;i++)sum+=d[i]*d[i];return Math.sqrt(sum/24000);};
        const l=rms(0),r=rms(1);out.push({band,precise,l,r,imbalanceDb:20*Math.log10(l/r)});
      }
      return out;
    });
    console.log(measurements);
    for(const m of measurements)assert(Math.abs(m.imbalanceDb)<0.1,`${m.band}, precise=${m.precise}: ${m.imbalanceDb} dB bias`);
    assert.deepEqual(errors,[]);
    console.log('PASS: centered bass/treble symmetry in both engines with room reflections.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
