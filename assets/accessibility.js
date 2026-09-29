/* Keyboard, assistive-technology, motion-permission, and panel semantics. */
const tabButtons=[...document.querySelectorAll('.tabbar [role=tab]')];
const panelByTab=Object.fromEntries(tabButtons.map(tab=>[tab.dataset.tab,$(tab.getAttribute('aria-controls'))]));
const originalGoTab=goTab;
function syncPanelVisibility(){ // phones show one panel at a time; desktop exposes all of them
  const mobile=innerWidth<900,current=document.body.dataset.tab||'stage';
  for(const tab of tabButtons){const panel=panelByTab[tab.dataset.tab],hidden=String(mobile&&tab.dataset.tab!==current);if(panel&&panel.getAttribute('aria-hidden')!==hidden)panel.setAttribute('aria-hidden',hidden);}
}
goTab=function(name,{focus=false}={}){
  originalGoTab(name); // selection state and the scroll reset live there
  for(const tab of tabButtons){const index=tab.dataset.tab===name?0:-1;if(tab.tabIndex!==index)tab.tabIndex=index;}
  syncPanelVisibility();
  if(focus)tabButtons.find(tab=>tab.dataset.tab===name)?.focus();syncStageDescription();
};
function moveTabFocus(current,delta){const index=tabButtons.indexOf(current),next=delta==='first'?0:delta==='last'?tabButtons.length-1:(index+delta+tabButtons.length)%tabButtons.length;goTab(tabButtons[next].dataset.tab,{focus:true});}
document.querySelector('.tabbar').addEventListener('keydown',event=>{const tab=event.target.closest('[role=tab]');if(!tab)return;if(event.key==='ArrowRight'||event.key==='ArrowDown'){event.preventDefault();event.stopImmediatePropagation();moveTabFocus(tab,1);}else if(event.key==='ArrowLeft'||event.key==='ArrowUp'){event.preventDefault();event.stopImmediatePropagation();moveTabFocus(tab,-1);}else if(event.key==='Home'){event.preventDefault();moveTabFocus(tab,'first');}else if(event.key==='End'){event.preventDefault();moveTabFocus(tab,'last');}});
function syncStageDescription(){
  const selected=sps[selIdx],objects=furniture.length?`${furniture.length} furniture object${furniture.length===1?'':'s'}`:'no furniture';
  setText('stageState',`${sps.length} speaker${sps.length===1?'':'s'}, ${objects}. Listener at ${listener.x.toFixed(1)}, ${listener.y.toFixed(1)} metres in a ${room.w} by ${room.l} by ${room.h} metre room.${selected?` Selected ${selected.sub?'subwoofer':'speaker '+(selIdx+1)} at ${selected.x.toFixed(1)}, ${selected.y.toFixed(1)} metres.`:''}`); // polite live region: speak only real changes
}
function labelGeneratedControls(){
  const ranges=$('sel').querySelectorAll('input[type=range]'),selects=$('sel').querySelectorAll('select');
  if(ranges[0])ranges[0].setAttribute('aria-label',`Speaker ${selIdx+1} volume`);if(ranges[1])ranges[1].setAttribute('aria-label',`Speaker ${selIdx+1} height`);
  for(const [index,label] of ['channel','frequency band','stem source'].entries())if(selects[index])selects[index].setAttribute('aria-label',`Speaker ${selIdx+1} ${label}`);
  for(const button of $('sel').querySelectorAll('button'))if(!button.getAttribute('aria-label'))button.setAttribute('aria-label',`${button.textContent} speaker ${selIdx+1}`);
  syncStageDescription();
}
new MutationObserver(labelGeneratedControls).observe($('sel'),{childList:true,subtree:true});labelGeneratedControls();
for(const eventName of ['pointerup','change'])c.addEventListener(eventName,syncStageDescription);
window.addEventListener('keyup',event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','Delete','Backspace'].includes(event.key))syncStageDescription();});
window.addEventListener('keydown',event=>{if(event.code!=='Space'||event.repeat||event.target.closest('input,select,textarea,button,a,summary'))return;event.preventDefault();togglePlay();});

let enhancedOrientationHandler=null;
$('motion').onclick=async()=>{
  if(listener.useSensor){listener.useSensor=false;$('uni').checked=true;$('motion').setAttribute('aria-pressed','false');$('motion').textContent='Head track';say('Head tracking off; manual direction active.');syncMetas();return;}
  if(typeof DeviceOrientationEvent==='undefined'){say('This browser or device does not expose orientation sensors.');return;}
  try{if(typeof DeviceOrientationEvent.requestPermission==='function'){const permission=await DeviceOrientationEvent.requestPermission();if(permission!=='granted')throw new Error('Sensor permission was not granted.');}}
  catch(error){listener.useSensor=false;$('uni').checked=true;$('motion').setAttribute('aria-pressed','false');say(error.message||'Head-tracking permission was denied.');return;}
  if(!enhancedOrientationHandler){enhancedOrientationHandler=event=>{if(!listener.useSensor||(event.alpha==null&&event.webkitCompassHeading==null))return;const yaw=(event.webkitCompassHeading!=null&&!Number.isNaN(event.webkitCompassHeading))?event.webkitCompassHeading*Math.PI/180:(360-event.alpha)*Math.PI/180,pitch=event.beta!=null?event.beta*Math.PI/180:0;listener.sYaw=yaw;listener.sPitch=pitch;const response=+$('sens').value||1;listener.yaw=angLerp(listener.yaw,(yaw-listener.off)*response,.35);const target=Math.max(-1,Math.min(1,(pitch-listener.poff)*response));listener.pitch+=(target-listener.pitch)*.35;syncAudio();requestDraw();syncStageDescription();};const eventName='ondeviceorientationabsolute' in window?'deviceorientationabsolute':'deviceorientation';window.addEventListener(eventName,enhancedOrientationHandler);}
  listener.useSensor=true;$('uni').checked=false;$('motion').setAttribute('aria-pressed','true');$('motion').textContent='Tracking on';say('Head tracking on. Turn the device; choose Center to re-zero.');syncMetas();
};
$('uni').addEventListener('change',()=>{if($('uni').checked){listener.useSensor=false;$('motion').setAttribute('aria-pressed','false');$('motion').textContent='Head track';}syncMetas();});

const themeColor=document.querySelector('meta[name=theme-color]');
function syncThemeColor(){themeColor.content=document.documentElement.dataset.appearance==='light'?'#f2f2f7':'#0a0a0c';}
new MutationObserver(syncThemeColor).observe(document.documentElement,{attributes:true,attributeFilter:['data-appearance']});
// Mobile toolbars change the viewport height while scrolling; that must not reset the tab or the scroll
// position. Only a width change (rotation, window resize) can alter the layout.
let resizeFrame=0,lastViewportWidth=innerWidth;
window.addEventListener('resize',()=>{if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(innerWidth===lastViewportWidth)return;lastViewportWidth=innerWidth;syncPanelVisibility();resizeStageCanvas();});});
window.addEventListener('unhandledrejection',event=>{const message=event.reason?.message;if(message)say(`Operation failed: ${message}`);});
window.addEventListener('pagehide',()=>{audioLoadController?.abort();pendingStemController?.abort();catalogController?.abort();});
goTab('stage');syncThemeColor();syncStageDescription();
