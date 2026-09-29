const assert=require('node:assert/strict');
const {createServer}=require('./server.cjs');
const {closeServer,launchBrowser,listen}=require('./test-helpers.cjs');

(async()=>{
  const server=createServer(),base=await listen(server);let browser;
  try{
    browser=await launchBrowser();
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/index.html');
    await page.waitForFunction(()=>document.querySelectorAll('#demo option').length===8);
    const go=async tab=>page.locator('.tab[data-tab='+tab+']').click();
    const open=async selector=>{const group=page.locator('details.group:has('+selector+')');if(await group.count()&&!await group.evaluate(element=>element.open))await group.locator('summary').click();};
    assert.equal(await page.locator('#demo option').count(),8,'seven demos listed');
    for(const id of ['71178','71068','46603','46258','70823','59581','40166']){
      await go('source');await open('#loadDemo');await page.selectOption('#demo',id);await page.locator('#loadDemo').click();
      await page.waitForFunction(()=>!document.getElementById('loadDemo').disabled&&document.getElementById('playerState').dataset.state==='ready',null,{timeout:30000});
      const mix=await page.evaluate(()=>({stems:stemNames.length,boxes:sps.length,precise:$('hq').checked,mode:$('renderMode').value,credit:$('demoCredit').innerText,solo:!$('demoSolo').hidden,map:getComputedStyle($('mapStems')).display,current:currentTrack.title,player:$('trackTitle').textContent}));
      assert.deepEqual({stems:mix.stems,boxes:mix.boxes,precise:mix.precise,mode:mix.mode,solo:mix.solo},{stems:0,boxes:2,precise:false,mode:'clarity',solo:false},'clarity-first mix state '+id);
      assert(mix.credit.includes('CC BY')&&mix.map!=='none'&&mix.current===mix.player,'credited mix and player metadata '+id);
      await go('stage');await page.locator('#play').click();
      await page.waitForFunction(()=>{
        if(!anL||!anR)return false;return [anL,anR].every(analyser=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length)>.0005;});
      },null,{timeout:10000});
      await go('rig');await open('#mapStems');await page.locator('#mapStems').click();
      await page.waitForFunction(()=>stemNames.length===4&&sps.length===4&&!document.getElementById('mapStems').disabled,null,{timeout:30000});
      const rig=await page.evaluate(()=>({stems:sps.map(speaker=>speaker.stem),solo:!$('demoSolo').hidden,energies:['vocals','drums','bass','other'].map(key=>{const data=stemBufs[key].getChannelData(0);let sum=0;for(let i=0;i<data.length;i+=16)sum+=data[i]*data[i];return Math.sqrt(sum/(data.length/16));})}));
      assert.deepEqual(rig.stems,['vocals','drums','other','bass'],'stem mapping '+id);assert(rig.solo&&rig.energies.every(value=>value>.001),'usable stems '+id);
      await go('source');await page.locator('[data-solo=vocals]').click();assert.deepEqual(await page.evaluate(()=>sps.map(speaker=>speaker.mute)),[false,true,true,true]);await page.locator('[data-solo=""]').click();assert.deepEqual(await page.evaluate(()=>sps.map(speaker=>speaker.mute)),[false,false,false,false]);
      await go('stage');await page.locator('#play').click();console.log(id,'ok',mix.current,rig.energies.map(value=>value.toFixed(3)).join('/'));
    }
    assert.deepEqual(errors,[],'no page errors');console.log('PASS: seven credited mixes load first, play, fetch stems on demand, map, and solo correctly.');
  }finally{if(browser)await browser.close();await closeServer(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
