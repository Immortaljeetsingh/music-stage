// Web Audio lowpass/highpass Q is specified in dB. 0.707 there means linear Q ~1.085, a +1.75 dB peak at the
// corner; -3.01 dB is linear 1/sqrt(2), the maximally flat Butterworth response these filters intend.
const BUTTERWORTH_Q_DB=20*Math.log10(Math.SQRT1_2);
// AudioParam writes cross to the audio thread and append automation events. UI handlers run at display
// rate, so a parameter is written only when its target actually changes.
function assignParam(param,value){if(!param||!Number.isFinite(value)||param.__musicStageValue===value)return;param.value=value;param.__musicStageValue=value;param.__musicStageTarget=value;}
function scheduleParam(param,value,time,tau){if(!param||!Number.isFinite(value)||param.__musicStageTarget===value)return;param.setTargetAtTime(value,time,tau);param.__musicStageTarget=value;param.__musicStageValue=undefined;}
function placePanner(panner,x,y,z){if(panner.positionX){assignParam(panner.positionX,x);assignParam(panner.positionY,y);assignParam(panner.positionZ,z);}else panner.setPosition(x,y,z);}
const impulseCache=new Map();
function impulse(dur,decay){ // deterministic noise tail: identical room settings reuse the rendered buffer
  const rate=AC.sampleRate,key=`${rate}:${dur}:${decay}`,cached=impulseCache.get(key);if(cached)return cached;
  const r=Math.ceil(rate*dur),b=AC.createBuffer(1,r,rate),d=b.getChannelData(0);
  let seed=17;
  for(let i=0;i<r;i++){seed=(1664525*seed+1013904223)>>>0;d[i]=(seed/2147483648-1)*Math.pow(1-i/r,decay);}
  if(impulseCache.size>=6)impulseCache.delete(impulseCache.keys().next().value);impulseCache.set(key,b);
  return b;
}
function dist(a,b2){const ah=('h' in a)?a.h:EAR,bh=('h' in b2)?b2.h:EAR;
  return Math.hypot(a.x-b2.x,a.y-b2.y,ah-bh);}
