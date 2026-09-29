/* Robust source loading and the Web Audio-backed now-playing experience. */
let currentTrack={title:'Choose a track',artist:'Upload audio, load a demo, or browse free music',album:'',source:'Local-first',details:'Nothing leaves your device when you choose a local file.',artwork:'',state:'empty'};
let audioLoadController=null,audioLoadGeneration=0,pendingDemo=null,pendingStemController=null;
let repeatEnabled=true,lastAudibleVolume=0.9,playbackGeneration=0,transportFrame=0;

function setLoadState(state,message='',progress=null){
  const pill=$('playerState'),bar=$('loadProgress'),cancel=$('cancelLoad');
  pill.dataset.state=state;pill.textContent={empty:'No track',loading:'Loading',ready:'Ready',playing:'Playing',paused:'Paused',error:'Error'}[state]||state;
  if(message)say(message);
  if(progress==null){bar.hidden=true;bar.removeAttribute('value');}else{bar.hidden=false;bar.value=Math.max(0,Math.min(1,progress));}
  cancel.hidden=state!=='loading';currentTrack.state=state;updatePlayerSurface();
}
function updatePlayerSurface(){
  const art=currentTrack.artwork||MediaUtils.artworkData(currentTrack.title,currentTrack.artist),hasTrack=!['empty'].includes(currentTrack.state)&&currentTrack.title!=='Choose a track';
  $('trackTitle').textContent=currentTrack.title;$('trackArtist').textContent=currentTrack.artist||'Unknown artist';$('trackAlbum').textContent=currentTrack.album||'';$('trackSource').textContent=currentTrack.source||'Audio';$('trackDetails').textContent=currentTrack.details||'';
  $('miniTitle').textContent=currentTrack.title;$('miniArtist').textContent=currentTrack.artist||'Unknown artist';
  for(const el of [$('albumArt'),$('miniArt')])el.style.backgroundImage=`url("${art.replaceAll('"','%22')}")`;
  $('albumArt').setAttribute('aria-label',`Artwork for ${currentTrack.title}`);$('albumArt').querySelector('span').hidden=!!art;
  document.body.classList.toggle('has-track',hasTrack);$('miniPlayer').hidden=!hasTrack;$('nowPlaying').dataset.state=currentTrack.state;
}
function setTrackMetadata(meta){
  if(currentTrack.artwork?.startsWith('blob:')&&currentTrack.artwork!==meta.artwork)URL.revokeObjectURL(currentTrack.artwork);
  const fallback=MediaUtils.titleFromFilename(meta.title||'');
  currentTrack={...currentTrack,...meta,title:meta.title||fallback.title,artist:meta.artist||fallback.artist,state:'ready'};
  setLoadState('ready');
  if('mediaSession' in navigator){
    try{navigator.mediaSession.metadata=new MediaMetadata({title:currentTrack.title,artist:currentTrack.artist,album:currentTrack.album||'Music Stage',artwork:[{src:currentTrack.artwork||MediaUtils.artworkData(currentTrack.title,currentTrack.artist),sizes:'512x512'}]});}catch(_){}
  }
}
function beginAudioLoad(message){
  audioLoadController?.abort();pendingStemController?.abort();demoGen++;audioLoadController=new AbortController();const generation=++audioLoadGeneration;
  pendingDemo=null;demoStemsBusy=null;setLoadState('loading',message,0);return {controller:audioLoadController,generation};
}
function finishAudioLoad(generation){if(generation!==audioLoadGeneration)return false;audioLoadController=null;$('cancelLoad').hidden=true;$('loadProgress').hidden=true;return true;}
function loadProgress(loaded,total,label='Downloading'){const ratio=total?loaded/total:null;setLoadState('loading',`${label}… ${MediaUtils.formatBytes(loaded)}${total?' / '+MediaUtils.formatBytes(total):''}`,ratio);}
function ensureAudioContext(){const C=window.AudioContext||window.webkitAudioContext;if(!C)throw new Error('This browser does not provide Web Audio.');AC=AC||new C();return AC;}
async function decodeAudioBuffer(arrayBuffer){const context=ensureAudioContext();const decoded=await context.decodeAudioData(arrayBuffer);if(!decoded.duration||decoded.duration>MediaUtils.MAX_AUDIO_SECONDS)throw new Error(`Track duration must be between 1 second and ${MediaUtils.MAX_AUDIO_SECONDS/3600} hours.`);return decoded;}
function adoptMix(decoded,meta){
  stopPbSafe();clearStems();buf=decoded;srcMono=decoded.numberOfChannels<2;playOffset=0;$('seek').value=0;updTime();
  setTrackMetadata({...meta,details:meta.details||`${decoded.numberOfChannels} channel${decoded.numberOfChannels===1?'':'s'} · ${MediaUtils.formatRate(decoded.sampleRate)} · ${fmt(decoded.duration)}`});
  say(`${currentTrack.title} ready · ${srcMono?'mono → dual-mono':audit(decoded)} · press Play`);
}
$('cancelLoad').onclick=()=>{audioLoadGeneration++;audioLoadController?.abort();audioLoadController=null;setLoadState(buf||Object.keys(stemBufs).length?'ready':'empty','Loading cancelled.');};
$('f').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>MediaUtils.MAX_AUDIO_BYTES){setLoadState('error',`${file.name} is ${MediaUtils.formatBytes(file.size)}; the limit is ${MediaUtils.formatBytes(MediaUtils.MAX_AUDIO_BYTES)}.`);return;}
  if(file.type&&!file.type.startsWith('audio/')&&!/\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i.test(file.name)){setLoadState('error','Choose a supported audio file.');return;}
  const {generation}=beginAudioLoad(`Reading ${file.name}`);
  try{
    const arrayBuffer=await file.arrayBuffer();if(generation!==audioLoadGeneration)return;setLoadState('loading','Reading metadata and decoding…',null);
    const fallback=MediaUtils.titleFromFilename(file.name),tags=MediaUtils.parseId3(arrayBuffer),decoded=await decodeAudioBuffer(arrayBuffer);
    if(!finishAudioLoad(generation))return;adoptMix(decoded,{title:tags.title||fallback.title,artist:tags.artist||fallback.artist,album:tags.album||'',artwork:tags.artwork||MediaUtils.artworkData(tags.title||fallback.title,tags.artist||fallback.artist),source:'Local file',details:`${MediaUtils.formatBytes(file.size)} · ${decoded.numberOfChannels}ch · ${MediaUtils.formatRate(decoded.sampleRate)} · ${fmt(decoded.duration)}`});
  }catch(error){if(generation===audioLoadGeneration)setLoadState('error',`Could not load ${file.name}: ${error.message||error}`);}
};

