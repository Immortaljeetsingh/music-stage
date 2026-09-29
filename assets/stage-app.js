
// ponytail: mono-feed per speaker (stereo->HRTF sounds phasey/left-biased). L/R split restores separation.
let AC, buf, playing=[], live=[], master, verb, wet, comp, balN, trimL=null, trimR=null, anL=null, anR=null;
let srcMono=false; // ROOT CAUSE (right side dead): splitter output 1 is silence for mono files,
// so every R chain got zeros. Dual-mono routes ch0 to both sides when the file has 1 channel.
let SWAP=false; // diagnostic: flip L/R interpretation (dead side follows swap = graph/content, stays = ear/OS)
let TRIM={l:1,r:1}; // per-ear output trim: compensates bud imbalance, proves ear vs graph
let stemBufs={}, stemNames=[]; // filled from stems.html via IndexedDB: vocals/drums/bass/other
// headphone correction: verified measurement-based presets (AutoEq: crinacle 711 + Rtings B&K5128).
// No numerical AirPods Pro 3 correction was verified in this research.
const HP_PROFILES={
 'AirPods Pro 2 (ANC)':{pre:-3.3,f:[[105,'lowshelf',0.5,0.7],[427,'peaking',-2.6,0.8],[3647,'peaking',2.3,0.77],[9516,'peaking',2.8,3.44],[76,'peaking',1.9,1.34],[10000,'highshelf',-1.8,0.7],[5938,'peaking',2.6,1.27],[6486,'peaking',-6.3,5.92],[1172,'peaking',1.1,5.05],[3326,'peaking',-1.9,4.4]]},
 'AirPods 4':{pre:-6.4,f:[[105,'lowshelf',11.4,0.7],[4622,'peaking',6,1.39],[49,'peaking',-11.7,0.39],[1277,'peaking',-2.6,0.86],[3036,'peaking',4.1,2.43],[10000,'highshelf',-1.9,0.7],[354,'peaking',-1.4,1.5],[176,'peaking',1.5,2.04],[618,'peaking',1,2.35],[106,'peaking',-0.9,2.47]]},
 'AirPods 4 (ANC)':{pre:-6.2,f:[[105,'lowshelf',12.7,0.7],[49,'peaking',-13.2,0.44],[3573,'peaking',6,1.4],[1318,'peaking',-2.8,1.16],[5138,'peaking',3.2,2.82],[10000,'highshelf',-2,0.7],[166,'peaking',1.2,3.49],[100,'peaking',-0.7,2.5],[438,'peaking',-0.8,2.38],[654,'peaking',0.6,2.93]]},
 'EarPods':{pre:-6.2,f:[[105,'lowshelf',6.2,0.7],[6106,'peaking',-6.5,1.79],[4238,'peaking',5.1,1.8],[912,'peaking',2.5,1.87],[1739,'peaking',-2.1,1.73],[10000,'highshelf',-0.8,0.7],[147,'peaking',-1.1,1.2],[78,'peaking',1.7,2.98],[108,'peaking',-0.4,2.22],[2657,'peaking',-0.4,5.13]]}};
let hpNodes=[]; // active correction chain: preamp + biquads
// room furnishing: soft stuff absorbs highs + kills late tail; hard clutter scatters mids
const FURNISH={Empty:{abs:0.28,rt:1.0,lp:4500},Furnished:{abs:0.5,rt:0.6,lp:3200},Cluttered:{abs:0.72,rt:0.35,lp:2200}};
const furniture=[];
function furnish(){const f=FURNISH[$('furn').value]||FURNISH.Empty;
  const soft=Math.min(0.8,furniture.reduce((n,o)=>n+o.w*o.d*o.abs,0)/(room.w*room.l));
  return {abs:Math.min(0.95,f.abs+soft),rt:f.rt/(1+3*soft),lp:f.lp/(1+soft)};}