// head-local direction of a speaker (+chain offset): az 0=ahead +=right, el +=up. (f=forward, r=right)
function headLocal(s,off){
  const dx=s.x+(off||0)-listener.x, dy=(s.h??EAR)-EAR, dz=s.y-listener.y;
  const y=listener.yaw;
  const lx=dx*Math.cos(y)-dz*Math.sin(y), lz=dx*Math.sin(y)+dz*Math.cos(y);
  return {az:Math.atan2(lx,-lz), el:Math.atan2(dy,Math.hypot(lx,lz)), d:Math.hypot(dx,dy,dz)};
}
// parametric pinna+head render (Brown&Duda structural model family):
// Woodworth ITD + van Opstal ILD + head-shadow lowpass + Blauert-band elevation EQ + near-field parallax.
function setPreciseDir(ch,az,el,d){
  const t=AC.currentTime;
  for(const side of[-1,1]){
    const E=side<0?ch.eL:ch.eR;
    const onSide=Math.sin(az)*side>0;
    const a=Math.min(Math.abs(az),Math.PI);
    let itd=0,ild=0;
    if(!onSide){
      const tt=a>Math.PI/2?(Math.sin(a)+Math.PI-a):(a+Math.sin(a));
      itd=0.0875/343*tt;
      ild=0.18*Math.sqrt(8000)*Math.sin(a);
      if(d<1)ild+=(1-d)*10*Math.sin(a);
    }
    scheduleParam(E.d.delayTime,itd,t,0.02);
    scheduleParam(E.e.gain,Math.pow(10,-ild/20),t,0.02);
    scheduleParam(E.f.frequency,onSide?19000:Math.max(2500,19000-16000*Math.sin(a)),t,0.02);
  }
  const se=Math.max(-1,Math.min(1,Math.sin(el)));
  if(se>=0){assignParam(ch.eq1.frequency,8000);scheduleParam(ch.eq1.gain,2+6*se,t,0.03);}
  else{assignParam(ch.eq1.frequency,6000);scheduleParam(ch.eq1.gain,5*se,t,0.03);}
  const behind=Math.cos(az)<0?-Math.cos(az):0;
  scheduleParam(ch.eq2.gain,5*behind,t,0.03);
}
// image-source early reflections: 6 first-order wall bounces land in the 20-80ms zone that
// research says externalizes sound. Fed PRE distance-gain (constant room level) so DRR varies
// with distance like a real room — our old post-gain send kept DRR flat (distance felt dead).
function earlyTaps(s,feed,useHQ){
  const W=room.w,L=room.l,H=room.h,sh=(s.h??EAR),refl=1-(+$('wallAbs').value||0.5),modeScale={clarity:0.24,room:0.5,immersive:0.72}[currentRenderMode()]||0.5;
  const imgs=[{x:-s.x,y:s.y,h:sh},{x:2*W-s.x,y:s.y,h:sh},{x:s.x,y:-s.y,h:sh},{x:s.x,y:2*L-s.y,h:sh},{x:s.x,y:s.y,h:-sh},{x:s.x,y:s.y,h:2*H-sh}];
  return imgs.map(im=>{
    const path=Math.hypot(im.x-listener.x,im.y-listener.y,im.h-EAR);
    const dl=AC.createDelay(0.12);assignParam(dl.delayTime,Math.min(0.1,path/343));
    const g=AC.createGain();assignParam(g.gain,modeScale*refl/(1+0.8*path));
    const p=AC.createPanner();p.panningModel=useHQ?'equalpower':'HRTF';p.distanceModel='inverse';p.rolloffFactor=0;
    placePanner(p,im.x,im.h,im.y);
    feed.connect(dl);dl.connect(g);g.connect(p);p.connect(master);
    return {dl,g,p};
  });
}
function updTaps(o){
  if(!o.taps)return;const s=o.s,W=room.w,L=room.l,H=room.h,sh=(s.h??EAR);
  const refl=1-(+$('wallAbs').value||0.5),t=AC.currentTime,modeScale={clarity:0.24,room:0.5,immersive:0.72}[currentRenderMode()]||0.5;
  const imgs=[{x:-s.x,y:s.y,h:sh},{x:2*W-s.x,y:s.y,h:sh},{x:s.x,y:-s.y,h:sh},{x:s.x,y:2*L-s.y,h:sh},{x:s.x,y:s.y,h:-sh},{x:s.x,y:s.y,h:2*H-sh}];
  o.taps.forEach((tp,i)=>{const im=imgs[i];
    const path=Math.hypot(im.x-listener.x,im.y-listener.y,im.h-EAR);
    scheduleParam(tp.dl.delayTime,Math.min(0.1,path/343),t,0.03);
    scheduleParam(tp.g.gain,modeScale*refl/(1+0.8*path),t,0.03); // restrained reflection energy protects clarity and interaural separation
    placePanner(tp.p,im.x,im.h,im.y);});
}
// reality curve: loud up close, clearly gone far. d in meters -> gain (~11dB near-to-far).
function proxGain(d){return Math.min(3.5,1.4/(1+0.45*Math.max(0,d-0.4)));}
const OUTPUT_CEILING=Math.pow(10,-1/20);
function currentRenderMode(){return $('renderMode')?.value||'clarity';}
function configureBiquad(node,type,frequency,q,gain=0){ // cached: identical settings are not re-sent every frame
  const f=Math.min(frequency,node.context.sampleRate*0.49),key=`${type}:${f}:${q}:${gain}`;
  if(node.__musicStageFilter===key)return;node.__musicStageFilter=key;
  node.type=type;node.frequency.value=f;node.Q.value=q;node.gain.value=gain;}
