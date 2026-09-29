// --- editor: oblique 3D room view (invertible: floor picking stays exact) ---
const S3=()=>Math.min((CANVAS_WIDTH-50)/(room.w+0.5*room.l),(CANVAS_HEIGHT-40)/(0.5*room.l+0.9*room.h+0.5));
const CX3=()=>CANVAS_WIDTH/2;
const CY3=()=>CANVAS_HEIGHT/2+0.45*room.h*S3();
function P3(x,y,z){const S=S3();return [CX3()+(x-room.w/2)*S+0.5*(y-room.l/2)*S, CY3()+0.5*(y-room.l/2)*S-z*0.9*S];}
function toPx(p){return P3(p.x,p.y,p.h??0);}
function toM(px,py){const S=S3();const v=(py-CY3())/(0.5*S);
  return {x:room.w/2+(px-CX3())/S-0.5*v, y:room.l/2+v};}
const col=s=>s.sub?'#f59e0b':(s.band==='Tweeter'?'#22d3ee':(s.band==='Vocal'?'#c084fc':(s.band==='Bass'?'#2dd4bf':(s.band==='Bright'?'#facc15':'#3b82f6'))));
const isLight=()=>document.documentElement.getAttribute('data-appearance')==='light';
function pal(){return isLight()?{ // stage follows Light/Dark with the rest of the app
  floor0:'#e6e9f1',floor1:'#cfd5e2',grid:'rgba(60,60,67,.26)',edge:'#7e879b',wall0:'rgba(250,251,253,.98)',wall1:'rgba(190,198,215,.98)',
  text:'#3c4254',text2:'#6b7288',cab:'#d2d7e2',cabTop:'#e9ecf3',cabSide:'#b7bdcb',basket:'#3a4050',cone:'#5b6377',metal:'#8d95a8',
  hole:'#2a2f3c',shade:'rgba(30,35,50,.16)',hair:'#2f2a26',skin:'#f0c9a4',shirt:'#34d399',pants:'#3b4a6b',sel:'#0a84ff',lbl:'#1c1c1e',
  fWood:'#d9b58c',fWood2:'#bd9266',fHard:'#c3c8d4'}:{
  floor0:'#141c29',floor1:'#1c2635',grid:'rgba(70,90,120,.28)',edge:'#33445a',wall0:'rgba(20,28,40,.55)',wall1:'rgba(10,14,22,.75)',
  text:'#8fa3bd',text2:'#7d8ea6',cab:'#2f3a4d',cabTop:'#3a475d',cabSide:'#232d3d',basket:'#141a24',cone:'#232b39',metal:'#8d97a8',
  hole:'#0b0f14',shade:'rgba(0,0,0,.4)',hair:'#1d1a17',skin:'#e8bd93',shirt:'#22c55e',pants:'#33415e',sel:'#ffffff',lbl:'#c9d6e8',
  fWood:'#496b72',fWood2:'#293642',fHard:'#384653'};}
const cabR=s=>s.sub?0.5:(s.band==='Tweeter'?0.24:0.3); // cabinet half-width in meters: pick() uses the same numbers
// one loudspeaker driver: basket, surround, cone, phase plug
function driver(px,py,R,p,accent,lit){
  x2.beginPath();x2.arc(px,py,R,0,7);x2.fillStyle=p.basket;x2.fill();
  if(lit){x2.globalAlpha*=.5;x2.beginPath();x2.arc(px,py,R*1.18,0,7);x2.fillStyle=accent;x2.fill();x2.globalAlpha/=.5;}
  x2.lineWidth=Math.max(1,R*0.14);x2.strokeStyle=p.metal;x2.beginPath();x2.arc(px,py,R*0.92,0,7);x2.stroke();
  const g=x2.createRadialGradient(px-R*0.25,py-R*0.3,R*0.12,px,py,R*0.88);
  g.addColorStop(0,p.cone);g.addColorStop(1,p.hole);x2.fillStyle=g;
  x2.beginPath();x2.arc(px,py,R*0.86,0,7);x2.fill();
  x2.beginPath();x2.arc(px,py,R*0.3,0,7);x2.fillStyle=p.metal;x2.fill();
  x2.beginPath();x2.arc(px-R*0.1,py-R*0.12,R*0.12,0,7);x2.fillStyle='rgba(255,255,255,.25)';x2.fill();}
