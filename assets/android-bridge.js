/* Android app integration: native system-wide sound, a player-first shell, Settings, and live stage sync.
   Does nothing in a browser, where window.MusicStageAndroid is absent. */
(()=>{
  const native=window.MusicStageAndroid;if(!native)return;
  const root=document.documentElement;root.dataset.platform='android';
  const byId=id=>document.getElementById(id);
  const put=(id,text)=>{const el=byId(id);if(el&&el.textContent!==text)el.textContent=text;};

  function relabelTab(id,label,icon){
    const tab=byId(id);if(!tab)return;
    const text=[...tab.childNodes].find(node=>node.nodeType===3&&node.textContent.trim());
    if(text)text.textContent=label;
    tab.setAttribute('aria-label',label);
    const svg=tab.querySelector('svg');if(svg&&icon)svg.innerHTML=icon;
  }
  function installAndroidLayout(){
    const playerPanel=byId('panel-stage'),settings=byId('panel-sound'),player=byId('playerSection');
    if(!playerPanel||!settings||!player)return;
    player.classList.add('android-player-hero');
    settings.classList.add('android-settings-panel');
    relabelTab('tab-source','Music');
    relabelTab('tab-sound','Settings','<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20h-3v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 14.7a1.7 1.7 0 0 0-1.56-1.04H5v-3h.44A1.7 1.7 0 0 0 7 9.62a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06A1.7 1.7 0 0 0 10.66 6a1.7 1.7 0 0 0 1.04-1.56V4h3v.44A1.7 1.7 0 0 0 15.74 6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04H21v3h-.04A1.7 1.7 0 0 0 19.4 15Z"/>');
    relabelTab('tab-stage','Player','<circle cx="12" cy="12" r="8.5"/><path d="m10 8.5 5.5 3.5-5.5 3.5Z"/>');
    put('miniStage','Player');
    const skip=document.querySelector('.skip-link');if(skip)skip.textContent='Skip to player';
    const tourSteps=byId('welcomeDialog')?.querySelectorAll('ol li');
    if(tourSteps?.length>=3){
      tourSteps[0].innerHTML='<strong>Choose music.</strong> Upload a local track or load a credited demo in Music.';
      tourSteps[2].innerHTML='<strong>Press Play.</strong> Use the full player on Player or the compact player from another tab.';
    }

    const intro=document.createElement('div');intro.className='android-settings-intro';intro.innerHTML='<span class="android-settings-kicker">Personalize Music Stage</span><h2>Settings</h2><p class="hint">Tune the interface, stage layout, head tracking, playback and headphones in one place.</p>';

    const experience=document.createElement('details');experience.className='group android-settings-group';experience.id='androidExperienceGroup';experience.open=true;
    experience.innerHTML='<summary>App experience <span class="meta">interface detail</span></summary><div class="gbody"><div class="android-setting-row"><div><strong>Customization level</strong><p class="hint">Simple keeps essentials visible. Advanced reveals every acoustic control.</p></div></div></div>';
    const mode=byId('modeToggle'),modeRow=experience.querySelector('.android-setting-row');if(mode&&modeRow)modeRow.append(mode);

    const stageGroup=document.createElement('details');stageGroup.className='group android-settings-group android-stage-settings';stageGroup.id='androidStageSettingsGroup';
    stageGroup.innerHTML='<summary>Stage layout <span class="meta">room &amp; speakers</span></summary><div class="gbody"></div>';
    const stage=playerPanel.querySelector('.stage'),selected=byId('sel'),stageBody=stageGroup.querySelector('.gbody');
    if(stage&&stageBody){stage.classList.add('android-settings-card');stageBody.append(stage);}
    if(selected&&stageBody){selected.classList.add('android-settings-card');stageBody.append(selected);}

    const moved=document.createDocumentFragment();moved.append(intro,experience);
    const appearance=byId('appGroup');if(appearance){const wrapper=appearance.parentElement;appearance.classList.add('android-settings-group');moved.append(appearance);if(wrapper&&!wrapper.children.length)wrapper.remove();}
    moved.append(stageGroup);
    const head=byId('headGroup');if(head){const wrapper=head.parentElement;head.classList.add('android-settings-group','advanced-only');moved.append(head);if(wrapper&&!wrapper.children.length)wrapper.remove();}
    settings.insertBefore(moved,settings.firstChild);
  }
  installAndroidLayout();

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
  const column=document.querySelector('.col-stage'),player=byId('playerSection');
  if(column){if(player)player.insertAdjacentElement('afterend',card);else column.prepend(card);}
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