function setIdentityFilter(node){configureBiquad(node,'peaking',1000,0.707,0);} // 0 dB peaking section: exact unity
function setLowPassFilter(node,frequency,q=BUTTERWORTH_Q_DB){configureBiquad(node,'lowpass',frequency,q);}
function setHighPassFilter(node,frequency,q=BUTTERWORTH_Q_DB){configureBiquad(node,'highpass',frequency,q);}
function configureAirFilter(node,speaker,distance,airOn){if(speaker.sub)setLowPassFilter(node,120);else if(airOn)setLowPassFilter(node,Math.max(12000,20000/(1+distance*0.08)));else setIdentityFilter(node);}
function configureObstructionFilter(node,isBlocked){if(isBlocked)setLowPassFilter(node,1800);else setIdentityFilter(node);}
function rigNormalization(mode=currentRenderMode()){
  let left=0,right=0,total=0;
  for(const speaker of sps){if(speaker.mute)continue;const volume=Number.isFinite(speaker.v)?Math.max(0,speaker.v):1,weight=volume*proxGain(dist(speaker,listener))*(speaker.sub?1.5:1),channel=speaker.sub?'SUB':(speaker.ch||'M');
    if(mode==='clarity'){if(channel==='L')left+=weight;else if(channel==='R')right+=weight;else{left+=weight;right+=weight;}}
    else total+=weight*(channel==='M'?2:1);
  }
  const load=mode==='clarity'?Math.max(left,right):total,downstream=Math.max(1,(Number($('mvol')?.value)||1)*Math.max(1,TRIM?.l||1,TRIM?.r||1)*1.1),baseTarget=mode==='clarity'?0.82:(mode==='room'?0.58:0.52),target=baseTarget/downstream;return load>target?target/load:1;
}
function clarityPan(speaker,targetEar){if(targetEar==='M')return 0;if(!speaker.stem)return targetEar==='L'?-1:1;const base=Math.max(-0.82,Math.min(0.82,(speaker.x-listener.x)/Math.max(1,room.w*0.38))),spread=targetEar==='L'?-0.16:0.16;return Math.max(-1,Math.min(1,base+spread));}
function stopPb(){const pos=curPosSafe();playing.forEach(s=>{try{s.stop();s.disconnect();}catch(e){}});playing=[];live=[];anL=anR=null;
  if(master)master.disconnect();verb=null;wet=null;playOffset=pos;} // transport labels are owned by player.js