function drawCabinet(i,s,p){
  const S=S3(),r=cabR(s),cc=col(s),lit=!s.mute;
  const [bx,by]=P3(s.x,s.y,0),[tx,ty]=P3(s.x,s.y,s.h??EAR);
  x2.globalAlpha=s.mute?0.34:1;
  x2.beginPath();x2.ellipse(bx,by,r*S*1.05,r*S*0.5,0,0,7);x2.fillStyle=p.shade;x2.fill();
  if(Math.abs((s.h??EAR))>0.05){x2.strokeStyle=p.text2;x2.lineWidth=2;x2.globalAlpha=(s.mute?0.2:0.5);
    x2.beginPath();x2.moveTo(bx,by);x2.lineTo(tx,ty);x2.stroke();x2.globalAlpha=s.mute?0.34:1;}
  const w2=r*S,h2=(s.sub?0.78:s.band==='Tweeter'?0.62:0.92)*S,d2=r*S*0.7;
  x2.beginPath();x2.moveTo(tx-w2,ty-h2);x2.lineTo(tx+w2,ty-h2);x2.lineTo(tx+w2+d2*0.5,ty-h2+d2*0.5);x2.lineTo(tx-w2+d2*0.5,ty-h2+d2*0.5);x2.closePath();
  x2.fillStyle=p.cabTop;x2.fill(); // top
  x2.beginPath();x2.moveTo(tx-w2,ty-h2);x2.lineTo(tx-w2+d2*0.5,ty-h2+d2*0.5);x2.lineTo(tx-w2+d2*0.5,ty+d2*0.5);x2.lineTo(tx-w2,ty);x2.closePath();
  x2.fillStyle=p.cabSide;x2.fill(); // side
  x2.beginPath();x2.rect(tx-w2,ty-h2,w2*2,h2); // baffle
  const gg=x2.createLinearGradient(tx-w2,ty-h2,tx+w2,ty);
  gg.addColorStop(0,p.cab);gg.addColorStop(1,isLight()?'#b6bdcb':'#242e3f');
  x2.fillStyle=gg;x2.fill();
  x2.lineWidth=2;x2.strokeStyle=lit?cc:p.metal;x2.stroke(); // colored ring = speaker type
  if(s.sub){ // subwoofer: big driver, port slot, four feet
    driver(tx,ty-h2*0.46,w2*0.72,p,cc,lit);
    x2.fillStyle=p.hole;x2.fillRect(tx-w2*0.62,ty-h2*0.06,w2*1.24,Math.max(2,h2*0.09));
    x2.fillStyle=p.cabSide;
    for(const sx2 of[-1,1])for(const sy2 of[0,1])x2.fillRect(tx+sx2*w2*0.8-2,ty-h2*0.02+sy2*h2*0.1,4,4);
  }else if(s.band==='Tweeter'){ // tweeter: shallow waveguide with a dome
    x2.beginPath();x2.moveTo(tx-w2*0.62,ty-h2*0.62);x2.lineTo(tx+w2*0.62,ty-h2*0.62);
    x2.lineTo(tx+w2*0.4,ty-h2*0.16);x2.lineTo(tx-w2*0.4,ty-h2*0.16);x2.closePath();
    x2.fillStyle=p.cabSide;x2.fill();x2.strokeStyle=p.metal;x2.lineWidth=1.5;x2.stroke();
    driver(tx,ty-h2*0.4,w2*0.32,p,cc,lit);
    x2.beginPath();x2.ellipse(tx,ty-h2*0.4,w2*0.16,w2*0.13,0,0,7);x2.fillStyle=p.metal;x2.fill();
  }else{ // 2-way: tweeter over mid/bass woofer, reflex port, badge
    x2.beginPath();x2.moveTo(tx-w2*0.55,ty-h2*0.82);x2.lineTo(tx+w2*0.55,ty-h2*0.82);
    x2.lineTo(tx+w2*0.34,ty-h2*0.56);x2.lineTo(tx-w2*0.34,ty-h2*0.56);x2.closePath();
    x2.fillStyle=p.cabSide;x2.fill(); // waveguide
    x2.beginPath();x2.ellipse(tx,ty-h2*0.7,w2*0.17,w2*0.14,0,0,7);x2.fillStyle=p.metal;x2.fill(); // dome tweeter
    driver(tx,ty-h2*0.34,w2*0.6,p,cc,lit);
    x2.fillStyle=p.hole;x2.beginPath();x2.arc(tx,ty-h2*0.08,w2*0.13,0,7);x2.fill(); // bass port
    x2.fillStyle=cc;x2.fillRect(tx-w2*0.5,ty-h2*0.005,w2,Math.max(1.5,h2*0.03)); // badge
  }
  if(i===selIdx){x2.lineWidth=2.5;x2.strokeStyle=p.sel;x2.strokeRect(tx-w2-3,ty-h2-3,w2*2+6,h2+3);}
  x2.fillStyle=p.lbl;x2.font='bold 11px system-ui';
  x2.fillText(s.sub?'SUB':(i+1)+(s.ch||''),tx-8,ty+h2*0.35);
  x2.fillStyle=p.text2;x2.font='10px system-ui';x2.fillText((s.h??EAR).toFixed(1)+'m',tx+w2+4,ty-h2/2+3);
  x2.globalAlpha=1;}
