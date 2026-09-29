const assert=require('node:assert/strict');
const path=require('node:path');
const {createServer}=require('./server.cjs');
const {closeServer,launchBrowser,listen,makeWav}=require('./test-helpers.cjs');

(async()=>{
  const server=createServer(),base=await listen(server);let browser;
  try{
    browser=await launchBrowser();
    for(const [name,viewport,scheme] of [['light',{width:1440,height:900},'light'],['dark',{width:1440,height:900},'dark'],['mobile-dark',{width:390,height:844},'dark']]){
      const page=await browser.newPage({viewport,hasTouch:name==='mobile-dark'}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/index.html');
      await page.evaluate(value=>document.querySelector('.seg [data-app="'+value+'"]').click(),scheme);await page.waitForFunction(value=>document.documentElement.dataset.appearance===value,scheme);await page.locator('#f').setInputFiles({name:'Glass Demo - Aurora.wav',mimeType:'audio/wav',buffer:makeWav({seconds:3,frequency:330})});await page.waitForFunction(()=>$('playerState').dataset.state==='ready');await page.locator('#play').click();await page.waitForFunction(()=>$('playerState').dataset.state==='playing');await page.waitForTimeout(180);
      const material=await page.evaluate(()=>{const player=getComputedStyle($('playerSection')),toolbar=getComputedStyle(document.querySelector('.topbar')),tabbar=getComputedStyle(document.querySelector('.tabbar')),group=getComputedStyle(document.querySelector('details.group'));return {appearance:document.documentElement.dataset.appearance,playerBackdrop:player.backdropFilter||player.webkitBackdropFilter,toolbarBackdrop:toolbar.backdropFilter||toolbar.webkitBackdropFilter,tabbarBackdrop:tabbar.backdropFilter||tabbar.webkitBackdropFilter,playerBackground:player.backgroundImage,groupBackground:group.backgroundImage,border:player.borderTopColor,playVisible:(()=>{const r=$('play').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()};});
      assert.equal(material.appearance,scheme);assert.match(material.playerBackground,/gradient/);assert.match(material.groupBackground,/gradient/);assert(material.playVisible);assert.deepEqual(errors,[]);
      if(name==='mobile-dark'){ // phones keep live blur only on the floating overlays; cards use their layered tint
        assert.equal(material.playerBackdrop,'none','phone cards must not sample the backdrop');assert.equal(material.toolbarBackdrop,'none','the scrolling phone toolbar must not sample the backdrop');assert.match(material.tabbarBackdrop,/blur\(/,'floating tab bar keeps live glass');
      }else{assert.match(material.playerBackdrop,/blur\(/);assert.match(material.toolbarBackdrop,/blur\(/);}
      await page.screenshot({path:path.join(__dirname,`visual-glass-${name}.png`),fullPage:false});console.log(name,material);await page.close();
    }
    console.log('PASS: layered glass renders with active diffusion on desktop and overlay-only live blur on phones, in Light and Dark.');
  }finally{if(browser)await browser.close();await closeServer(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