function blocked(s,off=0){return furniture.some(o=>{
  let lo=0,hi=1;
  for(const [a,b,min,max] of [[s.x+off,listener.x,o.x,o.x+o.w],[s.y,listener.y,o.y,o.y+o.d],[s.h??EAR,EAR,0,o.h]]){
    const v=b-a;if(Math.abs(v)<1e-8){if(a<min||a>max)return false;continue;}
    const t1=(min-a)/v,t2=(max-a)/v;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;
  }return hi>0&&lo<1;
});}
function furnitureChanged(){if(playing.length)seekTo(curPos());draw();}
function showFurniture(){const list=$('furniture');list.replaceChildren();
  furniture.forEach((o,i)=>{const row=document.createElement('div');row.className='ctl';
    const name=document.createElement('strong');name.textContent=o.type;row.append(name);
    for(const [key,title,max] of [['x','X',room.w-o.w],['y','Y',room.l-o.d],['w','Width',room.w-o.x],['d','Depth',room.l-o.y],['h','Height',room.h],['abs','Absorption',1]]){
      const label=document.createElement('label'),input=document.createElement('input');label.textContent=title+' ';input.type='number';input.min=['w','d','h'].includes(key)?0.1:0;input.max=max;input.step=0.1;input.value=o[key];input.setAttribute('aria-label',o.type+' '+title);
      input.onchange=()=>{const v=input.valueAsNumber;o[key]=Number.isFinite(v)?Math.max(+input.min,Math.min(+input.max,v)):o[key];showFurniture();if(key==='abs')furnitureChanged();else{syncAudioSafe();draw();}};label.append(input);row.append(label);
    }
    const del=document.createElement('button');del.textContent='Remove '+o.type;del.onclick=()=>{furniture.splice(i,1);showFurniture();furnitureChanged();};row.append(del);list.append(row);
  });
}
function addFurniture(type){const dims={Bed:[1.6,2,0.6,0.6],Sofa:[2,0.9,1,0.6],Wardrobe:[1.4,0.6,2,0.1]}[type];
  furniture.push({type,x:0,y:0,w:Math.min(room.w,dims[0]),d:Math.min(room.l,dims[1]),h:Math.min(room.h,dims[2]),abs:dims[3]});showFurniture();furnitureChanged();}
let playOffset=0, playStart=0, seekTimer=null;
const EAR=1.6; // listener ear height, meters
let room={w:10,l:10,h:10}; // generous default stage: big rooms are the point of the app
let listener={x:3,y:4,yaw:0,pitch:0,off:0,poff:0,useSensor:false,sYaw:0,sPitch:0};
let sps=[{x:2,y:2,h:1.6,v:1,sub:false,ch:'L',band:'Full'},{x:8,y:2,h:1.6,v:1,sub:false,ch:'R',band:'Full'}];
let selIdx=0;
const c=document.getElementById('c'),CANVAS_WIDTH=900,CANVAS_HEIGHT=600;
let CANVAS_SCALE=1; // backing-store pixels per logical stage pixel; drawing always uses the 900x600 space
const x2=c.getContext('2d');
const $=id=>document.getElementById(id);
function setText(target,value){const el=typeof target==='string'?$(target):target;if(el&&el.textContent!==value)el.textContent=value;} // skip no-op DOM writes
// Render at the resolution actually displayed. A phone shows the 900px stage at ~1000 device pixels, so a
// larger backing store only adds fill cost; a large HiDPI canvas gets a true 1.5x/2x render instead of an upscale.
function preferredCanvasScale(){const width=c.getBoundingClientRect().width;if(!width)return CANVAS_SCALE;
  const needed=width*(window.devicePixelRatio||1)/CANVAS_WIDTH;return needed>1.35?Math.min(2,Math.ceil(needed*2)/2):1;}
function resizeStageCanvas({redraw=true}={}){const scale=preferredCanvasScale(),width=Math.round(CANVAS_WIDTH*scale),height=Math.round(CANVAS_HEIGHT*scale);
  if(scale===CANVAS_SCALE&&c.width===width&&c.height===height)return false; // resizing clears the canvas: only when needed
  CANVAS_SCALE=scale;c.width=width;c.height=height;x2.setTransform(scale,0,0,scale,0,0);if(redraw&&typeof draw==='function')draw();return true;}

for(const [id,key] of [['rw','w'],['rl','l'],['rh','h']])$(id).onchange=e=>{
  const input=e.target,v=input.valueAsNumber;room[key]=Number.isFinite(v)?Math.max(+input.min,Math.min(+input.max,v)):room[key];input.value=room[key];
  for(const s of sps){s.x=Math.min(room.w,s.x);s.y=Math.min(room.l,s.y);s.h=Math.min(room.h,s.h??EAR);}
  listener.x=Math.min(room.w,listener.x);listener.y=Math.min(room.l,listener.y);
  for(const o of furniture){o.w=Math.min(room.w,o.w);o.d=Math.min(room.l,o.d);o.h=Math.min(room.h,o.h);o.x=Math.min(room.w-o.w,o.x);o.y=Math.min(room.l-o.d,o.y);}
  showFurniture();showSel();furnitureChanged();
};
function audit(b){ // per-channel peak+RMS (sampled): proves whether the FILE has a right channel at all
  const n=b.length,step=Math.max(1,Math.floor(n/200000));
  const L=b.getChannelData(0),R=b.numberOfChannels>1?b.getChannelData(1):L;
  let pl=0,pr=0,sl=0,sr=0,c=0;
  for(let i=0;i<n;i+=step){const a=Math.abs(L[i]),g=Math.abs(R[i]);if(a>pl)pl=a;if(g>pr)pr=g;sl+=a*a;sr+=g*g;c++;}
  const db=v=>v<=0.00001?'−∞':(20*Math.log10(v)).toFixed(0)+'dB';
  return 'L pk '+db(pl)+' / R pk '+db(pr)+(pr<0.001?' — RIGHT CHANNEL SILENT in this file, use another track!':(pl<0.001?' — LEFT CHANNEL SILENT in this file!':''));}
