const assert=require('node:assert/strict');
const path=require('node:path');
const {createServer}=require('./server.cjs');
const {closeServer,launchBrowser,listen}=require('./test-helpers.cjs');

// The Android app injects window.MusicStageAndroid into the bundled editor. This test stands in for the native side
// and checks the System-wide sound card, status rendering, controls and live stage sync. Browsers never see the card.
(async()=>{
  const server=createServer(),base=await listen(server);let browser;
  try{
    browser=await launchBrowser();
    const plain=await browser.newPage();await plain.goto(base+'/index.html');
    assert.equal(await plain.evaluate(()=>!!document.getElementById('systemSection')),false,'browsers never show the Android card');
    assert.equal(await plain.evaluate(()=>document.documentElement.dataset.platform||''),'');
    await plain.close();

    for(const scheme of ['dark','light']){
      const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,colorScheme:scheme});
      await context.addInitScript(()=>{
        try{localStorage.setItem('tourSeen','1');}catch(_){}
        const calls=window.__nativeCalls=[];
        window.__nativeStatus={supported:true,state:'off',running:false,dumpGranted:false,shizukuRunning:false,shizukuGranted:false,processed:[],blocked:[],unmuted:[],latencyMs:0,adbCommand:'adb shell pm grant io.github.immortaljeetsingh.musicstage android.permission.DUMP',setupMessage:''};
        window.MusicStageAndroid={
          getStatus:()=>JSON.stringify(window.__nativeStatus),
          setConfig:json=>calls.push(['setConfig',json]),start:()=>calls.push(['start']),stop:()=>calls.push(['stop']),
          setupWithShizuku:()=>calls.push(['shizuku']),copyText:text=>calls.push(['copy',text]),setAppearance:value=>calls.push(['appearance',value]),openLink:url=>calls.push(['link',url])};
      });
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/index.html');
      await page.waitForFunction(()=>window.__nativeCalls.some(call=>call[0]==='setConfig'));
      const setup=await page.evaluate(()=>{const card=document.getElementById('systemSection'),player=document.getElementById('playerSection'),settings=document.getElementById('panel-sound');
        return {platform:document.documentElement.dataset.platform,playerFirst:player.getBoundingClientRect().top<card.getBoundingClientRect().top,hero:player.classList.contains('android-player-hero'),
          playerTab:document.getElementById('tab-stage').textContent.trim(),settingsTab:document.getElementById('tab-sound').textContent.trim(),musicTab:document.getElementById('tab-source').textContent.trim(),
          tourText:document.querySelector('#welcomeDialog ol').textContent,
          stageMoved:document.querySelector('.stage').closest('#panel-sound')===settings,selectedMoved:document.getElementById('sel').closest('#panel-sound')===settings,
          appearanceMoved:document.getElementById('appGroup').parentElement===settings,headMoved:document.getElementById('headGroup').parentElement===settings,
          modeMoved:document.getElementById('modeToggle').closest('#androidExperienceGroup')!==null,uniqueIds:['playerSection','systemSection','appGroup','headGroup','modeToggle','c'].every(id=>document.querySelectorAll('#'+id).length===1),
          noOverflow:document.documentElement.scrollWidth<=innerWidth,playerBackdrop:getComputedStyle(player).backdropFilter,
          backdropCount:[...document.querySelectorAll('.glass,.sec')].filter(el=>el.offsetParent!==null&&getComputedStyle(el).backdropFilter!=='none').length,
          pill:document.getElementById('systemState').textContent,toggleDisabled:document.getElementById('systemToggle').disabled,setupVisible:!document.getElementById('systemSetup').hidden,appearance:window.__nativeCalls.filter(c=>c[0]==='appearance').pop()?.[1],
          config:JSON.parse(window.__nativeCalls.find(c=>c[0]==='setConfig')[1])};});
      assert.equal(setup.platform,'android');
      assert(setup.playerFirst,'the glass player leads the Android Player view');
      assert.equal(setup.hero,true,'the existing player receives the Android hero material');
      assert.deepEqual([setup.musicTab,setup.settingsTab,setup.playerTab],['Music','Settings','Player']);
      assert.match(setup.tourText,/in Music/);assert.match(setup.tourText,/on Player/);
      assert.equal(setup.stageMoved&&setup.selectedMoved&&setup.appearanceMoved&&setup.headMoved&&setup.modeMoved,true,'customization nodes move into Settings');
      assert.equal(setup.uniqueIds,true,'the Android layout moves controls without cloning IDs');
      assert.equal(setup.noOverflow,true,'the Android shell has no horizontal overflow');
      assert.notEqual(setup.playerBackdrop,'none','the Android hero keeps real glass diffusion');
      assert(setup.backdropCount<=2,'the Player view keeps the mobile blur budget');
      assert.equal(setup.pill,'Setup needed');
      assert.equal(setup.toggleDisabled,true,'Start waits for the one-time setup');
      assert.equal(setup.setupVisible,true);
      assert.equal(setup.appearance,scheme,'native bars follow the page appearance');
      assert.equal(setup.config.speakers.length,2,'the stage is sent to the native engine');
      assert.equal(setup.config.controls.renderMode,'clarity');
      assert.equal('savedAt' in setup.config,false,'volatile fields are not sent');

      await page.locator('#systemShizuku').click();await page.locator('#systemCopy').click();
      assert.deepEqual(await page.evaluate(()=>window.__nativeCalls.filter(c=>c[0]==='shizuku'||c[0]==='copy').map(c=>c[0])),['shizuku','copy']);

      await page.evaluate(()=>{$('mvol').value='0.5';$('mvol').dispatchEvent(new Event('input',{bubbles:true}));});
      await page.waitForFunction(()=>window.__nativeCalls.filter(c=>c[0]==='setConfig').some(c=>JSON.parse(c[1]).controls.mvol==='0.5'));

      await page.evaluate(()=>window.MusicStageNative.onStatus({supported:true,state:'running',running:true,dumpGranted:true,processed:['YouTube Music','Deezer'],blocked:['Spotify'],unmuted:[],latencyMs:64,setupMessage:''}));
      const running=await page.evaluate(()=>({pill:document.getElementById('systemState').textContent,toggle:document.getElementById('systemToggle').textContent,pressed:document.getElementById('systemToggle').getAttribute('aria-pressed'),
        setupHidden:document.getElementById('systemSetup').hidden,summary:document.getElementById('systemSummary').textContent,notes:document.getElementById('systemApps').textContent}));
      assert.deepEqual({pill:running.pill,toggle:running.toggle,pressed:running.pressed,setupHidden:running.setupHidden},{pill:'On',toggle:'Stop',pressed:'true',setupHidden:true});
      assert.match(running.summary,/Processing YouTube Music, Deezer\./);
      assert.match(running.notes,/Spotify/);assert.match(running.notes,/64 ms/);
      const box=await page.locator('#systemToggle').boundingBox();assert(box.height>=44,'44pt touch target');
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.waitForTimeout(250); // let layout and the enabled-state transition settle before the visual check
      await page.screenshot({path:path.join(__dirname,`visual-android-player-${scheme}.png`)});
      await page.locator('#tab-sound').click();
      await page.waitForTimeout(150);
      const settingsVisible=await page.evaluate(()=>{const panel=document.getElementById('panel-sound'),mode=document.getElementById('modeToggle');return panel.offsetParent!==null&&mode.offsetParent!==null;});
      assert.equal(settingsVisible,true,'Settings opens with the customization level control visible');
      await page.screenshot({path:path.join(__dirname,`visual-android-settings-${scheme}.png`)});
      await page.locator('#tab-stage').click();
      await page.locator('#systemToggle').click();
      await page.evaluate(()=>window.MusicStageNative.onStatus({supported:true,state:'off',running:false,dumpGranted:true,processed:[],blocked:[],unmuted:[]}));
      await page.locator('#systemToggle').click();
      assert.deepEqual(await page.evaluate(()=>window.__nativeCalls.filter(c=>c[0]==='start'||c[0]==='stop').map(c=>c[0])),['stop','start']);
      assert.deepEqual(errors,[]);
      await context.close();
    }
    console.log('PASS: Android bridge presents a glass player-first view, moves customization into Settings, follows native status, and leaves browsers unaffected.');
  }finally{if(browser)await browser.close();await closeServer(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