loadRemote=async function(url,title,meta={}){
  let safeUrl;try{safeUrl=MediaUtils.httpUrl(url);}catch(error){setLoadState('error',error.message);return false;}
  const {controller,generation}=beginAudioLoad(`Connecting to ${new URL(safeUrl).hostname}`);
  try{
    await ensureAudioContext().resume();const {buffer,response}=await MediaUtils.fetchBuffer(safeUrl,{signal:controller.signal,onProgress:(n,t)=>loadProgress(n,t,'Downloading audio')});
    if(generation!==audioLoadGeneration)return false;setLoadState('loading',`Decoding ${MediaUtils.formatBytes(buffer.byteLength)}…`,null);const decoded=await decodeAudioBuffer(buffer);if(!finishAudioLoad(generation))return false;
    let decodedTitle=title;try{decodedTitle=decodeURIComponent(title);}catch(_){}
    adoptMix(decoded,{title:meta.title||decodedTitle||new URL(safeUrl).pathname.split('/').pop(),artist:meta.artist||'Online audio',album:meta.album||'',artwork:meta.artwork||'',source:meta.source||new URL(safeUrl).hostname,details:`${response.headers.get('content-type')||'audio'} · ${MediaUtils.formatBytes(buffer.byteLength)} · ${decoded.numberOfChannels}ch · ${fmt(decoded.duration)}`});return true;
  }catch(error){if(generation===audioLoadGeneration)setLoadState('error',`Audio load failed: ${error.message||error}. Check CORS or try a local file.`);return false;}
};
$('loadUrl').onclick=()=>{const value=$('url').value.trim();if(!value){setLoadState('error','Paste a direct HTTPS audio URL first.');return;}let name=value;try{name=decodeURIComponent(new URL(value).pathname.split('/').pop())||'Online audio';}catch(_){}loadRemote(value,name);};