function curPosSafe(){try{return curPos();}catch(e){return playOffset;}}
function startPb(offset){
  // Coherent-sum headroom is based on actual speaker gain, distance and routing—not sqrt(N), which can clip correlated copies.
  const renderMode=currentRenderMode(),norm=rigNormalization(renderMode);
  master=AC.createGain();assignParam(master.gain,(+$('mvol').value||0)*norm); // one gain stage: user volume x headroom
  const clarityOutput=renderMode==='clarity';
  comp=clarityOutput?null:AC.createDynamicsCompressor(); // Clarity remains fully linear; spatial modes retain emergency dynamics protection
  if(comp){comp.threshold.value=-1.5;comp.knee.value=0;comp.ratio.value=20;comp.attack.value=0.003;comp.release.value=0.12;}
  balN=AC.createStereoPanner();balN.pan.value=+$('bal').value;
  // per-ear trim: split → trimL/trimR → merge; the linked limiter follows trims and optional EQ
  const tsp=AC.createChannelSplitter(2),tmg=AC.createChannelMerger(2);
  trimL=AC.createGain();trimR=AC.createGain();trimL.gain.value=TRIM.l;trimR.gain.value=TRIM.r;
  master.connect(balN);balN.connect(tsp);
  tsp.connect(trimL,0);tsp.connect(trimR,1);trimL.connect(tmg,0,0);trimR.connect(tmg,0,1);
  // headphone correction chain (after trim, before out): preamp + profile biquads
  let output=tmg;hpNodes=[];
  const prof=HP_PROFILES[$('hpdev').value]; // pro3 has no verified profile: falls through to bypass
  if(prof){const pre=AC.createGain();pre.gain.value=Math.pow(10,prof.pre/20);output.connect(pre);output=pre;hpNodes.push(pre);
    prof.f.forEach(([fc,ty,g2,q])=>{const bq=AC.createBiquadFilter();bq.type=ty;bq.frequency.value=Math.min(fc,AC.sampleRate*0.49);bq.Q.value=q;bq.gain.value=g2;output.connect(bq);output=bq;hpNodes.push(bq);});}
  if(comp){output.connect(comp);output=comp;} // only opt-in spatial modes use emergency dynamics; Clarity stays sample-linear
  const ceiling=AC.createWaveShaper(),curve=new Float32Array(4097);
  for(let i=0;i<curve.length;i++){const v=i*2/(curve.length-1)-1;curve[i]=v*OUTPUT_CEILING;}
  ceiling.curve=curve;ceiling.oversample='none'; // exactly linear below 0 dBFS; compressor prevents normal signals reaching the emergency clamp
  output.connect(ceiling);output=ceiling;output.connect(AC.destination);
  try{ // live output meters: visible proof of what each ear is actually fed
    const msp=AC.createChannelSplitter(2);
    anL=AC.createAnalyser();anR=AC.createAnalyser();anL.fftSize=512;anR.fftSize=512;
    output.connect(msp);msp.connect(anL,0);msp.connect(anR,1);
  }catch(e){anL=anR=null;}
  // A ConvolverNode runs its FFTs every render quantum even when its return is silent, so the late tail
  // exists only when reverb is audible (roomAmt > 0); raising roomAmt from zero while playing rebuilds.
  const F=furnish(),reverbAmount=Math.max(0,+$('roomAmt').value||0),wallsOn=$('walls').checked; // generic material-class approximation, not measured for user's furniture
  verb=null;wet=null;
  if(reverbAmount>0){
    verb=AC.createConvolver();
    verb.buffer=impulse(0.35+Math.max(room.w,room.l)*0.06,3.2/F.rt); // short late tail; early pattern carries the room
    const wetLp=AC.createBiquadFilter();setLowPassFilter(wetLp,F.lp); // late tail carries DRR, not detail
    wet=AC.createGain();wet.gain.value=reverbAmount;
    verb.connect(wetLp);wetLp.connect(wet);wet.connect(master);
  }
  live=[];live.norm=norm;
  const maxD0=Math.max(0.1,...sps.map(s=>dist(s,listener)));
  const useHQ=true;
  const usePrecise=renderMode!=='clarity'&&$('hq').checked;
  sps.forEach(s=>{
    const b=(s.stem&&stemBufs[s.stem])||buf;if(!b)return; // box has no audio (mix gone after reload?) — skip, don't crash
    const src=AC.createBufferSource();src.buffer=b;src.loop=true;
    // band filter BEFORE split (biquad keeps L/R separate) + mono-feed was killing the record's own L/R movement,
    // so M behaves like a real stereo box: L and R through two panners ±0.35m around the cabinet.
    const bf=AC.createBiquadFilter();const setBand=()=>{const band=s.sub?'Sub':(s.band||'Full');
      if(band==='Sub')setLowPassFilter(bf,120);
      else if(band==='Tweeter')setHighPassFilter(bf,2500);
      else if(band==='Bass')setLowPassFilter(bf,300);
      else if(band==='Vocal')configureBiquad(bf,'bandpass',1200,0.8); // bandpass Q is linear
      else if(band==='Bright')setHighPassFilter(bf,5000);
      else setIdentityFilter(bf);};
    setBand();
    const sp=AC.createChannelSplitter(2),gL=AC.createGain(),gR=AC.createGain();
    const xLR=AC.createGain(),xRL=AC.createGain(),oL=AC.createGain(),oR=AC.createGain();
    src.connect(bf);bf.connect(sp);sp.connect(gL,0);sp.connect(gR,b.numberOfChannels<2?0:1);
    gL.connect(oL);gR.connect(oR);gL.connect(xRL);xRL.connect(oR);gR.connect(xLR);xLR.connect(oL);
    // M/S-style width (Blumlein matrix idea): k=1-w crossfeed. w=1 record, 0 mono, 2 hyper-wide.
    const setW=()=>{const k=1-Number($('width').value),scale=chMode()==='M'?1/(1+Math.abs(k)):1;assignParam(oL.gain,scale);assignParam(oR.gain,scale);assignParam(xLR.gain,k*scale);assignParam(xRL.gain,k*scale);}; // bounded stereo crossfeed keeps width comparisons near a stable level
    const flip=m=>m==='L'?'R':m==='R'?'L':m;
    const chMode=()=>{const m0=s.sub?'SUB':(s.ch||'M');return (SWAP&&!s.sub)?flip(m0):m0;};
    const setCh=()=>{const m=chMode();let left=m==='L'?1:m==='R'?0:1,right=m==='R'?1:m==='L'?0:1;
      if(s.sub){left=0.5;right=0.5;}assignParam(gL.gain,left);assignParam(gR.gain,right);};
    setCh();setW();
    const mkChain=(inputs,off,targetEar='M')=>{
      const g=AC.createGain();assignParam(g.gain,s.v*(s.mute?0:1)); // headroom lives on the master gain
      inputs.forEach(n=>n.connect(g));
      const occ=AC.createBiquadFilter();configureObstructionFilter(occ,blocked(s,off));
      const lp=AC.createBiquadFilter(),d0=dist(s,listener),airOn=$('air').checked;configureAirFilter(lp,s,d0,airOn);
      const dg=AC.createGain();assignParam(dg.gain,proxGain(d0)*(s.sub?1.5:1)); // manual proximity: panner stays direction-only
      // PA-style arrival alignment: all directs land together (coherent sum, no comb teeth).
      // Reflections keep physical timing — only the direct path aligns.
      const dl=AC.createDelay(0.12);
      assignParam(dl.delayTime,$('align').checked?Math.min(0.09,(maxD0-d0)/343):Math.min(0.05,d0/343));
      g.connect(lp);lp.connect(occ);occ.connect(dg);dg.connect(dl);
      if(usePrecise){
        const eq1=AC.createBiquadFilter();eq1.type='peaking';eq1.Q.value=1.2;
        const eq2=AC.createBiquadFilter();eq2.type='peaking';eq2.frequency.value=1200;eq2.Q.value=1;
        // ear outputs via hard-left/right panners: every browser has PannerNode, identical image, zero compat risk.
        const hardPan=v=>{const p=AC.createStereoPanner();p.pan.value=v;return p;};
        const mkEar=chn=>{const d=AC.createDelay(0.01),e=AC.createGain(),f=AC.createBiquadFilter();
          setLowPassFilter(f,19000);d.connect(e);e.connect(f); // head shadow: Butterworth, no resonant bump
          const p=hardPan(chn?1:-1);f.connect(p);p.connect(master);
          return{d,e,f};};
        const eL=mkEar(0),eR=mkEar(1);
        dl.connect(eq1);eq1.connect(eq2);eq2.connect(eL.d);eq2.connect(eR.d);
        return {mode:'p',g,lp,dg,dl,eq1,eq2,eL,eR,off,occ};
      }
      if(renderMode==='clarity'){
        const p=AC.createStereoPanner();assignParam(p.pan,clarityPan(s,targetEar));dl.connect(p);p.connect(master);
        return {mode:'c',g,lp,dg,dl,p,off,targetEar,occ,s};
      }
      const p=AC.createPanner();p.panningModel='equalpower';p.distanceModel='inverse';p.rolloffFactor=0; // classic engine: direction only, dg does loudness
      placePanner(p,s.x+off,(s.h??EAR),s.y);
      dl.connect(p);p.connect(master);
      return {mode:'h',g,lp,dg,dl,p,off,occ,s};
    };
    const m=chMode();
    const chains=m==='M'?[mkChain([oL],-0.35,'L'),mkChain([oR],0.35,'R')]:m==='L'?[mkChain([oL],0,'L')]:m==='R'?[mkChain([oR],0,'R')]:[mkChain([oL,oR],0,'M')];
    // room send (post air filter, pre obstruction/distance) exists only when reflections or reverb consume it
    const feed=(wallsOn||(verb&&!s.sub))?AC.createGain():null;
    if(feed)chains.forEach(ch=>ch.lp.connect(feed));
    const taps=wallsOn?earlyTaps(s,feed,useHQ):null;
    if(verb&&!s.sub){const rv=AC.createGain();rv.gain.value=0.5*(1.28-F.abs);feed.connect(rv);rv.connect(verb);}
    playing.push(src);live.push({s,gL,gR,bf,chains,taps,setCh,setBand,setW});
  });
  playOffset=offset;playStart=AC.currentTime+0.05;
  playing.forEach(src=>src.start(playStart,offset%src.buffer.duration));
  updateLis();
}
async function togglePlay(){
  AC=AC||new (window.AudioContext||window.webkitAudioContext)();
  await AC.resume();
  if(playing.length){stopPb();return;}
  if(!buf&&!Object.keys(stemBufs).length){alert('upload an mp3 first (mix does not survive reload — re-pick your file)');return;}
  try{startPb(playOffset||0);}
  catch(e){
    // precise branch hit something this browser lacks: fall back to the PannerNode engine (previously working) automatically.
    try{try{master.disconnect();}catch(_){}stopPb();$('hq').checked=false;startPb(playOffset||0);
      say('precise engine blocked ('+((e&&e.message)||e)+') — playing classic mode instead');}
    catch(e2){say('play failed: '+((e2&&e2.message)||e2));}
  }
}
window.addEventListener('error',e=>{try{const m=(e&&e.message)||'';if(m)say('error: '+m);}catch(_){}});
$('play').onclick=togglePlay;