$('f').onchange=async e=>{
  AC=AC||new (window.AudioContext||window.webkitAudioContext)();
  const ab=await e.target.files[0].arrayBuffer();
  buf=await AC.decodeAudioData(ab);
  srcMono=buf.numberOfChannels<2;
  clearStems();dropPendingStems();playOffset=0;updTime();
  say('file: '+buf.numberOfChannels+'ch '+(srcMono?'(mono→dual-mono)':('('+audit(buf)+')'))+' — press Play');
};
$('addSp').onclick=()=>{sps.push({x:room.w/2,y:room.l/2,h:EAR,v:1,sub:false,ch:'M',band:'Full'});if(playing.length)seekTo(curPos());draw();};
$('addTw').onclick=()=>{sps.push({x:room.w/2,y:0.5,h:room.h-0.3,v:0.7,sub:false,ch:'M',band:'Tweeter'});if(playing.length)seekTo(curPos());draw();};
$('addSub').onclick=()=>{sps.push({x:room.w/2,y:room.l-0.5,h:0.3,v:1.4,sub:true,ch:'M',band:'Full'});if(playing.length)seekTo(curPos());draw();};
$('stage8').onclick=()=>{ // 4 ear-level fulls + 4 ceiling tweeters + 1 floor sub
  const {w,l,h}=room;
  sps=[
    {x:0.5,y:0.5,h:EAR,v:1,sub:false,ch:'L',band:'Full'},
    {x:w-0.5,y:0.5,h:EAR,v:1,sub:false,ch:'R',band:'Full'},
    {x:0.5,y:l-0.5,h:EAR,v:0.7,sub:false,ch:'L',band:'Vocal'},
    {x:w-0.5,y:l-0.5,h:EAR,v:0.7,sub:false,ch:'R',band:'Vocal'},
    {x:0.5,y:0.5,h:Math.min(2.6,room.h-0.3),v:0.6,sub:false,ch:'L',band:'Tweeter'},
    {x:w-0.5,y:0.5,h:Math.min(2.6,room.h-0.3),v:0.6,sub:false,ch:'R',band:'Tweeter'},
    {x:0.5,y:l-0.5,h:Math.min(2.6,room.h-0.3),v:0.6,sub:false,ch:'L',band:'Tweeter'},
    {x:w-0.5,y:l-0.5,h:Math.min(2.6,room.h-0.3),v:0.6,sub:false,ch:'R',band:'Tweeter'},
    {x:w/2,y:0.5,h:0.3,v:1.5,sub:true,ch:'M',band:'Full'},
  ];selIdx=0;if(playing.length)seekTo(curPos());showSel();draw();say('9-box rig placed');};
$('roomAmt').oninput=e=>{const amount=+e.target.value||0;$('preset').value='';
  if(wet)wet.gain.setTargetAtTime(amount,AC.currentTime,0.03);
  else if(amount>0&&playing.length)seekTo(curPos());}; // the convolver is built only once reverb becomes audible
$('openStems').onclick=()=>location.href='stems.html';
$('mapStems').onclick=async()=>{ // separated rig is opt-in: Demucs output is lossy vs the original mix
  if(demoStemsBusy){say('fetching stems…');await demoStemsBusy;demoStemsBusy=null;}
  if(stemNames.length===4){
    sps=[{x:5,y:1,h:1.6,v:1.1,ch:'M',band:'Full',stem:'vocals'},
      {x:2,y:3,h:1.3,v:1.1,ch:'M',band:'Full',stem:'drums'},
      {x:8,y:6.5,h:2.5,v:1.25,ch:'M',band:'Full',stem:'other'},
      {x:5,y:6.5,h:0.3,v:1.25,sub:true,ch:'M',band:'Full',stem:'bass'}];
    selIdx=0;
    $('demoSolo').hidden=false;
    $('demoSolo').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(!b.dataset.solo)));
    say('separated rig: vocals front, drums left, other rear-high, bass sub — audition parts below');
  }else{
    sps.forEach(s=>{ // partial stem set: map onto current boxes, drums by hand
      if(s.sub)s.stem='bass';else if(s.band==='Tweeter')s.stem='other';
      else if(s.y<room.l/2)s.stem='other';else s.stem='vocals';});
    $('demoSolo').hidden=false;
    say('mapped: fronts/other, rears/vocals, sub/bass — assign drums manually');
  }
  if(playing.length)seekTo(curPos());showSel();draw();};