function resetDemoStage(){
  room={w:10,l:10,h:10};listener.x=5;listener.y=5;listener.yaw=0;listener.pitch=0;furniture.length=0;showFurniture();
  sps=[{x:2,y:2,h:1.6,v:1.1,ch:'L',band:'Full'},{x:8,y:2,h:1.6,v:1.1,ch:'R',band:'Full'}];
  $('hq').checked=true;$('walls').checked=true;$('roomAmt').value=0.04;$('mvol').value=0.7;$('bal').value=0;TRIM={l:1,r:1};$('trimL').value=1;$('trimR').value=1;
  $('rw').value=10;$('rl').value=10;$('rh').value=10;$('yaw').value=0;$('look').value=0;$('uni').checked=true;listener.useSensor=false;$('width').value=1;$('align').checked=false;$('air').checked=false;$('wallAbs').value=0.65;$('furn').value='Empty';SWAP=false;$('swap').checked=false;selIdx=0;showSel();draw();syncMetas?.();
}
$('loadDemo').onclick=async()=>{
  const d=demos.find(item=>item.id===$('demo').value);if(!d){setLoadState('error','Choose a demo track first.');return;}
  const {controller,generation}=beginAudioLoad(`Downloading ${d.title}`),gen=++demoGen;$('loadDemo').disabled=true;
  try{
    await ensureAudioContext().resume();const base=`demos/${d.id}/`,{buffer}=await MediaUtils.fetchBuffer(base+'mix.flac',{signal:controller.signal,maxBytes:30*1024*1024,onProgress:(n,t)=>loadProgress(n,t,'Downloading demo mix')});
    if(generation!==audioLoadGeneration)return;setLoadState('loading','Decoding demo mix…',null);const mix=await decodeAudioBuffer(buffer);if(!finishAudioLoad(generation))return;
    stopPbSafe();clearStems();buf=mix;srcMono=mix.numberOfChannels<2;playOffset=0;resetDemoStage();pendingDemo={d,base,gen};$('mapStems').style.display='';$('mapStems').textContent='Map stems';
    const credit=$('demoCredit');credit.replaceChildren(document.createTextNode(`${d.title} by ${d.artist}${d.featuring?' featuring '+d.featuring:''} — credited excerpt. `));
    for(const [text,href] of [['Original & credits',d.source],['CC BY license',d.license],['Full attribution','https://github.com/Immortaljeetsingh/music-stage#bundled-demo-credits']]){const a=document.createElement('a');a.textContent=text;a.href=href;credit.append(a,document.createTextNode(' · '));}
    setTrackMetadata({title:d.title,artist:d.artist+(d.featuring?` feat. ${d.featuring}`:''),album:d.style||'Music Stage demos',source:'CC-BY demo',artwork:MediaUtils.artworkData(d.title,d.artist),details:`24-second demo · ${mix.numberOfChannels}ch · ${MediaUtils.formatRate(mix.sampleRate)}`});say(`${d.title} mix ready — press Play. Map stems downloads the optional separated parts.`);
  }catch(error){if(generation===audioLoadGeneration)setLoadState('error',`Demo load failed: ${error.message||error}`);}finally{$('loadDemo').disabled=false;}
};
async function ensureDemoStems(){
  if(stemNames.length===4)return true;if(!pendingDemo)return false;if(demoStemsBusy)return demoStemsBusy;
  pendingStemController?.abort();const controller=new AbortController();pendingStemController=controller;const {base,gen}=pendingDemo,keys=['vocals','drums','bass','other'],decoded={};let next=0,done=0;
  const operation=(async()=>{
    setLoadState('loading','Downloading optional stems…',0);
    const worker=async()=>{while(next<keys.length){const key=keys[next++],{buffer}=await MediaUtils.fetchBuffer(base+key+'.flac',{signal:controller.signal,maxBytes:30*1024*1024});decoded[key]=await AC.decodeAudioData(buffer);done++;if(gen===demoGen)setLoadState('loading',`Preparing stems ${done}/${keys.length}…`,done/keys.length);}};
    await Promise.all([worker(),worker()]);const len=decoded.vocals.length;if(Object.values(decoded).some(part=>part.length!==len||part.numberOfChannels!==2))throw new Error('Stem alignment mismatch.');if(gen!==demoGen)return false;
    stemBufs=decoded;stemNames=Object.keys(decoded);setLoadState(playing.length?'playing':'ready','Stems ready to place.');updateStorageUsage();return true;
  })().catch(error=>{if(gen===demoGen)setLoadState(playing.length?'playing':'error',`Stem download failed: ${error.message||error}. The original mix still plays.`);return false;}).finally(()=>{if(pendingStemController===controller)pendingStemController=null;if(demoStemsBusy===operation)demoStemsBusy=null;});
  demoStemsBusy=operation;return operation;
}
$('mapStems').onclick=async()=>{
  $('mapStems').disabled=true;try{if(pendingDemo&&!await ensureDemoStems())return;
    if(stemNames.length===4){sps=[{x:3,y:1,h:1.6,v:1.1,ch:'M',band:'Full',stem:'vocals'},{x:1,y:2,h:1.3,v:1.1,ch:'M',band:'Full',stem:'drums'},{x:5,y:6.5,h:2.5,v:1.4,ch:'M',band:'Full',stem:'other'},{x:3,y:6.5,h:0.3,v:1.4,sub:true,ch:'M',band:'Full',stem:'bass'}];selIdx=0;$('demoSolo').hidden=false;$('demoSolo').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(!button.dataset.solo)));say('Stem rig ready: vocals front, drums left, instruments rear-high, bass sub.');}
    else{say('No complete four-part stem set is available.');return;}if(playing.length)seekTo(curPos());showSel();draw();syncMetas?.();
  }finally{$('mapStems').disabled=false;}
};

