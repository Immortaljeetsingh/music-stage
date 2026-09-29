function impulse(dur,decay){
  const r=Math.ceil(AC.sampleRate*dur),b=AC.createBuffer(1,r,AC.sampleRate),d=b.getChannelData(0);
  let seed=17;
  for(let i=0;i<r;i++){seed=(1664525*seed+1013904223)>>>0;d[i]=(seed/2147483648-1)*Math.pow(1-i/r,decay);}
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
    E.d.delayTime.setTargetAtTime(itd,t,0.02);
    E.e.gain.setTargetAtTime(Math.pow(10,-ild/20),t,0.02);
    E.f.frequency.setTargetAtTime(onSide?19000:Math.max(2500,19000-16000*Math.sin(a)),t,0.02);
  }
  const se=Math.max(-1,Math.min(1,Math.sin(el)));
  if(se>=0){ch.eq1.frequency.value=8000;ch.eq1.gain.setTargetAtTime(2+6*se,t,0.03);}
  else{ch.eq1.frequency.value=6000;ch.eq1.gain.setTargetAtTime(5*se,t,0.03);}
  const behind=Math.cos(az)<0?-Math.cos(az):0;
  ch.eq2.gain.setTargetAtTime(5*behind,t,0.03);
}
// image-source early reflections: 6 first-order wall bounces land in the 20-80ms zone that
// research says externalizes sound. Fed PRE distance-gain (constant room level) so DRR varies
// with distance like a real room — our old post-gain send kept DRR flat (distance felt dead).
function earlyTaps(s,feed,useHQ){
  const W=room.w,L=room.l,H=room.h,sh=(s.h??EAR),refl=1-(+$('wallAbs').value||0.5);
  const imgs=[{x:-s.x,y:s.y,h:sh},{x:2*W-s.x,y:s.y,h:sh},{x:s.x,y:-s.y,h:sh},{x:s.x,y:2*L-s.y,h:sh},{x:s.x,y:s.y,h:-sh},{x:s.x,y:s.y,h:2*H-sh}];
  return imgs.map(im=>{
    const path=Math.hypot(im.x-listener.x,im.y-listener.y,im.h-EAR);
    const dl=AC.createDelay(0.12);dl.delayTime.value=Math.min(0.1,path/343);
    const g=AC.createGain();g.gain.value=refl/(1+0.6*path);
    const p=AC.createPanner();p.panningModel=useHQ?'equalpower':'HRTF';p.distanceModel='inverse';p.rolloffFactor=0;
    p.positionX.value=im.x;p.positionY.value=im.h;p.positionZ.value=im.y;
    feed.connect(dl);dl.connect(g);g.connect(p);p.connect(master);
    return {dl,g,p};
  });
}
function updTaps(o){
  if(!o.taps)return;const s=o.s,W=room.w,L=room.l,H=room.h,sh=(s.h??EAR);
  const refl=1-(+$('wallAbs').value||0.5),t=AC.currentTime;
  const imgs=[{x:-s.x,y:s.y,h:sh},{x:2*W-s.x,y:s.y,h:sh},{x:s.x,y:-s.y,h:sh},{x:s.x,y:2*L-s.y,h:sh},{x:s.x,y:s.y,h:-sh},{x:s.x,y:s.y,h:2*H-sh}];
  o.taps.forEach((tp,i)=>{const im=imgs[i];
    const path=Math.hypot(im.x-listener.x,im.y-listener.y,im.h-EAR);
    tp.dl.delayTime.setTargetAtTime(Math.min(0.1,path/343),t,0.03);
    tp.g.gain.setTargetAtTime(refl/(1+0.6*path),t,0.03); // room scales with rig: DRR stays sane
    tp.p.positionX.value=im.x;tp.p.positionY.value=im.h;tp.p.positionZ.value=im.y;});
}
// reality curve: loud up close, clearly gone far. d in meters -> gain (~11dB near-to-far).
function proxGain(d){return Math.min(3.5,1.4/(1+0.45*Math.max(0,d-0.4)));}
function stopPb(){const pos=curPosSafe();playing.forEach(s=>{try{s.stop();s.disconnect();}catch(e){}});playing=[];live=[];anL=anR=null;
  if(master)master.disconnect();playOffset=pos;$('play').textContent='Play';}