async function resampleStem(l44,r44){ // ponytail: native resampler — linear interp loses HF and images above ~15k at 48k
  const n=l44.length,src=AC.createBuffer(2,n,44100);
  src.getChannelData(0).set(l44);src.getChannelData(1).set(r44);
  const off=new OfflineAudioContext(2,Math.round(n*AC.sampleRate/44100),AC.sampleRate);
  const s=off.createBufferSource();s.buffer=src;s.connect(off.destination);s.start();
  return off.startRendering();
}
async function loadStemsFromCache(){try{
  if(!('indexedDB' in window))return;
  const db=await new Promise((res,rej)=>{const r=indexedDB.open('stage',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('stems');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const rec=await new Promise((res,rej)=>{const t=db.transaction('stems').objectStore('stems').get('set1');
    t.onsuccess=()=>res(t.result);t.onerror=()=>rej(t.error);});
  if(!rec||!rec.vocals)return;
  AC=AC||new (window.AudioContext||window.webkitAudioContext)();
  for(const k of['vocals','drums','bass','other']){if(rec[k]&&rec[k].l){
    stemBufs[k]=await resampleStem(rec[k].l,rec[k].r);}}
  stemNames=Object.keys(stemBufs);
  if(stemNames.length){$('mapStems').style.display='';say('stems ready ('+(rec.name||'track')+'): '+stemNames.join(', ')+' — assign per speaker or Map stems');showSel();}
}catch(e){}}
$('air').onchange=()=>{$('preset').value='';syncAudioSafe();};
$('furn').onchange=()=>{$('preset').value='';furnitureChanged();};
$('addBed').onclick=()=>addFurniture('Bed');$('addSofa').onclick=()=>addFurniture('Sofa');$('addWardrobe').onclick=()=>addFurniture('Wardrobe');
$('hpdev').onchange=()=>{if(playing.length)seekTo(curPos());
  if($('hpdev').value==='pro3')say('AirPods Pro 3: no numerical correction verified here; EQ bypassed. Pro 2 correction is not interchangeable.');};
function syncAudioSafe(){try{updateLis();}catch(e){}}
$('mvol').oninput=()=>{if(master)updateLis();}; // updateLis ramps master = volume x headroom as one parameter: no overshoot while dragging
function fmt(t){t=Math.max(0,Math.floor(t));return Math.floor(t/60)+':'+String(t%60).padStart(2,'0');}
function dur(){if(buf)return buf.duration;const k=Object.keys(stemBufs)[0];return k?stemBufs[k].duration:0;}
function curPos(){const D=dur();if(!D)return 0;if(!playing.length)return playOffset;return (playOffset+Math.max(0,AC.currentTime-playStart))%D;}
const meterBuffers=[null,null],meterScales=[-1,-1];let lastHeadroomText='',lastHeadroomAt=-Infinity;
function updateOutputMeters(){try{
  const bars=[$('mL'),$('mR')],analysers=[anL,anR];
  for(let i=0;i<2;i++){let level=0;const analyser=analysers[i];
    if(playing.length&&analyser?.getByteTimeDomainData){let data=meterBuffers[i];if(!data||data.length!==analyser.fftSize)data=meterBuffers[i]=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);let sum=0;for(let j=0;j<data.length;j+=2){const v=(data[j]-128)/128;sum+=v*v;}level=Math.min(1,Math.sqrt(sum/(data.length/2))*3);}
    // Compositor-only meter: scaleY of a fixed 22px bar (same 2-22px travel as before), quantized so a steady level writes nothing.
    const scale=Math.round((0.0909+0.909*level)*40)/40;
    if(bars[i]&&scale!==meterScales[i]){meterScales[i]=scale;bars[i].style.transform=`scaleY(${scale})`;}}
  const status=$('headroomState'),now=performance.now();
  if(status&&(!playing.length||now-lastHeadroomAt>=250)){lastHeadroomAt=now;const reduction=playing.length&&Number.isFinite(comp?.reduction)?comp.reduction:0,attenuation=live.norm&&live.norm<0.995?-20*Math.log10(live.norm):0,text=reduction<-.1?`Limiter ${Math.abs(reduction).toFixed(1)} dB · protected`:attenuation>.1?`Auto headroom ${attenuation.toFixed(1)} dB`:'Clean path · auto headroom';if(text!==lastHeadroomText){lastHeadroomText=text;status.textContent=text;status.dataset.state=reduction<-.1?'limiting':attenuation>.1?'attenuating':'clean';}}
}catch(_) {}}
function updTime(){const D=dur();if(!D){setText('time','0:00 / 0:00');updateOutputMeters();return;}const position=curPos();setText('time',fmt(position)+' / '+fmt(D));if(playing.length){const value=String(Math.round(position/D*1000));if($('seek').value!==value)$('seek').value=value;}updateOutputMeters();}
function seekTo(t){const D=dur();if(!D)return;t=((t%D)+D)%D;
  if(playing.length){stopPb();startPb(t);}else{playOffset=t;$('seek').value=Math.round(t/D*1000);updTime();}}
$('seek').onchange=e=>{const D=dur();if(D)seekTo(e.target.value/1000*D);};
$('back').onclick=()=>seekTo(curPos()-10);$('fwd').onclick=()=>seekTo(curPos()+10);
$('bal').oninput=e=>{if(balN)balN.pan.value=+e.target.value;};
$('width').oninput=()=>syncAudioSafe();
$('align').onchange=()=>syncAudioSafe();
$('swap').onchange=()=>{SWAP=$('swap').checked;if(playing.length)seekTo(curPos());};
$('trimL').oninput=e=>{TRIM.l=+e.target.value;if(trimL)trimL.gain.setTargetAtTime(TRIM.l,AC.currentTime,0.02);if(live.length)updateLis();};
$('trimR').oninput=e=>{TRIM.r=+e.target.value;if(trimR)trimR.gain.setTargetAtTime(TRIM.r,AC.currentTime,0.02);if(live.length)updateLis();};
const PLAYBACK_MODES={
 clarity:{walls:false,abs:0.85,verb:0,air:false,align:true,hq:false,label:'Clarity'},
 room:{walls:true,abs:0.75,verb:0.02,air:false,align:true,hq:false,label:'Room'},
 immersive:{walls:true,abs:0.55,verb:0.06,air:false,align:false,hq:true,label:'Immersive'}};
function applyPlaybackMode(name,announce=true){const mode=PLAYBACK_MODES[name]||PLAYBACK_MODES.clarity;
  $('renderMode').value=name in PLAYBACK_MODES?name:'clarity';$('walls').checked=mode.walls;$('wallAbs').value=mode.abs;$('roomAmt').value=mode.verb;$('air').checked=mode.air;$('align').checked=mode.align;$('hq').checked=mode.hq;$('width').value=1;$('preset').value=name==='clarity'?'Clarity':'';if(wet)wet.gain.value=mode.verb;if(playing.length)seekTo(curPos());else syncAudioSafe();if($('qualityState'))$('qualityState').textContent=mode.label;try{syncMetas();}catch(_){}if(announce)say(`${mode.label} playback: ${mode.walls?'restrained room cues':'direct stereo, room copies off'}, automatic headroom on.`);}
$('renderMode').onchange=e=>applyPlaybackMode(e.target.value);
$('qualityState').onclick=()=>{const order=['clarity','room','immersive'],next=order[(order.indexOf($('renderMode').value)+1)%order.length];applyPlaybackMode(next);};
$('hq').onchange=()=>{const name=$('hq').checked?'immersive':($('renderMode').value==='clarity'?'clarity':'room');applyPlaybackMode(name);};
$('walls').onchange=()=>{$('preset').value='';if(playing.length)seekTo(curPos());}; // taps rebuild
$('wallAbs').oninput=()=>{$('preset').value='';syncAudioSafe();}; // tap gains follow live
// one-tap room tunes: only reflections/absorption/reverb/softness/air — layout and speakers untouched
const PRESETS={
 Clarity:{walls:false,abs:0.85,verb:0,furn:'Empty',air:false},
 Studio:{walls:true,abs:0.85,verb:0,furn:'Empty',air:false},
 'Living Room':{walls:true,abs:0.5,verb:0.05,furn:'Furnished',air:false},
 'Concert Hall':{walls:true,abs:0.25,verb:0.18,furn:'Empty',air:true},
 Club:{walls:true,abs:0.4,verb:0.1,furn:'Cluttered',air:true},
 Cathedral:{walls:true,abs:0.1,verb:0.3,furn:'Empty',air:true},
 Outdoor:{walls:false,abs:0.5,verb:0,furn:'Empty',air:true}};
function applyPreset(name){const p=PRESETS[name];if(!p)return;
  $('walls').checked=p.walls;$('wallAbs').value=p.abs;$('roomAmt').value=p.verb;
  $('furn').value=p.furn;$('air').checked=p.air;$('renderMode').value=name==='Clarity'?'clarity':'room';$('hq').checked=false;if($('qualityState'))$('qualityState').textContent=name==='Clarity'?'Clarity':'Room';
  if(wet)wet.gain.value=p.verb;
  if(playing.length)seekTo(curPos());else{syncAudioSafe();draw();}
  say(name+': '+(name==='Clarity'?'direct stereo, ':'spatial room, ')+'reflections '+(p.walls?'on':'off')+', absorb '+p.abs+', verb '+p.verb+', '+p.furn.toLowerCase()+(p.air?', air dulls far':'')+'.');}
$('preset').onchange=e=>applyPreset(e.target.value);
function beep(side){
  ensureAudioContext();AC.resume();
  const o=AC.createOscillator(),g=AC.createGain(),p=AC.createStereoPanner();
  const t=AC.currentTime;o.frequency.value=+$('testFreq').value;p.pan.value=side==='L'?-1:1;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.04,t+0.02);g.gain.setValueAtTime(0.04,t+0.35);g.gain.linearRampToValueAtTime(0,t+0.4);
  o.connect(g);g.connect(p);p.connect(AC.destination);o.start(t);o.stop(t+0.4);
  o.onended=()=>{o.disconnect();g.disconnect();p.disconnect();};
}
$('tL').onclick=()=>beep('L');$('tR').onclick=()=>beep('R');
// ponytail: open catalogs only (YT/Spotify lock audio in iframe/DRM, unreachable from WebAudio).
const say=t=>$('stat').textContent=t;
function addRes(label,loader){const li=document.createElement('li');li.textContent=label+' ';
  const b=document.createElement('button');b.textContent='Load';b.onclick=loader;li.append(b);$('res').append(li);}
async function loadRemote(url,title){
  try{stopPbSafe();say('connecting…');
    AC=AC||new (window.AudioContext||window.webkitAudioContext)();await AC.resume();
    const r=await fetch(url);if(!r.ok)throw new Error('http '+r.status);
    say('downloading…');
    const ab=await r.arrayBuffer();
    say('decoding '+((ab.byteLength/1048576).toFixed(1))+'MB…');
    buf=await AC.decodeAudioData(ab);
    srcMono=buf.numberOfChannels<2;
    clearStems();dropPendingStems();playOffset=0;updTime();say('loaded: '+title+' ('+buf.numberOfChannels+'ch'+(srcMono?', mono→dual-mono':' ('+audit(buf)+')')+') — press Play');
  }catch(e){say('failed ('+((e&&e.message)||'CORS/network')+') — try another track, paste a link, or upload');}}
function stopPbSafe(){try{if(playing.length)stopPb();}catch(e){}}
function clearStems(){ // a new mix must not keep playing the previous stems
  stemBufs={};stemNames=[];sps.forEach(s=>delete s.stem);
  $('mapStems').style.display='none';$('demoSolo').hidden=true;showSel();}
function dropPendingStems(){demoGen++;demoStemsBusy=null;} // stale background fetch must not land
$('loadUrl').onclick=()=>{const u=$('url').value.trim();if(u)loadRemote(u,u.split('/').pop());};
(function probe(){try{
  const C=window.AudioContext||window.webkitAudioContext;if(!C){say('this browser has no Web Audio');return;}
  const t=new C();
  const missing=['createChannelMerger','createStereoPanner','createChannelSplitter','createConvolver','createDelay','createDynamicsCompressor'].filter(f=>typeof t[f]!=='function');
  const px=!!(t.listener&&t.listener.positionX);
  if(missing.length||!px)say('compat note — missing: '+(missing.join(', ')||'(none)')+(px?'':' + legacy listener API'));
  if(t.close)t.close();
}catch(e){}})();
let demos=[];
$('demoSolo').onclick=e=>{const button=e.target.closest('button[data-solo]');if(!button)return;
  sps.forEach(s=>s.mute=!!button.dataset.solo&&s.stem!==button.dataset.solo);syncAudioSafe();showSel();draw();
  $('demoSolo').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));};
