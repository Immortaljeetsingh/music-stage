/* Android app integration: the System-wide sound card and live stage sync to the native engine.
   Does nothing in a browser, where window.MusicStageAndroid is absent. */
(()=>{
  const native=window.MusicStageAndroid;if(!native)return;
  const root=document.documentElement;root.dataset.platform='android';
  const card=document.createElement('section');card.className='sec system-card';card.id='systemSection';card.setAttribute('aria-labelledby','h-system');
  card.innerHTML=`<div class="player-heading"><div><h2 id="h-system">System-wide sound</h2><span id="systemState" class="state-pill" data-state="empty">Off</span></div></div>
<p id="systemSummary" class="hint">Play music in any app and hear it through this stage.</p>
<div class="ctl"><button id="systemToggle" class="tint" type="button" aria-pressed="false">Start</button></div>
<div id="systemSetup" class="system-setup" hidden>
  <p class="hint"><strong>One-time setup.</strong> Android lets only the shell user grant access to other apps' audio sessions.</p>
  <ol class="hint system-steps"><li>Install <a href="https://shizuku.rikka.app/" data-external>Shizuku</a> and start it with Wireless debugging.</li><li>Tap Grant with Shizuku and allow access.</li><li>Or run the ADB command once from a computer with USB debugging on.</li></ol>
  <div class="ctl"><button id="systemShizuku" type="button">Grant with Shizuku</button><button id="systemCopy" type="button">Copy ADB command</button></div>
  <p id="systemSetupNote" class="hint" role="status" aria-live="polite"></p>
</div>
<p id="systemApps" class="hint" role="status" aria-live="polite"></p>
<details class="hint"><summary>How it works and limits</summary><p>Music Stage captures media and game audio from apps that allow capture, silences their direct output, and plays the result through this stage. Apps that block capture, such as Spotify, Chrome and some video apps, keep playing normally without processing. Processing adds roughly a tenth of a second of delay, and other equalizer apps can conflict with it. Requires Android 10 or newer.</p></details>`;
  const column=document.querySelector('.col-stage');if(column)column.insertBefore(card,column.firstChild);
  const byId=id=>document.getElementById(id);
  const put=(id,text)=>{const el=byId(id);if(el&&el.textContent!==text)el.textContent=text;};
  const list=items=>items.slice(0,4).join(', ')+(items.length>4?` and ${items.length-4} more`:'');
  let status={};
  function render(next){
    status=next&&typeof next==='object'?next:{};
    const state=status.state||'off',running=!!status.running,ready=!!status.dumpGranted;
    const pill=byId('systemState'),pillState=state==='running'?'playing':state==='starting'?'loading':state==='error'?'error':'empty';
    put('systemState',{running:'On',starting:'Starting',error:'Stopped'}[state]||(ready?'Ready':'Setup needed'));
    if(pill.dataset.state!==pillState)pill.dataset.state=pillState;
    const toggle=byId('systemToggle');put('systemToggle',running?'Stop':'Start');
    toggle.disabled=!running&&(!ready||status.supported===false);toggle.setAttribute('aria-pressed',String(running));
    const setup=byId('systemSetup');if(setup.hidden!==ready)setup.hidden=ready;
    put('systemShizuku',status.shizukuGranted?'Grant access now':'Grant with Shizuku');
    put('systemSetupNote',status.setupMessage||(status.shizukuRunning?'Shizuku is running.':''));
    let summary;
    if(status.supported===false)summary='System-wide sound needs Android 10 or newer.';
    else if(state==='error')summary=status.message||'System-wide sound stopped.';
    else if(running)summary=status.processed&&status.processed.length?`Processing ${list(status.processed)}.`:(status.message||'Listening for apps that allow capture. Start playing music in any app.');
    else summary=ready?'Every app that allows capture will play through this stage.':'Finish the one-time setup below.';
    put('systemSummary',summary);
    const notes=[];
    if(status.blocked&&status.blocked.length)notes.push(`Playing without processing (capture blocked): ${list(status.blocked)}.`);
    if(status.unmuted&&status.unmuted.length)notes.push(`Kept direct output on for ${list(status.unmuted)} because capture was silent or another effect app may be active.`);
    if(running&&status.latencyMs)notes.push(`Added delay about ${status.latencyMs} ms.`);
    put('systemApps',notes.join(' '));
  }
  window.MusicStageNative={onStatus:render};
  byId('systemToggle').onclick=()=>{if(status.running)native.stop();else native.start();};
  byId('systemShizuku').onclick=()=>native.setupWithShizuku();
  byId('systemCopy').onclick=()=>{native.copyText(status.adbCommand||'');put('systemSetupNote','ADB command copied. Run it once from a computer with USB debugging on.');};
  card.addEventListener('click',event=>{const link=event.target.closest('a[data-external]');if(link){event.preventDefault();native.openLink(link.href);}});
  try{render(JSON.parse(native.getStatus()));}catch(_){render({});}

  // Live stage sync: the native engine renders the same project the editor shows.
  let lastSent='',timer=0;
  function push(){timer=0;let project;try{project=captureProject();}catch(_){return;}delete project.savedAt;delete project.track;const json=JSON.stringify(project);if(json!==lastSent){lastSent=json;native.setConfig(json);}}
  function schedule(){if(!timer)timer=setTimeout(push,80);}
  for(const type of ['input','change','pointerup','click','keyup'])document.addEventListener(type,schedule,true);
  const canvas=byId('c');if(canvas)canvas.addEventListener('pointermove',()=>{if(drag)schedule();});
  if(typeof updateLis==='function'){const base=updateLis;updateLis=function(...args){const result=base.apply(this,args);schedule();return result;};}
  if(typeof applyProject==='function'){const base=applyProject;applyProject=function(...args){const result=base.apply(this,args);schedule();return result;};}
  const sendAppearance=()=>native.setAppearance(root.dataset.appearance==='light'?'light':'dark');
  new MutationObserver(sendAppearance).observe(root,{attributes:true,attributeFilter:['data-appearance']});
  sendAppearance();schedule();
})();
