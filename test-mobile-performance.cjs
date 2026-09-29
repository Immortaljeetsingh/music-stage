const assert=require('node:assert/strict');
const {createServer}=require('./server.cjs');
const {closeServer,launchBrowser,listen,makeWav}=require('./test-helpers.cjs');

// Mobile rendering contract, measured under phone emulation and 4x CPU throttling:
// no load-time theme/mode flash, no scroll jump when mobile browser chrome resizes the viewport,
// stage swipes that scroll over empty floor but drag objects in place, minimal backdrop sampling,
// no idle animation loop, and bounded layout/DOM work during playback.
const metric=(snapshot,name)=>snapshot.metrics.find(item=>item.name===name)?.value||0;

(async()=>{
  const server=createServer(),base=await listen(server);let browser;
  try{
    browser=await launchBrowser();
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,colorScheme:'dark'});
    await context.addInitScript(()=>{
      try{localStorage.setItem('appearance','light');localStorage.setItem('experience','simple');localStorage.setItem('tourSeen','1');}catch(_){}
      const record=()=>{if(document.body&&!window.__firstBodyState)window.__firstBodyState={appearance:document.documentElement.dataset.appearance||'unset',experience:document.documentElement.dataset.experience||'unset'};};
      new MutationObserver(record).observe(document,{childList:true,subtree:true});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/index.html',{waitUntil:'load'});
    const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');

    const firstPaint=await page.evaluate(()=>window.__firstBodyState);
    const idle=await page.evaluate(()=>{
      const visible=el=>{const style=getComputedStyle(el);return style.display!=='none'&&style.visibility!=='hidden'&&el.getClientRects().length>0;};
      const backdrop=[...document.querySelectorAll('*')].filter(el=>{const style=getComputedStyle(el),value=style.backdropFilter||style.webkitBackdropFilter||'none';return value!=='none'&&visible(el);}).map(el=>el.id||String(el.className)||el.tagName);
      const infinite=document.getAnimations().filter(animation=>animation.playState==='running'&&animation.effect?.getTiming?.().iterations===Infinity).map(animation=>`${animation.animationName||'animation'}${animation.effect?.pseudoElement||''}`);
      const canvasRect=c.getBoundingClientRect();
      return {backdropCount:backdrop.length,backdrop,infinite,bodyAttachment:getComputedStyle(document.body).backgroundAttachment,canvasBackingWidth:c.width,canvasCssWidth:Math.round(canvasRect.width),touchAction:getComputedStyle(c).touchAction};
    });

    await page.evaluate(()=>scrollTo(0,700));await page.waitForTimeout(150);
    const scrollBeforeResize=await page.evaluate(()=>Math.round(scrollY));
    await page.setViewportSize({width:390,height:760});await page.waitForTimeout(300);
    const scrollAfterResize=await page.evaluate(()=>Math.round(scrollY));
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);await page.evaluate(()=>scrollTo(0,0));

    // Touch on the stage: a vertical swipe over empty floor scrolls the page, while a drag that starts on a
    // speaker moves the speaker and never scrolls.
    const swipe=async point=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y-12*i,id:1}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(350);};
    const stagePoint=target=>page.evaluate(target=>{c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect(),s=sps[0],[px,py]=target==='speaker'?P3(s.x,s.y,s.h??EAR):P3(room.w*.86,room.l*.86,0),lift=target==='speaker'?.45*S3():0;return {x:r.left+px*r.width/CANVAS_WIDTH,y:r.top+(py-lift)*r.height/CANVAS_HEIGHT};},target);
    const floorPoint=await stagePoint('floor'),floorStart=await page.evaluate(()=>scrollY);await swipe(floorPoint);const floorScroll=await page.evaluate(start=>Math.round(scrollY-start),floorStart);
    const speakerPoint=await stagePoint('speaker'),dragStart=await page.evaluate(()=>({scroll:scrollY,x:sps[0].x,y:sps[0].y}));await swipe(speakerPoint);
    const touch={floorScroll,...await page.evaluate(start=>({dragScroll:Math.round(scrollY-start.scroll),speakerMoved:sps[0].x!==start.x||sps[0].y!==start.y}),dragStart)};
    await page.evaluate(()=>{sps[0].x=2;sps[0].y=2;showSel();draw();scrollTo(0,0);});

    await page.locator('#f').setInputFiles({name:'Performance Artist - Mobile Check.wav',mimeType:'audio/wav',buffer:makeWav({seconds:12,frequency:220})});
    await page.waitForFunction(()=>$('playerState').dataset.state==='ready');
    await page.evaluate(()=>{
      window.__positionCalls=0;const session=navigator.mediaSession;
      if(session?.setPositionState){const original=session.setPositionState.bind(session);session.setPositionState=(...args)=>{window.__positionCalls++;return original(...args);};}
      window.__artMutations=0;new MutationObserver(list=>{window.__artMutations+=list.length;}).observe($('albumArt'),{attributes:true,attributeFilter:['style']});
    });
    await page.locator('#play').click();await page.waitForFunction(()=>$('playerState').dataset.state==='playing');
    await page.locator('#play').click();await page.waitForFunction(()=>$('playerState').dataset.state==='paused');
    await page.locator('#play').click();await page.waitForFunction(()=>$('playerState').dataset.state==='playing');
    const artworkMutationsDuringPlayPause=await page.evaluate(()=>window.__artMutations);

    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const before=await cdp.send('Performance.getMetrics');
    const playback=await page.evaluate(()=>new Promise(resolve=>{
      let mutations=0;const observer=new MutationObserver(list=>{mutations+=list.length;});observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
      window.__positionCalls=0;const deltas=[];const started=performance.now();let last=started;
      const tick=now=>{deltas.push(now-last);last=now;if(now-started<3000){requestAnimationFrame(tick);return;}observer.disconnect();const sorted=[...deltas].sort((a,b)=>a-b);resolve({seconds:(now-started)/1000,mutations,frames:deltas.length,p95FrameMs:Math.round(sorted[Math.floor(sorted.length*.95)]||0),longFrames:deltas.filter(delta=>delta>50).length,positionCalls:window.__positionCalls});};
      requestAnimationFrame(tick);
    }));
    const after=await cdp.send('Performance.getMetrics');
    const scrolling=await page.evaluate(()=>new Promise(resolve=>{const deltas=[];let last=performance.now(),steps=0;const tick=now=>{deltas.push(now-last);last=now;scrollBy(0,steps<45?14:-14);steps++;if(steps<90){requestAnimationFrame(tick);return;}const sorted=[...deltas].sort((a,b)=>a-b);resolve({p95FrameMs:Math.round(sorted[Math.floor(sorted.length*.95)]),maxFrameMs:Math.round(sorted.at(-1)),longFrames:deltas.filter(delta=>delta>50).length});};requestAnimationFrame(tick);}));
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});

    const seconds=playback.seconds;
    const report={firstPaint,idle,scroll:{before:scrollBeforeResize,after:scrollAfterResize},touch,artworkMutationsDuringPlayPause,playback:{...playback,mutationsPerSecond:+(playback.mutations/seconds).toFixed(1),layoutsPerSecond:+((metric(after,'LayoutCount')-metric(before,'LayoutCount'))/seconds).toFixed(1),styleRecalcsPerSecond:+((metric(after,'RecalcStyleCount')-metric(before,'RecalcStyleCount'))/seconds).toFixed(1),scriptMsPerSecond:+((metric(after,'ScriptDuration')-metric(before,'ScriptDuration'))*1000/seconds).toFixed(1),taskMsPerSecond:+((metric(after,'TaskDuration')-metric(before,'TaskDuration'))*1000/seconds).toFixed(1)},scrolling,errors};
    console.log(JSON.stringify(report,null,2));

    assert.deepEqual(firstPaint,{appearance:'light',experience:'simple'},'stored appearance and Simple mode must apply before the body renders');
    assert(idle.backdropCount<=2,`too many live backdrop-filter surfaces on mobile: ${idle.backdrop.join(', ')}`);
    assert.deepEqual(idle.infinite,[],'no continuous animation may run while idle');
    assert.notEqual(idle.bodyAttachment,'fixed','fixed body backgrounds repaint on mobile scroll');
    assert(idle.canvasBackingWidth<=Math.ceil(idle.canvasCssWidth*3*1.3)&&idle.canvasBackingWidth<=1200,`phone canvas backing store is over-allocated: ${idle.canvasBackingWidth}px`);
    assert.match(idle.touchAction,/pan-y/,'vertical swipes over empty stage floor must scroll the page');
    assert(touch.floorScroll>60,`a vertical swipe over empty stage floor scrolled only ${touch.floorScroll}px`);
    assert(Math.abs(touch.dragScroll)<2&&touch.speakerMoved,`dragging a speaker must move it without scrolling (scrolled ${touch.dragScroll}px, moved ${touch.speakerMoved})`);
    assert(Math.abs(scrollAfterResize-scrollBeforeResize)<60,`mobile toolbar resize jumped scroll from ${scrollBeforeResize} to ${scrollAfterResize}`);
    assert.equal(artworkMutationsDuringPlayPause,0,'play/pause must not reload album artwork');
    assert(playback.positionCalls<=1,`Media Session position was pushed ${playback.positionCalls} times during steady playback`);
    assert(report.playback.layoutsPerSecond<15,`playback forces ${report.playback.layoutsPerSecond} layouts/s`);
    assert(report.playback.mutationsPerSecond<60,`playback makes ${report.playback.mutationsPerSecond} DOM mutations/s`);
    assert.deepEqual(errors,[]);
    console.log('PASS: mobile rendering has no theme flash or resize jump, stage swipes scroll while object drags stay put, minimal backdrop sampling, no idle animation loop, and bounded playback UI work.');
  }finally{if(browser)await browser.close();await closeServer(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
