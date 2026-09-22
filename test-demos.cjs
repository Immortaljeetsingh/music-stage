const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
(async()=>{
  const server=spawn('python',['-m','http.server','8931'],{cwd:__dirname,stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const browser=await chromium.launch(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:8931/index.html');
    await page.waitForFunction(()=>document.querySelectorAll('#demo option').length===8);
    const options=await page.locator('#demo option').count();
    assert.equal(options,8,'seven demos listed');
    for(const id of ['71178','71068','46603','46258','70823','59581','40166']){
      await page.selectOption('#demo',id);
      await page.locator('#loadDemo').click();
      await page.waitForFunction(()=>!document.getElementById('loadDemo').disabled,null,{timeout:30000});
      assert(!(await page.locator('#stat').innerText()).includes('failed'),'demo load succeeded');
      const info=await page.evaluate(()=>{
        const len=stemBufs.vocals.length;
        const bad=['vocals','drums','bass','other'].filter(k=>{const b=stemBufs[k];return b.length!==len||b.numberOfChannels!==2||b.sampleRate!==AC.sampleRate;});
        if(buf.length!==len||buf.numberOfChannels!==2||buf.sampleRate!==AC.sampleRate)bad.push('mix');
        if(bad.length)throw new Error('bad stems: '+bad.join(','));
        return {len,room:JSON.stringify(room),sps:sps.length,precise:$('hq').checked,credit:$('demoCredit').innerText,solo:!$('demoSolo').hidden,
          energies:['vocals','drums','bass','other'].map(k=>{const d=stemBufs[k].getChannelData(0);let s=0;for(let i=0;i<d.length;i+=16)s+=d[i]*d[i];return Math.sqrt(s/(d.length/16));})};
      });
      assert(info.sps===2&&info.precise&&!info.solo&&info.credit.includes('CC BY'),'mix rig loaded for '+id);
      assert(info.energies.every(v=>v>0.001),'all stems have energy '+id);
      await page.locator('#play').click();
      await page.waitForFunction(()=>{
        if(!anL||!anR)return false;
        return [anL,anR].every(an=>{const a=new Float32Array(an.fftSize);an.getFloatTimeDomainData(a);return Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length)>0.0005;});
      },null,{timeout:10000});
      await page.locator('#mapStems').click(); // separated rig is opt-in
      const rig=await page.evaluate(()=>({n:sps.length,stems:sps.map(s=>s.stem),solo:!$('demoSolo').hidden}));
      assert.equal(rig.n,4,'4-box stem rig for '+id);
      assert.deepEqual(rig.stems,['vocals','drums','other','bass'],'stem mapping for '+id);
      assert(rig.solo,'audition controls appear after Map stems');
      await page.locator('[data-solo=vocals]').click();
      const mutes=await page.evaluate(()=>sps.map(s=>s.mute));
      assert.deepEqual(mutes,[false,true,true,true],'vocals solo mutes others '+id);
      await page.locator('[data-solo=""]').click();
      const mutes2=await page.evaluate(()=>sps.map(s=>s.mute));
      assert.deepEqual(mutes2,[false,false,false,false],'all-parts unmutes '+id);
      await page.locator('#play').click();
      console.log(id,'ok',info.credit.split(' — ')[0],info.energies.map(v=>v.toFixed(3)).join('/'));
    }
    assert.deepEqual(errors,[],'no page errors');
    console.log('PASS: seven demo bundles load as original mix, map to stem rig, solo correctly, with attribution.');
  }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
