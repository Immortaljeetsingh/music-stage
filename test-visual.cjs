const assert=require('node:assert/strict');
const path=require('node:path');
const {createServer}=require('./server.cjs');
const {closeServer,launchBrowser,listen,makeWav}=require('./test-helpers.cjs');

(async()=>{
  const server=createServer(),base=await listen(server);let browser;
  try{
    browser=await launchBrowser();
    for(const [name,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
      const page=await browser.newPage({viewport,hasTouch:name==='mobile'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/index.html');await page.locator('#f').setInputFiles({name:'Visual Artist - Verified Player.wav',mimeType:'audio/wav',buffer:makeWav({seconds:3})});await page.waitForFunction(()=>$('playerState').dataset.state==='ready');await page.locator('#play').click();await page.waitForFunction(()=>$('playerState').dataset.state==='playing');await page.waitForTimeout(180);
      const geometry=await page.evaluate(()=>{const play=$('play').getBoundingClientRect(),player=$('playerSection').getBoundingClientRect(),column=document.querySelector('.col-stage'),style=getComputedStyle($('play'));return {play:{top:play.top,bottom:play.bottom,left:play.left,right:play.right,width:play.width,height:play.height},player:{top:player.top,bottom:player.bottom},viewport:{width:innerWidth,height:innerHeight},column:{scrollTop:column.scrollTop,clientHeight:column.clientHeight,scrollHeight:column.scrollHeight},cssVisible:style.display!=='none'&&style.visibility!=='hidden',inViewport:play.top>=0&&play.left>=0&&play.bottom<=innerHeight&&play.right<=innerWidth};});
      await page.screenshot({path:path.join(__dirname,`visual-playing-${name}.png`),fullPage:false});console.log(name,JSON.stringify(geometry));assert(geometry.cssVisible&&geometry.inViewport,`Play must be visible in initial ${name} viewport`);assert(geometry.player.bottom-geometry.player.top>300,'player card must not be flex-collapsed');assert.equal(await page.locator('#playerState').innerText(),'Playing');assert.equal(await page.locator('#play').innerText(),'Pause');assert.deepEqual(errors,[]);await page.close();
    }
    console.log('PASS: playing-state player is fully visible in initial desktop and mobile viewports.');
  }finally{if(browser)await browser.close();await closeServer(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