async function loadDemoList(){try{demos=await (await fetch('demos/manifest.json')).json();
  demos.forEach(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=(d.style?d.style+' · ':'')+d.title+' — '+d.artist;$('demo').append(o);});}catch(e){}}
// Demo loading is mix-first: one file plays immediately, the four stems stream in the background
// and only land when Map stems asks for them. Five sequential FLAC fetches was the slow path.
let demoStemsBusy=null,demoGen=0;
$('loadDemo').onclick=async()=>{const d=demos.find(d=>d.id===$('demo').value);if(!d)return;
  const gen=++demoGen;
  try{$('loadDemo').disabled=true;stopPbSafe();say('downloading demo mix…');
    AC=AC||new (window.AudioContext||window.webkitAudioContext)();await AC.resume();
    const base='demos/'+d.id+'/',mr=await fetch(base+'mix.flac');
    if(!mr.ok)throw new Error('mix http '+mr.status);
    const mix=await AC.decodeAudioData(await mr.arrayBuffer());
    stopPbSafe();clearStems();buf=mix;srcMono=mix.numberOfChannels<2;playOffset=0;
    room={w:10,l:10,h:10};listener.x=5;listener.y=5;listener.yaw=0;listener.pitch=0;furniture.length=0;showFurniture();
    sps=[{x:2,y:2,h:1.6,v:1.1,ch:'L',band:'Full'},{x:8,y:2,h:1.6,v:1.1,ch:'R',band:'Full'}]; // original mix on a stereo pair: AI separation is lossy — Map stems opts into the 4-box rig
    $('hq').checked=true;$('walls').checked=true;$('roomAmt').value=0.04;$('mvol').value=0.7;$('bal').value=0;
    TRIM={l:1,r:1};$('trimL').value=1;$('trimR').value=1;
    $('rw').value=10;$('rl').value=10;$('rh').value=10;$('yaw').value=0;$('look').value=0;$('uni').checked=true;listener.useSensor=false;
    $('width').value=1;$('align').checked=false;$('air').checked=false;$('wallAbs').value=0.65;$('furn').value='Empty';SWAP=false;$('swap').checked=false;
    selIdx=0;showSel();draw();updTime();
    const credit=$('demoCredit');credit.replaceChildren(document.createTextNode(d.title+' by '+d.artist+(d.featuring?' featuring '+d.featuring:'')+' — excerpted, faded and AI-separated. '));
    for(const [text,url] of [['Original & credits',d.source],['CC BY license',d.license],['Full attribution','https://github.com/Immortaljeetsingh/music-stage#bundled-demo-credits']]){const a=document.createElement('a');a.textContent=text;a.href=url;credit.append(a,document.createTextNode(' · '));}
    say(d.title+' — '+d.artist+' · CC BY · 24s demo. Mix ready — press Play. Stems downloading in the background for Map stems.');
    demoStemsBusy=(async()=>{ // four stems in parallel; only adopted if the user has not moved on
      const keys=['vocals','drums','bass','other'];
      const pairs=await Promise.all(keys.map(async k=>{const r=await fetch(base+k+'.flac');
        if(!r.ok)throw new Error(k+' http '+r.status);
        return[k,await AC.decodeAudioData(await r.arrayBuffer())];}));
      const obj={};for(const [k,b] of pairs)obj[k]=b;
      const len=obj.vocals.length;
      if(Object.values(obj).some(b=>b.length!==len||b.numberOfChannels!==2))throw new Error('stem alignment mismatch');
      if(gen!==demoGen)return;
      stemBufs=obj;stemNames=Object.keys(obj);$('mapStems').style.display='';showSel();
      say('stems ready (vocals, drums, bass, other) — Map stems to place them.');})()
        .catch(e=>{if(gen===demoGen)say('stem download failed ('+e.message+') — the mix still plays');});
  }catch(e){say('demo load failed: '+e.message);}finally{$('loadDemo').disabled=false;}};