async function fetchJson(url,signal){const {buffer}=await MediaUtils.fetchBuffer(url,{signal,maxBytes:8*1024*1024,timeoutMs:20_000});return JSON.parse(new TextDecoder().decode(buffer));}
let catalogController=null;
$('search').onclick=async()=>{
  $('res').replaceChildren();const query=$('q').value.trim();if(!query)return;catalogController?.abort();catalogController=new AbortController();const signal=catalogController.signal;
  try{say('Searching…');
    if($('prov').value==='audius'){
      let found=null,lastError='unavailable';for(const host of AUH){try{const json=await fetchJson(`${host}/v1/tracks/search?query=${encodeURIComponent(query)}&limit=8&app_name=MUSIC_STAGE`,signal);found={host,list:json.data||[]};break;}catch(error){lastError=error.message;}}
      if(!found){say(`Audius unavailable (${lastError}) — try Archive.org.`);return;}
      for(const track of found.list)addRes(`${track.title||'?'} — ${track.user?.name||'Unknown'}`,()=>loadRemote(`${found.host}/v1/tracks/${encodeURIComponent(track.id)}/stream?app_name=MUSIC_STAGE`,track.title,{title:track.title,artist:track.user?.name,source:'Audius',artwork:track.artwork?.['480x480']}));say(found.list.length?`${found.list.length} tracks found.`:'Nothing found.');
    }else{
      const json=await fetchJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query+' AND mediatype:audio')}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=12&sort[]=downloads+desc&output=json`,signal),docs=json.response?.docs||[],words=query.toLowerCase().split(/\s+/).filter(word=>word.length>2);
      docs.sort((a,b)=>words.reduce((n,w)=>n+(((b.title||'')+' '+(b.creator||'')).toLowerCase().includes(w)?1:0),0)-words.reduce((n,w)=>n+(((a.title||'')+' '+(a.creator||'')).toLowerCase().includes(w)?1:0),0));
      for(const doc of docs)addRes(`${doc.title||doc.identifier} — ${doc.creator||''}${doc.year?' ('+doc.year+')':''}`,async()=>{try{say('Resolving playable files…');const metadata=await fetchJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,new AbortController().signal),files=(metadata.files||[]).filter(file=>/\.(mp3|ogg|m4a|opus)$/i.test(file.name||'')).sort((a,b)=>(+a.size||Infinity)-(+b.size||Infinity)),file=files[0];if(!file){say('No playable audio file was listed.');return;}await loadRemote(`https://archive.org/download/${encodeURIComponent(doc.identifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`,doc.title||doc.identifier,{title:doc.title||doc.identifier,artist:doc.creator||'Internet Archive',album:doc.year?String(doc.year):'',source:'Internet Archive'});}catch(error){say(`Could not resolve that item: ${error.message||error}`);}});say(`${docs.length} results — smallest playable files are chosen first.`);
    }
  }catch(error){if(error.name!=='AbortError')say(`Search failed: ${error.message||error}. Upload a local file instead.`);}
};

