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
      // 4) program-level safety on the default 10x10x10 stage: no clipping, no DC, sane level,
      //    and the 9-box rig must stay under the ceiling too
      const program=async seconds=>{
        if(playing.length)stopPb();
        AC=new OfflineAudioContext(2,Math.ceil(48000*seconds),48000);
        buf=AC.createBuffer(2,AC.length,48000);
        for(let ch=0;ch<2;ch++){const a=buf.getChannelData(ch);
          for(let i=0;i<a.length;i++){const t=i/48000;
            a[i]=0.32*(Math.sin(2*Math.PI*110*t)+0.5*Math.sin(2*Math.PI*440*t)+0.25*Math.sin(2*Math.PI*3000*t))/1.75
              +0.08*Math.sin(2*Math.PI*55*t)*Math.exp(-((t%0.5)*6));}}
        return AC;};
      const measure=async out=>{let peak=0,sum=0,dc=0,n=0;
        for(const ch of[0,1]){const a=out.getChannelData(ch);
          for(let i=0;i<a.length;i++){const v=a[i];if(Math.abs(v)>peak)peak=Math.abs(v);sum+=v*v;dc+=v;n++;}}
        return {peak,rms:Math.sqrt(sum/n),dc:Math.abs(dc/n)};};
      // default two-box rig, app defaults (10x10x10, walls on, 5% verb, master 0.9)
      AC=await program(2);
      room={w:10,l:10,h:10};listener.x=5;listener.y=5;listener.yaw=0;listener.pitch=0;
      sps=[{x:2,y:2,h:1.6,v:1,ch:'L',band:'Full'},{x:8,y:2,h:1.6,v:1,ch:'R',band:'Full'}];
      furniture.length=0;$('hq').checked=false;$('mvol').value=0.9;$('walls').checked=true;$('roomAmt').value=0.05;
      startPb(0);
      const two=await measure(await AC.startRendering());
      // 9-box rig (4 fulls + 4 tweeters + sub), precise engine
      AC=await program(2);
      $('hq').checked=true;
      $('stage8').onclick.call($('stage8'));
      startPb(0);
      const nine=await measure(await AC.startRendering());
      return {rel,stepDb,aliasDb,two,nine};
    });
    console.log('rel to 1kHz (dB):',m.rel,'| step:',m.stepDb.toFixed(2),'dB | alias@3k:',m.aliasDb.toFixed(1),'dB');
    for(const f of['100','10000','14000'])assert(Math.abs(m.rel[f])<1.5,`${f}Hz deviates ${m.rel[f].toFixed(2)}dB`);
    assert(Math.abs(m.stepDb-20)<0.5,`nonlinear: 20dB in became ${m.stepDb.toFixed(2)}dB out`);
    assert(m.aliasDb<-30,`clip aliases only ${m.aliasDb.toFixed(1)}dB below fundamental`);
    for(const [name,r] of[['two-box',m.two],['9-box precise',m.nine]]){
      assert(r.peak<=0.9501,`${name} clips: peak ${r.peak.toFixed(3)}`);
      assert(r.rms>0.005&&r.rms<0.35,`${name} level out of range: rms ${r.rms.toFixed(4)}`);
      assert(r.dc<1e-3,`${name} DC offset ${r.dc.toExponential(2)}`);}
    console.log(`program: two-box peak ${m.two.peak.toFixed(3)} rms ${m.two.rms.toFixed(3)} | 9-box peak ${m.nine.peak.toFixed(3)} rms ${m.nine.rms.toFixed(3)}`);
    assert.deepEqual(errors,[]);
    console.log('PASS: flat passband, level-linear, no clip aliasing; program stays clean and unclipped on 2-box and 9-box rigs.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