loadDemoList();
const AUH=['https://api.audius.co','https://discoveryprovider.audius.co']; // api host now gates keys; legacy still open
$('quick').onclick=e=>{const b=e.target.closest('button[data-q]');if(!b)return;$('q').value=b.dataset.q;$('search').click();};
$('search').onclick=async()=>{
  $('res').innerHTML='';const q=$('q').value.trim();if(!q)return;
  try{say('searching…');
    if($('prov').value==='audius'){
      let found=null,err='';
      for(const h of AUH){try{
        const r=await fetch(h+'/v1/tracks/search?query='+encodeURIComponent(q)+'&limit=8&app_name=STAGE_TEST');
        if(!r.ok)throw new Error('http '+r.status);
        const j=await r.json();found={h,list:j.data||[]};break;
      }catch(e){err=(e&&e.message)||'net';}}
      if(!found){say('audius blocked ('+err+') — try Archive.org');return;}
      found.list.forEach(t=>addRes((t.title||'?')+' — '+((t.user&&t.user.name)||''),
        ()=>loadRemote(found.h+'/v1/tracks/'+t.id+'/stream?app_name=STAGE_TEST',t.title)));
      say(found.list.length?found.list.length+' found':'nothing found');
    }else{
      const r=await fetch('https://archive.org/advancedsearch.php?q='+encodeURIComponent(q+' AND mediatype:audio')+'&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=12&sort[]=downloads+desc&output=json');
      if(!r.ok)throw new Error('http '+r.status);
      const j=await r.json();
      const docs=j.response.docs||[],words=q.toLowerCase().split(/\s+/).filter(w=>w.length>2);
      // archive titles are often keyword soup: rank the ones that actually mention the query first
      docs.sort((a,b)=>{const sc=d=>{const t=((d.title||'')+' '+(d.creator||'')).toLowerCase();
        return words.reduce((n,w)=>n+(t.includes(w)?1:0),0);};return sc(b)-sc(a);});
      docs.forEach(d=>addRes((d.title||d.identifier)+' — '+(d.creator||'')+(d.year?' ('+d.year+')':''),
        async()=>{say('resolving…');
          const m=await (await fetch('https://archive.org/metadata/'+d.identifier)).json();
          const cands=(m.files||[]).filter(f=>/\.(mp3|ogg|m4a|opus)$/i.test(f.name||''));
          cands.sort((a,b)=>(a.size||9e18)-(b.size||9e18)); // smallest first: faster + mobile-safe
          const f=cands[0];
          if(!f){say('no playable file in '+d.identifier);return;}
          loadRemote('https://archive.org/download/'+d.identifier+'/'+encodeURIComponent(f.name),d.title||d.identifier);}));
      say(docs.length+' found — pick one, smallest file loads');
    }
  }catch(e){say('search failed ('+((e&&e.message)||'network')+') — upload a file instead');}
};
function manualTakeover(){if(listener.useSensor){listener.useSensor=false;$('uni').checked=true;}}
$('yaw').oninput=e=>{manualTakeover();listener.yaw=+e.target.value*Math.PI/180;updateLis();draw();};
$('look').oninput=e=>{manualTakeover();listener.pitch=+e.target.value*Math.PI/180;updateLis();draw();};
$('uni').onchange=e=>{listener.useSensor=!e.target.checked;};
$('center').onclick=()=>{listener.off=listener.sYaw;listener.poff=listener.sPitch;
  listener.yaw=0;listener.pitch=0;$('yaw').value=0;$('look').value=0;updateLis();draw();};