function drawPerson(p){ // a cartoon listener, not a dot: legs, torso, arms, head, facing
  const S=S3(),a=listener.yaw;
  const base=P3(listener.x,listener.y,0),head=P3(listener.x,listener.y,1.62);
  const fwd=P3(listener.x-Math.sin(a)*0.6,listener.y-Math.cos(a)*0.6,1.62);
  let fx=fwd[0]-head[0],fy=fwd[1]-head[1];const fl=Math.hypot(fx,fy)||1;fx/=fl;fy/=fl;
  const sx=-fy,sy=fx,u=S*0.36,hipY=base[1]+(head[1]-base[1])*0.42;
  const pA=P3(listener.x-Math.sin(a)*1.2-Math.cos(a)*0.7,listener.y-Math.cos(a)*1.2+Math.sin(a)*0.7,0.01);
  const pB=P3(listener.x-Math.sin(a)*1.2+Math.cos(a)*0.7,listener.y-Math.cos(a)*1.2-Math.sin(a)*0.7,0.01);
  x2.beginPath();x2.ellipse(base[0],base[1],0.45*S,0.22*S,0,0,7);x2.fillStyle=p.shade;x2.fill();
  x2.beginPath();x2.moveTo(base[0],base[1]);x2.lineTo(...pA);x2.lineTo(...pB);x2.closePath();
  x2.fillStyle='rgba(52,211,153,.22)';x2.fill(); // hearing cone
  x2.lineCap='round';
  for(const sgn of[-1,1]){ // legs
    x2.strokeStyle=p.pants;x2.lineWidth=S*0.14;
    x2.beginPath();x2.moveTo(head[0]+sx*u*0.4*sgn,hipY);x2.lineTo(base[0]+sx*u*0.55*sgn+fx*S*0.1,base[1]);x2.stroke();
    x2.beginPath();x2.ellipse(base[0]+sx*u*0.55*sgn+fx*S*0.12,base[1],S*0.09,S*0.05,0,0,7);x2.fillStyle=p.hole;x2.fill();}
  x2.beginPath(); // torso
  x2.moveTo(head[0]+sx*u,head[1]+S*0.16);
  x2.quadraticCurveTo(head[0]+sx*u*1.12,(head[1]+hipY)/2,base[0]+sx*u*0.72,hipY+S*0.1);
  x2.lineTo(base[0]-sx*u*0.72,hipY+S*0.1);
  x2.quadraticCurveTo(head[0]-sx*u*1.12,(head[1]+hipY)/2,head[0]-sx*u,head[1]+S*0.16);
  x2.closePath();
  const tg=x2.createLinearGradient(head[0]-u,head[1],head[0]+u,hipY);tg.addColorStop(0,p.shirt);tg.addColorStop(1,isLight()?'#10b981':'#15803d');
  x2.fillStyle=tg;x2.fill();x2.strokeStyle='rgba(0,0,0,.25)';x2.lineWidth=1;x2.stroke();
  x2.strokeStyle=p.shirt;x2.lineWidth=S*0.11; // arms
  for(const sgn of[-1,1]){x2.beginPath();
    x2.moveTo(head[0]+sx*u*0.95*sgn,head[1]+S*0.22);
    x2.lineTo(head[0]+sx*u*1.5*sgn+fx*S*0.12,hipY-S*0.05);x2.stroke();
    x2.beginPath();x2.arc(head[0]+sx*u*1.5*sgn+fx*S*0.12,hipY-S*0.05,S*0.06,0,7);x2.fillStyle=p.skin;x2.fill();}
  const hr=S*0.3;
  x2.beginPath();x2.arc(head[0],head[1],hr,0,7);x2.fillStyle=p.skin;x2.fill(); // head
  x2.strokeStyle='rgba(0,0,0,.22)';x2.lineWidth=1.5;x2.stroke();
  x2.beginPath();x2.arc(head[0],head[1],hr,Math.PI*0.85,Math.PI*2.15); // hair
  x2.lineWidth=hr*0.42;x2.strokeStyle=p.hair;x2.stroke();
  x2.beginPath();x2.arc(head[0]+fx*hr*0.5,head[1]+fy*hr*0.5-fy*hr*0.18,hr*0.13,0,7); // eyes, offset to face
  x2.fillStyle='#222';x2.fill();
  x2.beginPath();x2.arc(head[0]+fx*hr*0.95,head[1]+fy*hr*0.95,hr*0.16,0,7); // nose
  x2.fillStyle=p.skin;x2.fill();x2.stroke();
  x2.beginPath();x2.moveTo(head[0]+fx*S*0.34,head[1]+fy*S*0.34); // heading arrow
  x2.lineTo(head[0]+fx*S*0.72,head[1]+fy*S*0.72);
  x2.strokeStyle=p.shirt;x2.lineWidth=2.5;x2.stroke();
  x2.beginPath();x2.arc(head[0]+fx*S*0.72,head[1]+fy*S*0.72,S*0.08,0,7);x2.fillStyle=p.shirt;x2.fill();}
