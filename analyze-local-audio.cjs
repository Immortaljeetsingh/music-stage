const fs=require('node:fs');
const path=require('node:path');
const {createServer}=require('./server.cjs');
const {closeServer,launchBrowser,listen}=require('./test-helpers.cjs');

(async()=>{
  const files=fs.readdirSync(__dirname).filter(name=>name.toLowerCase().endsWith('.mp3')).map(name=>path.join(__dirname,name));
  if(!files.length){console.log('No local MP3 files found; nothing to analyze.');return;}
  const server=createServer(),base=await listen(server);let browser;
  try{
    browser=await launchBrowser();const reports=[];
    for(const file of files){
      const page=await browser.newPage();await page.goto(base+'/index.html');await page.locator('#f').setInputFiles(file);await page.waitForFunction(()=>$('playerState').dataset.state==='ready',null,{timeout:120000});
      const report=await page.evaluate(async()=>{
        const original=buf,sampleRate=original.sampleRate,seconds=Math.min(5,original.duration),block=Math.max(1,Math.floor(seconds*sampleRate)),stride=Math.max(block,Math.floor(sampleRate*2));let bestStart=0,bestEnergy=-1;
        for(let start=0;start+block<=original.length;start+=stride){let sum=0,count=0;for(let i=start;i<start+block;i+=16){for(let channel=0;channel<original.numberOfChannels;channel++){const value=original.getChannelData(channel)[i];sum+=value*value;count++;}}if(sum/count>bestEnergy){bestEnergy=sum/count;bestStart=start;}}
        const sourceMetrics=(()=>{const left=original.getChannelData(0),right=original.numberOfChannels>1?original.getChannelData(1):left;let peak=0,sum=0,cross=0,l2=0,r2=0,count=0;for(let i=bestStart;i<Math.min(original.length,bestStart+block);i+=8){const l=left[i],r=right[i];peak=Math.max(peak,Math.abs(l),Math.abs(r));sum+=l*l+r*r;cross+=l*r;l2+=l*l;r2+=r*r;count++;}return {peak,rms:Math.sqrt(sum/(count*2)),correlation:cross/Math.sqrt(l2*r2)};})();
        async function render({mode,walls,verb,precise}){if(playing.length)stopPb();AC=new OfflineAudioContext(2,block,sampleRate);const snippet=AC.createBuffer(2,block,sampleRate);for(let channel=0;channel<2;channel++){const source=original.getChannelData(Math.min(channel,original.numberOfChannels-1));snippet.getChannelData(channel).set(source.subarray(bestStart,bestStart+block));}buf=snippet;room={w:10,l:10,h:10};listener.x=5;listener.y=5;listener.yaw=0;listener.pitch=0;sps=[{x:2,y:2,h:1.6,v:1,ch:'L',band:'Full'},{x:8,y:2,h:1.6,v:1,ch:'R',band:'Full'}];furniture.length=0;TRIM={l:1,r:1};SWAP=false;$('renderMode').value=mode;$('hpdev').value='';$('hq').checked=precise;$('width').value=1;$('walls').checked=walls;$('wallAbs').value=.5;$('roomAmt').value=verb;$('mvol').value=.9;$('air').checked=false;$('align').checked=true;$('bal').value=0;let seed=17;const random=Math.random;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);try{startPb(0);}finally{Math.random=random;}const rendered=await AC.startRendering();let peak=0,sum=0,cross=0,l2=0,r2=0,plateau=0,count=0;const left=rendered.getChannelData(0),right=rendered.getChannelData(1);for(let i=Math.floor(.1*sampleRate);i<rendered.length;i++){const l=left[i],r=right[i];peak=Math.max(peak,Math.abs(l),Math.abs(r));if(Math.abs(l)>=.949||Math.abs(r)>=.949)plateau++;sum+=l*l+r*r;cross+=l*r;l2+=l*l;r2+=r*r;count++;}return {peak,rms:Math.sqrt(sum/(count*2)),correlation:cross/Math.sqrt(l2*r2),plateau};}
        const clarity=await render({mode:'clarity',walls:false,verb:0,precise:false}),roomMode=await render({mode:'room',walls:true,verb:.02,precise:false});return {duration:original.duration,sampleRate,channels:original.numberOfChannels,source:sourceMetrics,clarity,room:roomMode,clarityCorrelationDrift:clarity.correlation-sourceMetrics.correlation};
      });
      reports.push({file:path.basename(file),...report});console.log(JSON.stringify(reports.at(-1)));await page.close();
    }
    const maxCorrelationDrift=Math.max(...reports.map(report=>Math.abs(report.clarityCorrelationDrift))),maxClarityPeak=Math.max(...reports.map(report=>report.clarity.peak)),totalPlateaus=reports.reduce((sum,report)=>sum+report.clarity.plateau,0);console.log('SUMMARY',JSON.stringify({tracks:reports.length,maxCorrelationDrift,maxClarityPeak,totalPlateaus,reports}));
  }finally{if(browser)await browser.close();await closeServer(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
