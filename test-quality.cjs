const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {chromium}=require('playwright');
// Fidelity of the real startPb graph, rendered offline:
// 1) dry passband flat vs 1kHz, 2) level linearity (limiter must stay idle on normal program),
// 3) no alias products when a hot signal hits the output ceiling (4x oversampled shaper).
(async()=>{
  const browser=await chromium.launch(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
    const m=await page.evaluate(async()=>{
      const setup=({amp,freq,mvol,x=3,y=1})=>{
        if(playing.length)stopPb();
        AC=new OfflineAudioContext(2,48000,48000);
        buf=AC.createBuffer(2,48000,48000);
        for(let ch=0;ch<2;ch++)for(let i=0;i<48000;i++)buf.getChannelData(ch)[i]=amp*Math.sin(2*Math.PI*freq*i/48000);
        sps=[{x,y,h:1.6,v:1,ch:'M',band:'Full'}];
        room={w:6,l:8,h:3};listener.x=3;listener.y=4;listener.yaw=0;listener.pitch=0;
        furniture.length=0;TRIM={l:1,r:1};SWAP=false;
        $('hpdev').value='';$('hq').checked=false;$('width').value=1;$('walls').checked=false;
        $('roomAmt').value=0;$('mvol').value=String(mvol);$('air').checked=false;$('align').checked=true;
      };
      const run=async()=>{
        let seed=17;const random=Math.random;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
        try{startPb(0);}finally{Math.random=random;}
        return AC.startRendering();
      };
      const rms=(d,a,b)=>{let s=0;for(let i=a;i<b;i++)s+=d[i]*d[i];return Math.sqrt(s/(b-a));};
      const gz=(d,f)=>{const w=2*Math.PI*f/48000;let re=0,im=0;
        for(let i=12000;i<48000;i++){re+=d[i]*Math.cos(w*i);im+=d[i]*Math.sin(w*i);}return Math.hypot(re,im)/36000;};
      const flat={};let ref=0;
      for(const f of[100,1000,10000,14000]){setup({amp:0.15,freq:f,mvol:0.9});
        const d=(await run()).getChannelData(0),r=rms(d,36000,48000);if(f===1000)ref=r;flat[f]=r;}
      const rel={};for(const f in flat)rel[f]=20*Math.log10(flat[f]/ref);
      setup({amp:0.09,freq:1000,mvol:0.9});
      const lo=rms((await run()).getChannelData(0),36000,48000);
      setup({amp:0.9,freq:1000,mvol:0.9});
      const hi=rms((await run()).getChannelData(0),36000,48000);
      const stepDb=20*Math.log10(hi/lo);
      setup({amp:0.7,freq:15000,mvol:2.5,x:3,y:3.6}); // close + hot: forces ceiling clip
      const d=(await run()).getChannelData(0);
      const aliasDb=20*Math.log10(gz(d,3000)/gz(d,15000)); // 45k 3rd harmonic folds to 3k at 1x
      return {rel,stepDb,aliasDb};
    });
    console.log('rel to 1kHz (dB):',m.rel,'| step:',m.stepDb.toFixed(2),'dB | alias@3k:',m.aliasDb.toFixed(1),'dB');
    for(const f of['100','10000','14000'])assert(Math.abs(m.rel[f])<1.5,`${f}Hz deviates ${m.rel[f].toFixed(2)}dB`);
    assert(Math.abs(m.stepDb-20)<0.5,`nonlinear: 20dB in became ${m.stepDb.toFixed(2)}dB out`);
    assert(m.aliasDb<-30,`clip aliases only ${m.aliasDb.toFixed(1)}dB below fundamental`);
    assert.deepEqual(errors,[]);
    console.log('PASS: flat passband 100Hz-14kHz, level-linear (limiter idle), ceiling clip without aliasing.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