function draw(){
  x2.clearRect(0,0,CANVAS_WIDTH,CANVAS_HEIGHT);
  const p=pal(),S=S3(),v=0.5*S;
  const wall=(a,b2,cc,d)=>{x2.beginPath();x2.moveTo(...a);x2.lineTo(...b2);x2.lineTo(cc[0],cc[1]-0.9*S*room.h);x2.lineTo(d[0],d[1]-0.9*S*room.h);x2.closePath();
    const g=x2.createLinearGradient(a[0],a[1],cc[0],cc[1]);g.addColorStop(0,p.wall0);g.addColorStop(1,p.wall1);x2.fillStyle=g;x2.fill();};
  wall(P3(0,0,0),P3(room.w,0,0),P3(room.w,0,0),P3(0,0,0));
  wall(P3(0,0,0),P3(0,room.l,0),P3(0,room.l,0),P3(0,0,0));
  x2.beginPath();x2.moveTo(...P3(0,0,0));x2.lineTo(...P3(room.w,0,0));x2.lineTo(...P3(room.w,room.l,0));x2.lineTo(...P3(0,room.l,0));x2.closePath();
  const fg=x2.createLinearGradient(0,CY3()-v*room.l/2,0,CANVAS_HEIGHT);fg.addColorStop(0,p.floor0);fg.addColorStop(1,p.floor1);x2.fillStyle=fg;x2.fill();
  x2.strokeStyle=p.edge;x2.lineWidth=1.5;x2.stroke();
  x2.strokeStyle=p.grid;x2.lineWidth=1;
  for(let gx=1;gx<room.w;gx++){x2.beginPath();x2.moveTo(...P3(gx,0,0.005));x2.lineTo(...P3(gx,room.l,0.005));x2.stroke();}
  for(let gy=1;gy<room.l;gy++){x2.beginPath();x2.moveTo(...P3(0,gy,0.005));x2.lineTo(...P3(room.w,gy,0.005));x2.stroke();}
  x2.fillStyle=p.text2;x2.font='bold 11px system-ui';
  const st=P3(0,0,room.h);x2.fillText('FRONT WALL',st[0]+8,st[1]+18);
  furniture.slice().sort((a,b)=>a.y-b.y).forEach(o=>{
    const corners=[[o.x,o.y],[o.x+o.w,o.y],[o.x+o.w,o.y+o.d],[o.x,o.y+o.d]];
    for(const [ids,zs,shade] of [[[0,1,1,0],[0,0,o.h,o.h],p.fWood2],[[1,2,2,1],[0,0,o.h,o.h],p.fHard],[[0,1,2,3],[o.h,o.h,o.h,o.h],o.type==='Wardrobe'?p.fHard:p.fWood]]){
      x2.beginPath();ids.forEach((id,i)=>{const q=P3(...corners[id],zs[i]);if(i)x2.lineTo(...q);else x2.moveTo(...q);});x2.closePath();x2.fillStyle=shade;x2.fill();x2.strokeStyle=p.edge;x2.stroke();}
    const q=P3(o.x+o.w/2,o.y+o.d/2,o.h);x2.fillStyle=p.lbl;x2.font='14px system-ui';x2.fillText(o.type,q[0]-25,q[1]);
  });
  [...sps.keys()].sort((a,b2)=>sps[a].y-sps[b2].y).forEach(i=>drawCabinet(i,sps[i],p));
  drawPerson(p);
  display2.setTransform(1,0,0,1,0,0);display2.clearRect(0,0,c.width,c.height);display2.imageSmoothingEnabled=true;display2.imageSmoothingQuality='high';display2.drawImage(renderCanvas,0,0,c.width,c.height);
}
let drag=null, moved=false;
function evtPos(e){const r=c.getBoundingClientRect();
  return toM((e.clientX-r.left)*CANVAS_WIDTH/r.width,(e.clientY-r.top)*CANVAS_HEIGHT/r.height);}
