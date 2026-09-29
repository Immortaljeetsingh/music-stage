import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/ort.bundle.min.mjs';
import {DemucsProcessor,CONSTANTS} from 'https://cdn.jsdelivr.net/npm/demucs-web@1.0.2/src/index.js';

const ORT_BASE='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/';
const MODEL_LIMIT=250*1024*1024;
const $=id=>document.getElementById(id);
let fileBuffer=null,fileName='',result=null,audioContext=null,playing=[],processor=null,processorMode='',operationController=null,cancelRequested=false;

ort.env.wasm.wasmPaths=ORT_BASE;
const say=text=>$('stat').textContent=text;
function progress(value,label){const normalized=Math.max(0,Math.min(1,Number(value)||0));$('bar').value=normalized;$('bar').setAttribute('aria-valuenow',String(Math.round(normalized*100)));if(label)say(label);}
function formatDuration(seconds){seconds=Math.max(0,Math.round(seconds));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function estimateBytes(duration){const samples=Math.ceil(duration*44100),decoded=samples*2*4,outputs=decoded*4,working=samples*4*12;return {decoded,outputs,working,total:decoded+outputs+working};}
async function updateStorage(){try{const estimate=await navigator.storage?.estimate?.();$('storage').textContent=estimate?.usage!=null?`Browser storage: ${MediaUtils.formatBytes(estimate.usage)} used${estimate.quota?' of '+MediaUtils.formatBytes(estimate.quota):''}.`:'Storage estimate unavailable.';}catch{$('storage').textContent='Storage estimate unavailable.';}}
function stopPreviews(){for(const source of playing)try{source.stop();}catch(_){}playing=[];$('stopAll').disabled=true;}
async function releaseProcessor(){stopPreviews();operationController?.abort();cancelRequested=true;result=null;try{await processor?.session?.release?.();}catch(_){}try{await processor?.session?.dispose?.();}catch(_){}processor=null;processorMode='';$('save').disabled=true;$('stems').replaceChildren(Object.assign(document.createElement('p'),{className:'empty',textContent:'Separated parts released from memory.'}));progress(0);say(fileBuffer?`${fileName} remains ready. Press Separate to run again.`:'Memory released. Choose a track.');}
function openDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open('stage',2);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('stems'))request.result.createObjectStore('stems');if(!request.result.objectStoreNames.contains('meta'))request.result.createObjectStore('meta');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Storage is open in another tab.'));});}
async function chooseProviders(mode){
  const hasGpu=!!navigator.gpu&&!!await navigator.gpu.requestAdapter().catch(()=>null);if(mode==='webgpu'&&!hasGpu)throw new Error('WebGPU was requested but no compatible adapter is available.');
  const providers=mode==='wasm'?['wasm']:mode==='webgpu'?['webgpu']:hasGpu?['webgpu','wasm']:['wasm'];
  const threads=crossOriginIsolated?Math.max(1,Math.min(navigator.hardwareConcurrency||4,8)):1;ort.env.wasm.numThreads=threads;
  $('modeDetail').textContent=`${providers.join(' → ')} · ${threads} thread${threads===1?'':'s'}`;$('runtimeBadge').textContent=hasGpu?'WebGPU available':'WebAssembly ready';$('runtimeBadge').className='badge good';return {providers,threads};
}
async function prepareProcessor(mode,signal){
  if(processor&&processorMode===mode)return processor;if(processor){try{await processor.session?.release?.();}catch(_){}try{await processor.session?.dispose?.();}catch(_){}processor=null;processorMode='';}cancelRequested=false;const {providers}=await chooseProviders(mode);say('Downloading the HTDemucs model (~172 MB)…');
  const {buffer}=await MediaUtils.fetchBuffer(CONSTANTS.DEFAULT_MODEL_URL,{signal,timeoutMs:10*60_000,maxBytes:MODEL_LIMIT,cache:'force-cache',onProgress:(loaded,total)=>{if(cancelRequested)throw new DOMException('Cancelled','AbortError');progress(total?loaded/total:0,`Model: ${MediaUtils.formatBytes(loaded)}${total?' / '+MediaUtils.formatBytes(total):''}`);}});
  if(cancelRequested)throw new DOMException('Cancelled','AbortError');say('Initializing the inference runtime…');const smallDevice=(navigator.deviceMemory||4)<8||Math.min(screen.width,screen.height)<700;
  processor=new DemucsProcessor({ort,sessionOptions:{executionProviders:providers,graphOptimizationLevel:'all',...(smallDevice?{enableCpuMemArena:false,enableMemPattern:false}:{})},onProgress:({progress:amount,currentSegment,totalSegments})=>{if(cancelRequested)throw new DOMException('Cancelled','AbortError');progress(amount,`Separating segment ${currentSegment}/${totalSegments}…`);},onLog:(_,message)=>say(message)});
  await processor.loadModel(buffer);processorMode=mode;return processor;
}