function updateLis(){
  if(!AC||!AC.listener)return;
  const y=listener.yaw,p=listener.pitch||0;
  const fx=-Math.sin(y)*Math.cos(p),fy=Math.sin(p),fz=-Math.cos(y)*Math.cos(p);
  const l=AC.listener;
  if(l.positionX){assignParam(l.positionX,listener.x);assignParam(l.positionY,EAR);assignParam(l.positionZ,listener.y);
    assignParam(l.forwardX,fx);assignParam(l.forwardY,fy);assignParam(l.forwardZ,fz);assignParam(l.upX,0);assignParam(l.upY,1);assignParam(l.upZ,0);}
  else{l.setPosition(listener.x,EAR,listener.y);l.setOrientation(fx,fy,fz,0,1,0);}
  const maxD=Math.max(0.1,...live.filter(item=>item.s).map(item=>dist(item.s,listener))),mode=currentRenderMode(),norm=rigNormalization(mode);live.norm=norm;
  const airOn=$('air').checked,t=AC.currentTime,al=$('align').checked;
  // volume and coherent headroom move together on one parameter, so dragging volume cannot overshoot
  if(master&&playing.length)scheduleParam(master.gain,(+$('mvol').value||0)*norm,t,0.03);
  live.forEach(o=>{
    if(!o.s)return;
    const d=dist(o.s,listener);
    o.chains.forEach(ch=>{
      scheduleParam(ch.dl.delayTime,al?Math.min(0.09,(maxD-d)/343):Math.min(0.05,d/343),t,0.03);
      configureAirFilter(ch.lp,o.s,d,airOn);
      scheduleParam(ch.g.gain,o.s.v*(o.s.mute?0:1),t,0.03);
      scheduleParam(ch.dg.gain,proxGain(d)*(o.s.sub?1.5:1),t,0.03);
      if(ch.occ)configureObstructionFilter(ch.occ,blocked(ch.s||o.s,ch.off||0));
      if(ch.mode==='p'){const hl=headLocal(o.s,ch.off||0);setPreciseDir(ch,hl.az,hl.el,hl.d);}
      else if(ch.mode==='c')scheduleParam(ch.p.pan,clarityPan(o.s,ch.targetEar),t,0.03);
      else if(ch.p)placePanner(ch.p,o.s.x+ch.off,(o.s.h??EAR),o.s.y);
    });
    updTaps(o);
    o.setCh();o.setBand();o.setW();
  });
}