function pick(e){
  const r=c.getBoundingClientRect();
  const px=(e.clientX-r.left)*CANVAS_WIDTH/r.width,py=(e.clientY-r.top)*CANVAS_HEIGHT/r.height;
  let best=null,bd=Infinity;
  sps.forEach((s,i)=>{const [sx,sy]=P3(s.x,s.y,s.h??EAR);
    const d=Math.hypot(sx-px,sy-0.45*S3()-py);
    if(Math.abs(sx-px)<Math.max(16,cabR(s)*S3()+6)&&Math.abs(sy-0.45*S3()-py)<Math.max(20,0.45*S3()+6)&&d<bd){bd=d;best={t:'s',i};}});
  if(!best)[...furniture.keys()].sort((a,b)=>furniture[a].y-furniture[b].y).forEach(i=>{
    const o=furniture[i],corners=[[o.x,o.y],[o.x+o.w,o.y],[o.x+o.w,o.y+o.d],[o.x,o.y+o.d]];
    for(const [ids,zs] of [[[0,1,1,0],[0,0,o.h,o.h]],[[1,2,2,1],[0,0,o.h,o.h]],[[0,1,2,3],[o.h,o.h,o.h,o.h]]]){
      const path=new Path2D();ids.forEach((id,j)=>{const p=P3(...corners[id],zs[j]);if(j)path.lineTo(...p);else path.moveTo(...p);});path.closePath();
      if(x2.isPointInPath(path,px,py))best={t:'f',i};
    }
  });
  const [lx,ly]=P3(listener.x,listener.y,1.62);
  if(Math.hypot(lx-px,ly-py)<Math.max(18,0.45*S3()))best={t:'l'};
  return best;
}
let syncQueued=false,drawQueued=false;
function requestDraw(){if(drawQueued)return;drawQueued=true;requestAnimationFrame(()=>{drawQueued=false;draw();});}
function syncAudio(){if(syncQueued)return;syncQueued=true; // one audio update per frame max
  requestAnimationFrame(()=>{syncQueued=false;try{
    if(live.length){live.forEach((o,i)=>{if(sps[i])o.s=sps[i];});updateLis();}
    else if(AC&&AC.listener)updateLis();
  }catch(e){if(!window._ae){window._ae=1;say('audio update error: '+((e&&e.message)||e));}}});}