function curPosSafe(){try{return curPos();}catch(e){return playOffset;}}
function startPb(offset){
  master=AC.createGain();master.gain.value=+$('mvol').value;
  comp=AC.createDynamicsCompressor(); // safety limiter ONLY: old -12dB/4:1 glue with 20dB knee started riding at -32dB — pumped and smeared every note
  comp.threshold.value=0;comp.knee.value=6;comp.ratio.value=12;comp.attack.value=0.001;comp.release.value=0.1;
  balN=AC.createStereoPanner();balN.pan.value=+$('bal').value;
  // per-ear trim: split → trimL/trimR → merge (correct channel handling, works in every mode)
  const tsp=AC.createChannelSplitter(2),tmg=AC.createChannelMerger(2);
  trimL=AC.createGain();trimR=AC.createGain();trimL.gain.value=TRIM.l;trimR.gain.value=TRIM.r;
  master.connect(comp);comp.connect(balN);balN.connect(tsp);
  tsp.connect(trimL,0);tsp.connect(trimR,1);trimL.connect(tmg,0,0);trimR.connect(tmg,0,1);
  // headphone correction chain (after trim, before out): preamp + profile biquads
  let output=tmg;hpNodes=[];
  const prof=HP_PROFILES[$('hpdev').value]; // pro3 has no verified profile: falls through to bypass
  if(prof){const pre=AC.createGain();pre.gain.value=Math.pow(10,prof.pre/20);output.connect(pre);output=pre;hpNodes.push(pre);
    prof.f.forEach(([fc,ty,g2,q])=>{const bq=AC.createBiquadFilter();bq.type=ty;bq.frequency.value=Math.min(fc,AC.sampleRate*0.49);bq.Q.value=q;bq.gain.value=g2;output.connect(bq);output=bq;hpNodes.push(bq);});}
  const ceiling=AC.createWaveShaper(),curve=new Float32Array(4097);
  for(let i=0;i<curve.length;i++){const v=i*2/(curve.length-1)-1;curve[i]=Math.max(-0.95,Math.min(0.95,v));}
  ceiling.curve=curve;ceiling.oversample='4x'; // 1x waveshaper aliases on every clip — 4x removes the imaging artifacts
  output.connect(ceiling);output=ceiling;output.connect(AC.destination);
  try{ // live output meters: visible proof of what each ear is actually fed
    const msp=AC.createChannelSplitter(2);
    anL=AC.createAnalyser();anR=AC.createAnalyser();anL.fftSize=512;anR.fftSize=512;
    output.connect(msp);msp.connect(anL,0);msp.connect(anR,1);
  }catch(e){anL=anR=null;}
  verb=AC.createConvolver();const F=furnish(); // generic material-class approximation, not measured for user's furniture
  verb.buffer=impulse(0.35+Math.max(room.w,room.l)*0.06,3.2/F.rt); // short late tail; early pattern carries the room
  const wetLp=AC.createBiquadFilter();wetLp.type='lowpass';wetLp.frequency.value=F.lp; // late tail carries DRR, not detail
  wet=AC.createGain();wet.gain.value=+$('roomAmt').value;
  verb.connect(wetLp);wetLp.connect(wet);wet.connect(master);
  live=[];
  // normalize: N chains of full-scale mix summed = clipping. 1/sqrt(N) keeps level constant.
  const norm=1/Math.sqrt(sps.reduce((n,s)=>n+(s.sub?1:((s.ch||'M')==='M'?2:1)),0)||1);
  live.norm=norm;
  const maxD0=Math.max(0.1,...sps.map(s=>dist(s,listener))); // alignment reference: farthest box
  const useHQ=true; // taps render equalpower always — direction-only, like the direct path
  const usePrecise=$('hq').checked; // classic panner engine by default; precise only when ticked
  sps.forEach(s=>{
    const b=(s.stem&&stemBufs[s.stem])||buf;if(!b)return; // box has no audio (mix gone after reload?) — skip, don't crash
    const src=AC.createBufferSource();src.buffer=b;src.loop=true;
    // band filter BEFORE split (biquad keeps L/R separate) + mono-feed was killing the record's own L/R movement,
    // so M behaves like a real stereo box: L and R through two panners ±0.35m around the cabinet.
    const bf=AC.createBiquadFilter();const setBand=()=>{const b=s.sub?'Sub':(s.band||'Full');
      bf.Q.value=0.707;
      if(b==='Sub'){bf.type='lowpass';bf.frequency.value=120;}
      else if(b==='Tweeter'){bf.type='highpass';bf.frequency.value=2500;}
      else if(b==='Bass'){bf.type='lowpass';bf.frequency.value=300;}
      else if(b==='Vocal'){bf.type='bandpass';bf.frequency.value=1200;bf.Q.value=0.8;}
      else if(b==='Bright'){bf.type='highpass';bf.frequency.value=5000;}
      else{bf.type='allpass';bf.frequency.value=800;}};
    setBand();
    const sp=AC.createChannelSplitter(2),gL=AC.createGain(),gR=AC.createGain();
    const xLR=AC.createGain(),xRL=AC.createGain(),oL=AC.createGain(),oR=AC.createGain();
    src.connect(bf);bf.connect(sp);sp.connect(gL,0);sp.connect(gR,b.numberOfChannels<2?0:1);
    gL.connect(oL);gR.connect(oR);gL.connect(xRL);xRL.connect(oR);gR.connect(xLR);xLR.connect(oL);
    // M/S-style width (Blumlein matrix idea): k=1-w crossfeed. w=1 record, 0 mono, 2 hyper-wide.
    const setW=()=>{const k=1-Number($('width').value),scale=chMode()==='M'?1/(1+Math.abs(k)):1;oL.gain.value=scale;oR.gain.value=scale;xLR.gain.value=k*scale;xRL.gain.value=k*scale;}; // bounded stereo crossfeed keeps width comparisons near a stable level
    const flip=m=>m==='L'?'R':m==='R'?'L':m;
    const chMode=()=>{const m0=s.sub?'SUB':(s.ch||'M');return (SWAP&&!s.sub)?flip(m0):m0;};
    const setCh=()=>{const m=chMode();
      gL.gain.value=m==='L'?1:m==='R'?0:1; gR.gain.value=m==='R'?1:m==='L'?0:1;
      if(s.sub){gL.gain.value=0.7;gR.gain.value=0.7;}};
    setCh();setW();
    const mkChain=(inputs,off)=>{
      const g=AC.createGain();g.gain.value=s.v*norm*(s.mute?0:1);
      inputs.forEach(n=>n.connect(g));
      const occ=AC.createBiquadFilter();occ.type='lowpass';occ.Q.value=0.707;occ.frequency.value=blocked(s,off)?1800:20000;
      const lp=AC.createBiquadFilter();lp.type='lowpass';lp.Q.value=0.707; // Q=1 stacked ~+2dB hump at 10-14kHz then cliff: audible treble coloration
      const d0=dist(s,listener);
      const airOn=$('air').checked;
      lp.frequency.value=s.sub?120:(airOn?Math.max(12000,20000/(1+d0*0.08)):20000); // off = clearest
      const dg=AC.createGain();dg.gain.value=proxGain(d0)*(s.sub?1.5:1); // manual proximity: panner stays direction-only
      // PA-style arrival alignment: all directs land together (coherent sum, no comb teeth).
      // Reflections keep physical timing — only the direct path aligns.
      const dl=AC.createDelay(0.12);
      dl.delayTime.value=$('align').checked?Math.min(0.09,(maxD0-d0)/343):Math.min(0.05,d0/343);
      g.connect(lp);lp.connect(occ);occ.connect(dg);dg.connect(dl);
      const roomTap=AC.createGain();roomTap.gain.value=1;lp.connect(roomTap);
      if(usePrecise){
        const eq1=AC.createBiquadFilter();eq1.type='peaking';eq1.Q.value=1.2;
        const eq2=AC.createBiquadFilter();eq2.type='peaking';eq2.frequency.value=1200;eq2.Q.value=1;
        // ear outputs via hard-left/right panners: every browser has PannerNode, identical image, zero compat risk.
        const hardPan=v=>{const p=AC.createStereoPanner();p.pan.value=v;return p;};
        const mkEar=chn=>{const d=AC.createDelay(0.01),e=AC.createGain(),f=AC.createBiquadFilter();
          f.type='lowpass';f.frequency.value=19000;d.connect(e);e.connect(f);
          const p=hardPan(chn?1:-1);f.connect(p);p.connect(master);
          return{d,e,f};};
        const eL=mkEar(0),eR=mkEar(1);
        dl.connect(eq1);eq1.connect(eq2);eq2.connect(eL.d);eq2.connect(eR.d);
        return {mode:'p',g,lp,dg,dl,eq1,eq2,eL,eR,off,roomTap,occ};
      }
      let p=null;
      p=AC.createPanner();p.panningModel='equalpower';p.distanceModel='inverse';p.rolloffFactor=0; // classic engine: direction only, dg does loudness
      p.positionX.value=s.x+off;p.positionY.value=(s.h??EAR);p.positionZ.value=s.y;
      dl.connect(p);p.connect(master);
      return {mode:'h',g,lp,dg,dl,p,off,roomTap,occ,s};
    };
    const m=chMode();
    const chains=m==='M'?[mkChain([oL],-0.35),mkChain([oR],0.35)]:m==='L'?[mkChain([oL],0)]:m==='R'?[mkChain([oR],0)]:[mkChain([oL,oR],0)];
    const feed=AC.createGain();chains.forEach(ch=>ch.roomTap.connect(feed));
    const taps=$('walls').checked?earlyTaps(s,feed,useHQ):null;
    if(!s.sub){const rv=AC.createGain();rv.gain.value=0.5*(1.28-F.abs);feed.connect(rv);rv.connect(verb);}
    playing.push(src);live.push({s,gL,gR,bf,chains,taps,setCh,setBand,setW});
  });
  playOffset=offset;playStart=AC.currentTime+0.05;
  playing.forEach(src=>src.start(playStart,offset%src.buffer.duration));
  updateLis();
  $('play').textContent='Stop';
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
  if(l.positionX){l.positionX.value=listener.x;l.positionY.value=EAR;l.positionZ.value=listener.y;
    l.forwardX.value=fx;l.forwardY.value=fy;l.forwardZ.value=fz;l.upX.value=0;l.upY.value=1;l.upZ.value=0;}
  else{l.setPosition(listener.x,EAR,listener.y);l.setOrientation(fx,fy,fz,0,1,0);}
  const maxD=Math.max(0.1,...live.filter(item=>item.s).map(item=>dist(item.s,listener)));
  const airOn=$('air').checked,t=AC.currentTime,al=$('align').checked;
  live.forEach(o=>{
    if(!o.s)return;
    const d=dist(o.s,listener);
    o.chains.forEach(ch=>{
      ch.dl.delayTime.setTargetAtTime(al?Math.min(0.09,(maxD-d)/343):Math.min(0.05,d/343),t,0.03);
      ch.lp.frequency.value=o.s.sub?120:(airOn?Math.max(12000,20000/(1+d*0.08)):20000);
      ch.g.gain.setTargetAtTime(o.s.v*(live.norm||1)*(o.s.mute?0:1),t,0.03); // smoothed: no zipper crackle while dragging
      ch.dg.gain.setTargetAtTime(proxGain(d)*(o.s.sub?1.5:1),t,0.03);
      if(ch.occ)ch.occ.frequency.setTargetAtTime(blocked(ch.s||o.s,ch.off||0)?1800:20000,t,0.03);
      if(ch.mode==='p'){const hl=headLocal(o.s,ch.off||0);setPreciseDir(ch,hl.az,hl.el,hl.d);}
      else if(ch.p){ch.p.positionX.value=o.s.x+ch.off;ch.p.positionY.value=(o.s.h??EAR);ch.p.positionZ.value=o.s.y;}
    });
    updTaps(o);
    o.setCh();o.setBand();o.setW();
  });
}