const baseResampleStem=resampleStem;
resampleStem=async function(left,right,sourceRate=44100){
  const n=left.length,source=AC.createBuffer(2,n,sourceRate);source.getChannelData(0).set(left);source.getChannelData(1).set(right);if(sourceRate===AC.sampleRate)return source;
  const offline=new OfflineAudioContext(2,Math.round(n*AC.sampleRate/sourceRate),AC.sampleRate),node=offline.createBufferSource();node.buffer=source;node.connect(offline.destination);node.start();return offline.startRendering();
};
function openStageDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open('stage',2);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('stems'))request.result.createObjectStore('stems');if(!request.result.objectStoreNames.contains('meta'))request.result.createObjectStore('meta');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Storage is open in another tab.'));});}
loadStemsFromCache=async function(){
  try{if(!('indexedDB' in window))return;const db=await openStageDatabase(),record=await new Promise((resolve,reject)=>{const request=db.transaction('stems').objectStore('stems').get('set1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();if(!record?.vocals)return;
    ensureAudioContext();const loaded={};for(const key of ['vocals','drums','bass','other'])if(record[key]?.l)loaded[key]=await resampleStem(record[key].l,record[key].r,Number(record.rate)||44100);stemBufs=loaded;stemNames=Object.keys(loaded);
    if(stemNames.length){$('mapStems').style.display='';if(!buf)setTrackMetadata({title:record.name||'Separated stems',artist:'Local stem cache',source:'IndexedDB',artwork:MediaUtils.artworkData(record.name||'Stems','Music Stage'),details:`${stemNames.length} synchronized parts · ${fmt(loaded[stemNames[0]].duration)}`});say(`Cached stems ready: ${stemNames.join(', ')}.`);showSel();}updateStorageUsage();
  }catch(error){say(`Cached stems could not be opened: ${error.message||error}`);}
};
async function updateStorageUsage(){if(!$('storageUsage'))return;try{const estimate=await navigator.storage?.estimate?.();$('storageUsage').textContent=estimate?.usage!=null?`Browser storage: ${MediaUtils.formatBytes(estimate.usage)} used${estimate.quota?' of '+MediaUtils.formatBytes(estimate.quota):''}.`:'Browser storage estimate unavailable.';}catch{$('storageUsage').textContent='Browser storage estimate unavailable.';}}
$('clearStems').onclick=async()=>{try{if(playing.length)stopPb();const db=await openStageDatabase();await new Promise((resolve,reject)=>{const transaction=db.transaction(['stems','meta'],'readwrite');transaction.objectStore('stems').delete('set1');transaction.objectStore('meta').delete('schema');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});db.close();clearStems();if(!buf){currentTrack={title:'Choose a track',artist:'Upload audio, load a demo, or browse free music',album:'',source:'Local-first',details:'Cached stems cleared.',artwork:'',state:'empty'};setLoadState('empty','Cached stems cleared.');}else say('Cached stems cleared.');updateStorageUsage();}catch(error){say(`Could not clear stems: ${error.message||error}`);}};

const originalStartPb=startPb,originalStopPb=stopPb,originalSeekTo=seekTo;
startPb=function(offset){originalStartPb(offset);const generation=++playbackGeneration;for(const source of playing){source.loop=repeatEnabled;if(!repeatEnabled)source.onended=()=>{if(generation!==playbackGeneration||!playing.includes(source))return;stopPb();playOffset=0;updTime();setLoadState('ready');};}setLoadState('playing');$('play').textContent='Pause';$('play').setAttribute('aria-label','Pause');$('miniPlay').textContent='Pause';$('miniPlay').setAttribute('aria-label','Pause');startTransportLoop();if('mediaSession' in navigator)navigator.mediaSession.playbackState='playing';};
stopPb=function(){playbackGeneration++;originalStopPb();cancelAnimationFrame(transportFrame);$('play').textContent='Play';$('play').setAttribute('aria-label','Play');$('miniPlay').textContent='Play';$('miniPlay').setAttribute('aria-label','Play');if(currentTrack.state!=='empty')setLoadState('paused');if('mediaSession' in navigator)navigator.mediaSession.playbackState='paused';};
seekTo=function(value){const duration=dur();if(!duration)return;const target=repeatEnabled?value:Math.max(0,Math.min(duration-0.001,value));originalSeekTo(target);refreshPlayerPosition();};
togglePlay=async function(){try{ensureAudioContext();await AC.resume();if(playing.length){stopPb();return;}if(!buf&&!Object.keys(stemBufs).length){setLoadState('error','Choose an audio file or demo before pressing Play.');return;}startPb(playOffset||0);}catch(error){setLoadState('error',`Playback failed: ${error.message||error}`);}};
$('play').onclick=togglePlay;$('miniPlay').onclick=togglePlay;$('miniStage').onclick=()=>goTab('stage');
$('stop').onclick=()=>{if(playing.length)stopPb();playOffset=0;$('seek').value=0;refreshPlayerPosition();if(currentTrack.state!=='empty')setLoadState('ready','Stopped.');};
$('repeat').onclick=()=>{repeatEnabled=!repeatEnabled;$('repeat').setAttribute('aria-pressed',String(repeatEnabled));for(const source of playing)source.loop=repeatEnabled;say(repeatEnabled?'Repeat on.':'Repeat off.');};
$('mute').onclick=()=>{const muting=$('mute').getAttribute('aria-pressed')!=='true';if(muting){lastAudibleVolume=+$('mvol').value||lastAudibleVolume;$('mvol').value=0;}else $('mvol').value=lastAudibleVolume;$('mvol').dispatchEvent(new Event('input',{bubbles:true}));$('mute').setAttribute('aria-pressed',String(muting));$('mute').textContent=muting?'Unmute':'Mute';};
$('mvol').addEventListener('input',()=>{const value=+$('mvol').value;if(value>0){lastAudibleVolume=value;$('mute').setAttribute('aria-pressed','false');$('mute').textContent='Mute';}});
function refreshPlayerPosition(){const duration=dur(),position=duration?curPos():0;$('elapsed').textContent=fmt(position);$('remaining').textContent='−'+fmt(Math.max(0,duration-position));$('time').textContent=`${fmt(position)} / ${fmt(duration)}`;$('seek').setAttribute('aria-valuetext',`${fmt(position)} of ${fmt(duration)}`);if(playing.length&&duration)$('seek').value=Math.round(position/duration*1000);updateOutputMeters();if('mediaSession' in navigator&&duration&&Number.isFinite(duration)){try{navigator.mediaSession.setPositionState({duration,playbackRate:1,position:Math.min(position,Math.max(0,duration-0.001))});}catch(_){}}}
function startTransportLoop(){cancelAnimationFrame(transportFrame);const frame=()=>{refreshPlayerPosition();if(playing.length)transportFrame=requestAnimationFrame(frame);};transportFrame=requestAnimationFrame(frame);}
if('mediaSession' in navigator){for(const [action,handler] of [['play',togglePlay],['pause',togglePlay],['stop',$('stop').onclick],['seekbackward',details=>seekTo(curPos()-(details.seekOffset||10))],['seekforward',details=>seekTo(curPos()+(details.seekOffset||10))],['seekto',details=>seekTo(details.seekTime||0)]])try{navigator.mediaSession.setActionHandler(action,handler);}catch(_){};}
updatePlayerSurface();updateStorageUsage();refreshPlayerPosition();