c.addEventListener('pointerdown',e=>{if(!e.isPrimary||e.button!==0)return;e.preventDefault();
  drag=pick(e);moved=false;
  if(drag){const m=evtPos(e),o=drag.t==='s'?sps[drag.i]:drag.t==='f'?furniture[drag.i]:listener;drag.dx=o.x-m.x;drag.dy=o.y-m.y;}
  if(drag&&drag.t==='s'){selIdx=drag.i;showSel();draw();}
  try{c.setPointerCapture(e.pointerId);}catch(err){}});
c.addEventListener('pointermove',e=>{
  if(!e.isPrimary)return;
  if(!drag){moved=true;return;}e.preventDefault();moved=true;
  const m=evtPos(e),o=drag.t==='s'?sps[drag.i]:drag.t==='f'?furniture[drag.i]:listener;
  o.x=Math.max(0,Math.min(room.w-(drag.t==='f'?o.w:0),m.x+drag.dx));
  o.y=Math.max(0,Math.min(room.l-(drag.t==='f'?o.d:0),m.y+drag.dy));
  syncAudio();requestDraw();
});
c.addEventListener('pointerup',e=>{
  if(!e.isPrimary)return;
  if(!moved&&!drag){const m=evtPos(e);
    if(m.x>=0&&m.x<=room.w&&m.y>=0&&m.y<=room.l){listener.x=m.x;listener.y=m.y;syncAudio();draw();}}
  if(drag?.t==='f')showFurniture();else if(drag?.t==='s')showSel();
  if(moved)draw();drag=null;});