$('f').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;stopPreviews();result=null;$('save').disabled=true;$('go').disabled=true;
  try{if(file.size>MediaUtils.MAX_AUDIO_BYTES)throw new Error(`File is ${MediaUtils.formatBytes(file.size)}; the limit is ${MediaUtils.formatBytes(MediaUtils.MAX_AUDIO_BYTES)}.`);fileName=file.name;say('Reading and decoding locally…');audioContext=audioContext||new (window.AudioContext||window.webkitAudioContext)();const arrayBuffer=await file.arrayBuffer(),decoded=await audioContext.decodeAudioData(arrayBuffer),maxSeconds=+$('maxDuration').value;if(decoded.duration>maxSeconds)throw new Error(`Track is ${formatDuration(decoded.duration)}; selected limit is ${formatDuration(maxSeconds)}.`);
    const offline=new OfflineAudioContext(2,Math.ceil(decoded.duration*44100),44100),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();fileBuffer=await offline.startRendering();const memory=estimateBytes(fileBuffer.duration),device=navigator.deviceMemory?` Device memory reported: ${navigator.deviceMemory} GB.`:'';$('resource').textContent=`${fileName} · ${formatDuration(fileBuffer.duration)} · estimated separation working set ${MediaUtils.formatBytes(memory.total)} plus the model.${device}`;$('go').disabled=false;progress(0);say(`${fileName} ready — press Separate track.`);
  }catch(error){fileBuffer=null;say(`Could not prepare that file: ${error.message||error}`);$('resource').textContent='Choose a shorter or supported audio file.';}
};
$('maxDuration').onchange=()=>{if(fileBuffer&&fileBuffer.duration>+$('maxDuration').value){fileBuffer=null;$('go').disabled=true;say('The loaded track exceeds the new duration limit. Choose it again or increase the limit.');}};
$('provider').onchange=async()=>{if(processorMode&&processorMode!==$('provider').value)await releaseProcessor();};
$('go').onclick=async()=>{
  if(!fileBuffer)return;operationController?.abort();operationController=new AbortController();cancelRequested=false;$('go').disabled=true;$('cancel').disabled=false;$('save').disabled=true;stopPreviews();
  try{await audioContext.resume();const mode=$('provider').value,active=await prepareProcessor(mode,operationController.signal),started=performance.now();result=await active.separate(fileBuffer.getChannelData(0),fileBuffer.getChannelData(1));if(cancelRequested)throw new DOMException('Cancelled','AbortError');progress(1,`Done in ${Math.round((performance.now()-started)/1000)} seconds. Preview the parts, then save them to Stage.`);showResults();$('save').disabled=false;}
  catch(error){if(error.name==='AbortError'||/cancel/i.test(error.message||''))say('Separation cancelled. The loaded track is still ready.');else say(`Separation failed: ${error.message||error}`);progress(0);}
  finally{$('go').disabled=!fileBuffer;$('cancel').disabled=true;operationController=null;cancelRequested=false;}
};
$('cancel').onclick=()=>{cancelRequested=true;operationController?.abort();$('cancel').disabled=true;say('Cancelling after the current model segment…');};
function makeBuffer(stem){const buffer=audioContext.createBuffer(2,stem.left.length,44100);buffer.getChannelData(0).set(stem.left);buffer.getChannelData(1).set(stem.right);return buffer;}
function showResults(){
  $('stems').replaceChildren();for(const key of ['vocals','drums','bass','other']){const row=document.createElement('div');row.className='stem';const copy=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=key;detail.textContent=`${formatDuration(result[key].left.length/44100)} stereo`;copy.append(name,detail);const play=document.createElement('button'),stop=document.createElement('button');play.textContent='Play';play.setAttribute('aria-label',`Play ${key} preview`);stop.textContent='Stop';stop.setAttribute('aria-label',`Stop ${key} preview`);play.onclick=async()=>{await audioContext.resume();stopPreviews();const source=audioContext.createBufferSource();source.buffer=makeBuffer(result[key]);source.connect(audioContext.destination);source.onended=()=>{playing=playing.filter(item=>item!==source);$('stopAll').disabled=!playing.length;};source.start();playing.push(source);$('stopAll').disabled=false;};stop.onclick=stopPreviews;row.append(copy,play,stop);$('stems').append(row);}
}
$('stopAll').onclick=stopPreviews;$('release').onclick=releaseProcessor;
$('save').onclick=async()=>{
  if(!result)return;$('save').disabled=true;say('Checking storage and saving four synchronized stems…');
  try{const estimated=result.vocals.left.byteLength*8,storage=await navigator.storage?.estimate?.();if(storage?.quota&&storage.quota-(storage.usage||0)<estimated*1.15)throw new Error(`About ${MediaUtils.formatBytes(estimated)} is needed, but browser storage is nearly full.`);const record={name:fileName,rate:44100};for(const key of ['vocals','drums','bass','other'])record[key]={l:result[key].left,r:result[key].right};const db=await openDatabase();await new Promise((resolve,reject)=>{const transaction=db.transaction(['stems','meta'],'readwrite');transaction.objectStore('stems').put(record,'set1');transaction.objectStore('meta').put({schema:2,rate:44100,name:fileName,savedAt:new Date().toISOString()},'schema');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Storage transaction aborted.'));});db.close();await navigator.storage?.persist?.();say('Saved. Return to Stage and choose Map stems.');await updateStorage();}
  catch(error){say(`Save failed: ${error.message||error}`);$('save').disabled=false;}
};
$('clearSaved').onclick=async()=>{try{const db=await openDatabase();await new Promise((resolve,reject)=>{const transaction=db.transaction(['stems','meta'],'readwrite');transaction.objectStore('stems').delete('set1');transaction.objectStore('meta').delete('schema');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});db.close();say('Saved stems cleared from this browser.');await updateStorage();}catch(error){say(`Could not clear saved stems: ${error.message||error}`);}};
window.addEventListener('pagehide',()=>{cancelRequested=true;operationController?.abort();stopPreviews();});
(async()=>{try{await chooseProviders('auto');}catch(error){$('runtimeBadge').textContent='Runtime unavailable';$('runtimeBadge').className='badge bad';say(error.message||String(error));}await updateStorage();})();
