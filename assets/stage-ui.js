listener.x=room.w/2;listener.y=room.l/2;
resizeStageCanvas({redraw:false});showSel();draw();loadStemsFromCache();
// The backing store follows the displayed size (tab switches, rotation, desktop resizes).
if('ResizeObserver' in window)new ResizeObserver(()=>resizeStageCanvas()).observe(c);
// live category summaries so a collapsed group still shows its state
function syncMetas(){
  const set=(id,v)=>setText(id,v); // unchanged summaries are not rewritten
  set('roomMeta',room.w+' × '+room.l+' × '+room.h+' m');
  set('verbMeta',($('walls').checked?'on':'off')+' · abs '+Math.round(+$('wallAbs').value*100)+'% · verb '+Math.round(+$('roomAmt').value*100)+'%');
  set('matMeta',$('furn').value+' · '+($('preset').value||'Custom'));
  set('furnMeta',furniture.length?furniture.map(o=>o.type).join(', '):'none');
  set('rigMeta',sps.length+' box'+(sps.length===1?'':'es'));
  set('balMeta',Math.abs(+$('bal').value)<0.01?'centered':(+$('bal').value<0?'left '+(Math.round(-$('bal').value*100))+'%':'right '+Math.round(+$('bal').value*100)+'%'));
  const playbackLabel={clarity:'Clarity',room:'Room',immersive:'Immersive'}[$('renderMode').value]||'Clarity';set('engMeta',playbackLabel);set('qualityState',playbackLabel);
  set('eqMeta',$('hpdev').value?($('hpdev').value==='pro3'?'Pro 3 · bypass':$('hpdev').value):'bypass');
  set('headMeta',listener.useSensor?'sensor on':'manual');
  set('appMeta',appearance||'System');}
// Slider drags fire input at display rate; summaries refresh at most once per frame.
let metasQueued=false;
function queueSyncMetas(){if(metasQueued)return;metasQueued=true;requestAnimationFrame(()=>{metasQueued=false;syncMetas();});}
document.addEventListener('input',queueSyncMetas);
document.addEventListener('change',queueSyncMetas);
for(const id of ['addSp','addTw','addSub','stage8','addBed','addSofa','addWardrobe','mapStems'])$(id).addEventListener('click',()=>queueMicrotask(syncMetas));
const TABS=['stage','source','room','rig','sound'];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
function goTab(t){const changed=document.body.dataset.tab!==t;if(changed)document.body.dataset.tab=t;
  document.querySelectorAll('.tabbar .tab').forEach(b=>{const selected=String(b.dataset.tab===t);if(b.getAttribute('aria-selected')!==selected)b.setAttribute('aria-selected',selected);});
  if(changed&&innerWidth<900)scrollTo(0,0);} // only a real tab switch starts the new panel at the top
document.querySelector('.tabbar').addEventListener('click',e=>{const b=e.target.closest('.tab');if(!b)return;
  const again=b.dataset.tab===document.body.dataset.tab;goTab(b.dataset.tab);
  if(again&&innerWidth<900)scrollTo({top:0,behavior:reducedMotion.matches?'auto':'smooth'});}); // re-tapping the active tab returns to the top
goTab('stage');
const glassAmt=$('glassAmt'),rootStyle=document.documentElement.style;
function applyGlass(){const v=+glassAmt.value/100;
  rootStyle.setProperty('--glass-opacity-scale',(.55+.45*v).toFixed(3));
  rootStyle.setProperty('--glass-blur-scale',(.45+1.1*v).toFixed(3));}
try{glassAmt.value=localStorage.getItem('glass')||65;}catch(e){}
glassAmt.oninput=()=>{applyGlass();try{localStorage.setItem('glass',glassAmt.value);}catch(e){}};
applyGlass();
// Only the sticky desktop toolbar reacts to scrolling; phones skip the handler entirely.
const wideViewport=matchMedia('(min-width: 900px)');let scrolledState=document.body.classList.contains('scrolled');
addEventListener('scroll',()=>{if(!wideViewport.matches)return;const next=scrollY>6;if(next!==scrolledState){scrolledState=next;document.body.classList.toggle('scrolled',next);}},{passive:true});
// appearance: System tracks the device; Light/Dark override it (iOS Settings behaviour) and persist
const AP=matchMedia('(prefers-color-scheme:light)');
let appearance='';
try{appearance=localStorage.getItem('appearance')||'';}catch(e){}
function applyAppearance(){
  const v=appearance||(AP.matches?'light':'dark'),changed=document.documentElement.getAttribute('data-appearance')!==v;
  if(rootStyle.getPropertyValue('color-scheme')!==v)rootStyle.setProperty('color-scheme',v);
  if(changed)document.documentElement.setAttribute('data-appearance',v); // theme-init.js already applied the stored choice
  document.querySelectorAll('.seg [data-app]').forEach(b=>{const pressed=String((b.dataset.app||'')===appearance);if(b.getAttribute('aria-pressed')!==pressed)b.setAttribute('aria-pressed',pressed);});
  if(changed)try{draw();}catch(e){}}
AP.addEventListener('change',()=>{if(!appearance)applyAppearance();});
document.querySelector('.seg').addEventListener('click',e=>{const b=e.target.closest('[data-app]');if(!b)return;
  appearance=b.dataset.app;try{localStorage.setItem('appearance',appearance);}catch(_){}
  applyAppearance();});
applyAppearance();
syncMetas();