c.addEventListener('pointercancel',()=>{if(drag?.t==='f')showFurniture();drag=null;});
window.addEventListener('keydown',e=>{
  const t=(e.target&&e.target.tagName)||'',interactive=e.target?.closest?.('button,a,summary,[role=tab]');
  if(t==='INPUT'||t==='SELECT'||t==='TEXTAREA'||interactive)return; // never move the room while operating another control
  const st=0.3;let used=true;
  if(e.key==='ArrowUp'||e.key==='w')listener.y-=st;
  else if(e.key==='ArrowDown'||e.key==='s')listener.y+=st;
  else if(e.key==='ArrowLeft'||e.key==='a')listener.x-=st;
  else if(e.key==='ArrowRight'||e.key==='d')listener.x+=st;
  else if((e.key==='Delete'||e.key==='Backspace')&&sps[selIdx]){used=true;
    sps.splice(selIdx,1);selIdx=0;if(playing.length)seekTo(curPos());showSel();}
  else used=false;
  if(used){e.preventDefault();
    listener.x=Math.max(0,Math.min(room.w,listener.x));listener.y=Math.max(0,Math.min(room.l,listener.y));
    syncAudio();requestDraw();}
});
function showSel(){
  const s=sps[selIdx];$('sel').replaceChildren();if(!s){$('sel').textContent='Add a speaker to begin.';return;}
  for(const [key,name,max] of [['x','Speaker X',room.w],['y','Speaker Y',room.l],['h','Speaker height',room.h]]){
    const label=document.createElement('label'),input=document.createElement('input');label.textContent=name+' (m) ';input.type='number';input.min=0;input.max=max;input.step=0.05;input.value=s[key]??EAR;input.setAttribute('aria-label',name);
    input.onchange=()=>{const v=input.valueAsNumber;if(Number.isFinite(v))s[key]=Math.max(0,Math.min(max,v));input.value=s[key];syncAudioSafe();draw();};label.append(input);$('sel').append(label);
  }
  const lb=document.createElement('label');lb.textContent=`Spk ${s.sub?'SUB':selIdx+1} vol `;
  const rg=document.createElement('input');rg.type='range';rg.min=0;rg.max=4;rg.step=0.1;rg.value=s.v;
  rg.oninput=e=>{s.v=+e.target.value;updateLis();};
  const ch=document.createElement('select');['L','R','M'].forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;if((s.ch||'M')===m)o.selected=true;ch.append(o);});
  ch.title='which channel this speaker plays';ch.disabled=!!s.sub;
  ch.onchange=e=>{s.ch=e.target.value;if(playing.length)seekTo(curPos());else updateLis();draw();}; // rebuild: chain count changes
  const bd=document.createElement('select');['Full','Tweeter','Vocal','Bass','Bright'].forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;if((s.band||'Full')===m)o.selected=true;bd.append(o);});
  bd.title='speaker type / instrument feel';bd.disabled=!!s.sub;
  bd.onchange=e=>{s.band=e.target.value;updateLis();draw();};
  const hl=document.createElement('label');hl.textContent='h ';
  const hr=document.createElement('input');hr.type='range';hr.min=0;hr.max=room.h;hr.step=0.1;hr.value=(s.h??EAR);hr.style.width='80px';
  hr.title='height in meters';
  hr.oninput=e=>{s.h=+e.target.value;updateLis();draw();};
  const mu=document.createElement('button');mu.textContent=s.mute?'Unmute':'Mute';
  mu.onclick=()=>{s.mute=!s.mute;updateLis();showSel();draw();};
  const st=document.createElement('select');['mix',...Object.keys(stemBufs)].forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;if((s.stem||'mix')===n)o.selected=true;st.append(o);});
  st.title='stem feed (separate in Stems… first)';st.onchange=e=>{s.stem=e.target.value==='mix'?null:e.target.value;if(playing.length)seekTo(curPos());};
  const pg=document.createElement('button');pg.textContent='Ping';pg.title='beep through THIS speaker only — dead box vs dead channel test';
  pg.onclick=()=>{if(!playing.length){alert('press Play first');return;}
    const o=live[selIdx];if(!o||!o.chains.length)return;
    const t=AC.currentTime,osc=AC.createOscillator(),ev=AC.createGain();
    osc.frequency.value=660;ev.gain.setValueAtTime(0.0001,t);ev.gain.linearRampToValueAtTime(0.9,t+0.02);ev.gain.exponentialRampToValueAtTime(0.001,t+0.45);
    osc.connect(ev);ev.connect(o.chains[0].g);osc.start(t);osc.stop(t+0.5);};
  const del=document.createElement('button');del.textContent='Delete';del.onclick=()=>{sps.splice(selIdx,1);selIdx=0;if(playing.length)seekTo(curPos());showSel();draw();};
  const hint=document.createElement('span');hint.textContent=' drag in room to move (live while playing). Mute solos the rest.';
  $('sel').append(lb,rg,ch,bd,hl,hr,st,mu,pg,del,hint);
}
