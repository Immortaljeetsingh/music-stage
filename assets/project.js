/* Versioned room/rig project persistence. Audio buffers never enter project files. */
const PROJECT_SCHEMA=1,PROJECT_KEY='music-stage-project-v1';
const PROJECT_CONTROL_IDS=['walls','wallAbs','roomAmt','furn','preset','air','hq','width','align','swap','bal','mvol','hpdev','trimL','trimR'];
let projectHistory=[],projectHistoryIndex=-1,historyMuted=false;
const clonePlain=value=>JSON.parse(JSON.stringify(value));
const finite=(value,fallback,min=-Infinity,max=Infinity)=>Number.isFinite(+value)?Math.max(min,Math.min(max,+value)):fallback;
function captureProject(){
  const controls={};for(const id of PROJECT_CONTROL_IDS){const el=$(id);controls[id]=el.type==='checkbox'?el.checked:el.value;}
  return {schema:PROJECT_SCHEMA,savedAt:new Date().toISOString(),room:clonePlain(room),listener:clonePlain({...listener,useSensor:false}),speakers:clonePlain(sps),furniture:clonePlain(furniture),controls,track:currentTrack?{title:currentTrack.title,artist:currentTrack.artist,album:currentTrack.album,source:currentTrack.source}:null};
}
function normalizeProject(raw){
  if(!raw||raw.schema!==PROJECT_SCHEMA||!raw.room||!Array.isArray(raw.speakers)||!Array.isArray(raw.furniture))throw new Error('Unsupported or invalid Music Stage project.');
  const nextRoom={w:finite(raw.room.w,10,2,30),l:finite(raw.room.l,10,2,30),h:finite(raw.room.h,10,2,10)};
  const nextListener={...listener,...raw.listener,x:finite(raw.listener?.x,nextRoom.w/2,0,nextRoom.w),y:finite(raw.listener?.y,nextRoom.l/2,0,nextRoom.l),yaw:finite(raw.listener?.yaw,0),pitch:finite(raw.listener?.pitch,0),useSensor:false};
  const speakers=raw.speakers.slice(0,32).map(item=>({x:finite(item.x,nextRoom.w/2,0,nextRoom.w),y:finite(item.y,nextRoom.l/2,0,nextRoom.l),h:finite(item.h,EAR,0,nextRoom.h),v:finite(item.v,1,0,4),sub:!!item.sub,ch:['L','R','M'].includes(item.ch)?item.ch:'M',band:['Full','Tweeter','Vocal','Bass','Bright'].includes(item.band)?item.band:'Full',mute:!!item.mute,...(typeof item.stem==='string'?{stem:item.stem}:{})}));
  const objects=raw.furniture.slice(0,32).map(item=>{const w=finite(item.w,1,0.1,nextRoom.w),d=finite(item.d,1,0.1,nextRoom.l);return {type:['Bed','Sofa','Wardrobe'].includes(item.type)?item.type:'Furniture',w,d,h:finite(item.h,1,0.1,nextRoom.h),x:finite(item.x,0,0,nextRoom.w-w),y:finite(item.y,0,0,nextRoom.l-d),abs:finite(item.abs,0.4,0,1)};});
  return {room:nextRoom,listener:nextListener,speakers,furniture:objects,controls:raw.controls||{}};
}
function applyProject(raw,{record=true,message='Project loaded.'}={}){
  const next=normalizeProject(raw),resume=playing.length>0,resumeAt=resume?curPos():0;if(resume)stopPb();historyMuted=true;
  room=next.room;listener=next.listener;sps=next.speakers;furniture.splice(0,furniture.length,...next.furniture);selIdx=0;
  for(const [id,value] of Object.entries(next.controls)){const el=$(id);if(!el)continue;if(el.type==='checkbox')el.checked=!!value;else el.value=String(value);}
  $('rw').value=room.w;$('rl').value=room.l;$('rh').value=room.h;TRIM={l:finite($('trimL').value,1,0,1.5),r:finite($('trimR').value,1,0,1.5)};SWAP=$('swap').checked;
  showFurniture();showSel();draw();syncMetas();syncStageDescription?.();historyMuted=false;if(record)recordProjectSnapshot();if(resume&&(buf||Object.keys(stemBufs).length))startPb(resumeAt);$('projectStatus').textContent=message;return true;
}
function recordProjectSnapshot(){
  if(historyMuted)return;const serialized=JSON.stringify(captureProject());if(projectHistory[projectHistoryIndex]===serialized)return;
  projectHistory=projectHistory.slice(0,projectHistoryIndex+1);projectHistory.push(serialized);if(projectHistory.length>40)projectHistory.shift();projectHistoryIndex=projectHistory.length-1;updateHistoryButtons();
}
function updateHistoryButtons(){$('undoProject').disabled=projectHistoryIndex<=0;$('redoProject').disabled=projectHistoryIndex<0||projectHistoryIndex>=projectHistory.length-1;}
function travelHistory(delta){const index=projectHistoryIndex+delta;if(index<0||index>=projectHistory.length)return;projectHistoryIndex=index;applyProject(JSON.parse(projectHistory[index]),{record:false,message:delta<0?'Undid project change.':'Redid project change.'});updateHistoryButtons();}
$('undoProject').onclick=()=>travelHistory(-1);$('redoProject').onclick=()=>travelHistory(1);
$('saveProject').onclick=()=>{try{localStorage.setItem(PROJECT_KEY,JSON.stringify(captureProject()));$('projectMeta').textContent='saved';$('projectStatus').textContent='Project saved in this browser. Audio remains separate.';}catch(error){$('projectStatus').textContent=`Save failed: ${error.message||error}`;}};
$('restoreProject').onclick=()=>{try{const raw=localStorage.getItem(PROJECT_KEY);if(!raw)throw new Error('No saved project was found.');applyProject(JSON.parse(raw),{message:'Saved project restored.'});$('projectMeta').textContent='restored';}catch(error){$('projectStatus').textContent=`Restore failed: ${error.message||error}`;}};
const PROJECT_SLOTS={A:'music-stage-project-slot-a',B:'music-stage-project-slot-b'};
function refreshProjectSlots(){for(const slot of ['A','B']){let exists=false;try{exists=!!localStorage.getItem(PROJECT_SLOTS[slot]);}catch(_){}$('loadSlot'+slot).disabled=!exists;}}
function saveProjectSlot(slot){try{localStorage.setItem(PROJECT_SLOTS[slot],JSON.stringify(captureProject()));$('projectStatus').textContent=`Comparison slot ${slot} saved.`;refreshProjectSlots();}catch(error){$('projectStatus').textContent=`Slot ${slot} save failed: ${error.message||error}`;}}
function loadProjectSlot(slot){try{const raw=localStorage.getItem(PROJECT_SLOTS[slot]);if(!raw)throw new Error('Slot is empty.');applyProject(JSON.parse(raw),{message:`Comparison slot ${slot} loaded.`});}catch(error){$('projectStatus').textContent=`Slot ${slot} load failed: ${error.message||error}`;}}
for(const slot of ['A','B']){$('saveSlot'+slot).onclick=()=>saveProjectSlot(slot);$('loadSlot'+slot).onclick=()=>loadProjectSlot(slot);}refreshProjectSlots();
$('exportProject').onclick=()=>{try{const blob=new Blob([JSON.stringify(captureProject(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`music-stage-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('projectStatus').textContent='Project JSON exported.';}catch(error){$('projectStatus').textContent=`Export failed: ${error.message||error}`;}};
$('importProject').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw new Error('Project file is larger than 1 MB.');applyProject(JSON.parse(await file.text()),{message:`Imported ${file.name}.`});$('projectMeta').textContent='imported';}catch(error){$('projectStatus').textContent=`Import failed: ${error.message||error}`;}finally{event.target.value='';}};
$('resetProject').onclick=()=>applyProject({schema:PROJECT_SCHEMA,room:{w:10,l:10,h:10},listener:{x:5,y:5,yaw:0,pitch:0,off:0,poff:0,sYaw:0,sPitch:0},speakers:[{x:2,y:2,h:1.6,v:1,sub:false,ch:'L',band:'Full'},{x:8,y:2,h:1.6,v:1,sub:false,ch:'R',band:'Full'}],furniture:[],controls:{walls:true,wallAbs:'0.5',roomAmt:'0.05',furn:'Empty',preset:'',air:false,hq:false,width:'1',align:true,swap:false,bal:'0',mvol:'0.9',hpdev:'',trimL:'1',trimR:'1'}},{message:'Layout and sound controls reset. Loaded audio was kept.'});
let historyTimer=0;const queueHistory=()=>{clearTimeout(historyTimer);historyTimer=setTimeout(recordProjectSnapshot,80);};
document.addEventListener('change',event=>{if(!event.target.closest('#panel-rig details:has(#saveProject)'))queueHistory();});
for(const id of ['addSp','addTw','addSub','stage8','addBed','addSofa','addWardrobe'])$(id).addEventListener('click',queueHistory);
c.addEventListener('pointerup',queueHistory);
let experience='advanced';try{experience=localStorage.getItem('experience')||'advanced';}catch(_){}
function applyExperience(){document.body.dataset.experience=experience;const simple=experience==='simple';$('modeToggle').setAttribute('aria-pressed',String(simple));$('modeToggle').textContent=simple?'Advanced mode':'Simple mode';}
$('modeToggle').onclick=()=>{experience=experience==='simple'?'advanced':'simple';try{localStorage.setItem('experience',experience);}catch(_){}applyExperience();};
applyExperience();
const welcomeDialog=$('welcomeDialog');
function openTour(){try{if(typeof welcomeDialog.showModal==='function')welcomeDialog.showModal();else welcomeDialog.setAttribute('open','');}catch(_){} }
function closeTour(){try{welcomeDialog.close();}catch(_){welcomeDialog.removeAttribute('open');}try{localStorage.setItem('tourSeen','1');}catch(_){} }
$('tourButton').onclick=openTour;$('tourClose').onclick=closeTour;$('tourCloseX').onclick=closeTour;
try{if(!navigator.webdriver&&!localStorage.getItem('tourSeen'))setTimeout(openTour,350);}catch(_){}
recordProjectSnapshot();