// Apple-style world lock: compass+gyro yaw (+tilt pitch) rotates YOU, stage stays. Web can't read
// the AirPods gyro (Apple private), so the phone is the sensor — pocket/hand while you turn.
function angLerp(a,b,t){let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return a+d*t;}
let trackOn=false;
$('motion').onclick=async()=>{
  try{ if(typeof DeviceOrientationEvent!=='undefined'&&DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); }catch(e){}
  listener.useSensor=true;$('uni').checked=false;
  const handler=e=>{
    if(e.alpha==null&&e.webkitCompassHeading==null)return;
    const y=(e.webkitCompassHeading!=null&&!isNaN(e.webkitCompassHeading))?e.webkitCompassHeading*Math.PI/180:(360-e.alpha)*Math.PI/180;
    const p=e.beta!=null?e.beta*Math.PI/180:0;
    listener.sYaw=y;listener.sPitch=p;
    const s=+$('sens').value||1;
    listener.yaw=angLerp(listener.yaw,(y-listener.off)*s,0.35); // smoothed: no jitter, Apple-like glide
    const pr=Math.max(-1,Math.min(1,(p-listener.poff)*s));
    listener.pitch+=(pr-listener.pitch)*0.35;
    if(listener.useSensor){syncAudio();draw();}
  };
  if(!trackOn){trackOn=true;
    if('ondeviceorientationabsolute' in window)window.addEventListener('deviceorientationabsolute',handler);
    else window.addEventListener('deviceorientation',handler);}
  say('head-track on: turn — stage stays fixed. Center re-zeroes.');
};
