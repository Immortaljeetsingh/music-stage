listener.x=room.w/2;listener.y=room.l/2;
showSel();draw();loadStemsFromCache();
// live category summaries so a collapsed group still shows its state
function syncMetas(){
  const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
  set('roomMeta',room.w+' × '+room.l+' × '+room.h+' m');
  set('verbMeta',($('walls').checked?'on':'off')+' · abs '+Math.round(+$('wallAbs').value*100)+'% · verb '+Math.round(+$('roomAmt').value*100)+'%');
  set('matMeta',$('furn').value+' · '+($('preset').value||'Custom'));
  set('furnMeta',furniture.length?furniture.map(o=>o.type).join(', '):'none');
  set('rigMeta',sps.length+' box'+(sps.length===1?'':'es'));
  set('balMeta',Math.abs(+$('bal').value)<0.01?'centered':(+$('bal').value<0?'left '+(Math.round(-$('bal').value*100))+'%':'right '+Math.round(+$('bal').value*100)+'%'));
  set('engMeta',$('hq').checked?'precise':'classic');
  set('eqMeta',$('hpdev').value?($('hpdev').value==='pro3'?'Pro 3 · bypass':$('hpdev').value):'bypass');
  set('headMeta',listener.useSensor?'sensor on':'manual');
  set('appMeta',appearance||'System');}
document.addEventListener('input',syncMetas);
document.addEventListener('change',syncMetas);
for(const id of ['addSp','addTw','addSub','stage8','addBed','addSofa','addWardrobe','mapStems'])$(id).addEventListener('click',()=>queueMicrotask(syncMetas));
const TABS=['stage','source','room','rig','sound'];
function goTab(t){document.body.dataset.tab=t;
  document.querySelectorAll('.tabbar .tab').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===t)));
  if(innerWidth<900)scrollTo(0,0);}
document.querySelector('.tabbar').addEventListener('click',e=>{const b=e.target.closest('.tab');if(b)goTab(b.dataset.tab);});
goTab('stage');
const glassAmt=$('glassAmt'),rootStyle=document.documentElement.style;
function applyGlass(){const v=+glassAmt.value/100;
  rootStyle.setProperty('--glass-opacity-scale',(.55+.45*v).toFixed(3));
  rootStyle.setProperty('--glass-blur-scale',(.45+1.1*v).toFixed(3));}
try{glassAmt.value=localStorage.getItem('glass')||65;}catch(e){}
glassAmt.oninput=()=>{applyGlass();try{localStorage.setItem('glass',glassAmt.value);}catch(e){}};
applyGlass();
addEventListener('scroll',()=>document.body.classList.toggle('scrolled',scrollY>6),{passive:true});
// appearance: System tracks the device; Light/Dark override it (iOS Settings behaviour) and persist
const AP=matchMedia('(prefers-color-scheme:light)');
let appearance='';
try{appearance=localStorage.getItem('appearance')||'';}catch(e){}
function applyAppearance(){
  const v=appearance||(AP.matches?'light':'dark');
  rootStyle.setProperty('color-scheme',v);
  document.documentElement.setAttribute('data-appearance',v);
  document.querySelectorAll('.seg [data-app]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.app||'')===appearance)));
  try{draw();}catch(e){}}
AP.addEventListener('change',()=>{if(!appearance)applyAppearance();});
document.querySelector('.seg').addEventListener('click',e=>{const b=e.target.closest('[data-app]');if(!b)return;
  appearance=b.dataset.app;try{localStorage.setItem('appearance',appearance);}catch(_){}
  applyAppearance();});
applyAppearance();
syncMetas();
