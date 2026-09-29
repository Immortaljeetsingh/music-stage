const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {launchBrowser}=require('./test-helpers.cjs');

(async()=>{
  const browser=await launchBrowser();
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
    const result=await page.evaluate(async()=>{
      const sampleRate=48000,length=sampleRate*2,start=sampleRate;
      async function render({left=true,right=false,amp=.2,frequency=1000,masterVolume=.9,speakerVolume=1,near=false}={}){
        if(playing.length)stopPb();AC=new OfflineAudioContext(2,length,sampleRate);buf=AC.createBuffer(2,length,sampleRate);
        for(let i=0;i<length;i++){const value=amp*Math.sin(2*Math.PI*frequency*i/sampleRate);buf.getChannelData(0)[i]=left?value:0;buf.getChannelData(1)[i]=right?value:0;}
        room={w:10,l:10,h:3};listener.x=5;listener.y=5;listener.yaw=0;listener.pitch=0;const y=near?4.9:2;sps=[{x:near?4.9:2,y,h:1.6,v:speakerVolume,ch:'L',band:'Full'},{x:near?5.1:8,y,h:1.6,v:speakerVolume,ch:'R',band:'Full'}];furniture.length=0;TRIM={l:1,r:1};SWAP=false;
        $('renderMode').value='clarity';$('hpdev').value='';$('hq').checked=false;$('width').value=1;$('walls').checked=false;$('wallAbs').value=.85;$('roomAmt').value=0;$('mvol').value=masterVolume;$('air').checked=false;$('align').checked=true;$('bal').value=0;
        startPb(0);return AC.startRendering();
      }
      const rms=(data,a=start,b=data.length)=>{let sum=0;for(let i=a;i<b;i++)sum+=data[i]*data[i];return Math.sqrt(sum/(b-a));};
      const peakOf=(...channels)=>{let peak=0;for(const data of channels)for(const value of data)peak=Math.max(peak,Math.abs(value));return peak;};
      const amplitude=(data,frequency)=>{const w=2*Math.PI*frequency/sampleRate;let re=0,im=0;for(let i=start;i<length;i++){re+=data[i]*Math.cos(w*i);im-=data[i]*Math.sin(w*i);}return 2*Math.hypot(re,im)/(length-start);};
      const normal=await render({left:true,right:false}),normalLeft=normal.getChannelData(0),normalRight=normal.getChannelData(1),fundamental=amplitude(normalLeft,1000);let harmonicPower=0;for(let harmonic=2;harmonic<=10;harmonic++)harmonicPower+=amplitude(normalLeft,1000*harmonic)**2;
      const thdDb=20*Math.log10(Math.sqrt(harmonicPower)/fundamental),crosstalkDb=20*Math.log10(Math.max(1e-15,rms(normalRight))/rms(normalLeft));
      const hot=await render({left:true,right:true,amp:1,masterVolume:2.5,speakerVolume:4,near:true}),ceiling=Math.pow(10,-1/20);let peak=0,plateau=0,total=0;for(let channel=0;channel<2;channel++)for(const value of hot.getChannelData(channel)){peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=ceiling-.0001)plateau++;total++;}
      const stereo=await render({left:true,right:true,amp:.7,frequency:997}),stereoPeak=peakOf(stereo.getChannelData(0),stereo.getChannelData(1));
      // Web Audio low/high-pass Q is in dB: the engine's crossover/air/obstruction filters must be maximally flat (no resonant bump).
      const filterPeak=configure=>{const context=new OfflineAudioContext(1,128,sampleRate),node=context.createBiquadFilter();configure(node);const n=1024,frequencies=new Float32Array(n),magnitude=new Float32Array(n),phase=new Float32Array(n);for(let i=0;i<n;i++)frequencies[i]=10*Math.pow(2000,i/(n-1));node.getFrequencyResponse(frequencies,magnitude,phase);return Math.max(...magnitude);};
      const filterPeaks={obstruction:filterPeak(node=>setLowPassFilter(node,1800)),sub:filterPeak(node=>setLowPassFilter(node,120)),air:filterPeak(node=>setLowPassFilter(node,12000)),tweeter:filterPeak(node=>setHighPassFilter(node,2500))};
      return {thdDb,crosstalkDb,hotPeak:peak,hotPlateauRatio:plateau/total,normalPeak:peakOf(normalLeft),stereoPeak,filterPeaks};
    });
    console.log(result);assert(result.thdDb<-100,`normal-path THD is ${result.thdDb.toFixed(1)} dB`);assert(result.crosstalkDb<-100,`clarity crosstalk is ${result.crosstalkDb.toFixed(1)} dB`);assert(result.normalPeak<.89,'normal signal retains headroom');assert(result.stereoPeak<.89,'hot mastered source remains below ceiling at defaults');assert(result.hotPeak<=Math.pow(10,-1/20)+1e-4,'extreme gain exceeds -1 dBFS ceiling');assert(result.hotPlateauRatio<.01,`emergency clamp plateau ratio ${(result.hotPlateauRatio*100).toFixed(2)}%`);for(const [name,filterPeak] of Object.entries(result.filterPeaks))assert(filterPeak<=1.001,`${name} filter resonates: peak gain ${(20*Math.log10(filterPeak)).toFixed(2)} dB`);assert.deepEqual(errors,[]);console.log('PASS: clarity path is transparent, channel-isolated, resonance-free in its filters, and protected by coherent headroom plus a -1 dBFS ceiling.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
