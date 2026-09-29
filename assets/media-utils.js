/* Shared media parsing and guarded network helpers. Classic script by design: file:// tests use the global API. */
var MediaUtils=(()=>{
  const MAX_AUDIO_BYTES=200*1024*1024;
  const MAX_AUDIO_SECONDS=2*60*60;
  const DEFAULT_TIMEOUT_MS=60_000;

  const formatBytes=n=>{if(!Number.isFinite(n)||n<0)return 'unknown size';const u=['B','KB','MB','GB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++;}return `${v.toFixed(i?1:0)} ${u[i]}`;};
  const formatRate=n=>Number.isFinite(n)?`${(n/1000).toFixed(n%1000?1:0)} kHz`:'';
  function titleFromFilename(name=''){
    const clean=name.replace(/\.[^.]+$/,'').replace(/[_]+/g,' ').replace(/\s+/g,' ').trim();
    const parts=clean.split(/\s+-\s+/);
    return {title:(parts.length>1?parts.slice(1).join(' – '):clean)||'Untitled track',artist:parts.length>1?parts[0]:'Local file'};
  }
  function httpUrl(value){
    let url;try{url=new URL(value,location.href);}catch{throw new Error('Enter a valid audio URL.');}
    if(!['http:','https:'].includes(url.protocol))throw new Error('Only HTTP and HTTPS audio links are supported.');
    if(location.protocol==='https:'&&url.protocol==='http:')throw new Error('An HTTPS page cannot load an insecure HTTP audio link.');
    return url.href;
  }
  function synchsafe(bytes,offset){return ((bytes[offset]&0x7f)<<21)|((bytes[offset+1]&0x7f)<<14)|((bytes[offset+2]&0x7f)<<7)|(bytes[offset+3]&0x7f);}
  function decodeText(bytes){
    if(!bytes.length)return '';
    const enc=bytes[0],body=bytes.subarray(1);let label='iso-8859-1',start=0;
    if(enc===3)label='utf-8';
    else if(enc===2)label='utf-16be';
    else if(enc===1){label=body[0]===0xfe&&body[1]===0xff?'utf-16be':'utf-16le';start=2;}
    try{return new TextDecoder(label).decode(body.subarray(start)).replace(/\0/g,'').trim();}
    catch{return new TextDecoder().decode(body).replace(/\0/g,'').trim();}
  }
  function terminatedOffset(bytes,start,wide){
    if(wide){for(let i=start;i+1<bytes.length;i+=2)if(bytes[i]===0&&bytes[i+1]===0)return i+2;return bytes.length;}
    const found=bytes.indexOf(0,start);return found<0?bytes.length:found+1;
  }
  function parsePicture(bytes){
    if(bytes.length<5)return null;const enc=bytes[0],mimeEnd=bytes.indexOf(0,1);if(mimeEnd<0)return null;
    const mime=new TextDecoder('iso-8859-1').decode(bytes.subarray(1,mimeEnd))||'image/jpeg';
    const descStart=mimeEnd+2,bodyStart=terminatedOffset(bytes,descStart,enc===1||enc===2);
    if(bodyStart>=bytes.length)return null;
    try{return URL.createObjectURL(new Blob([bytes.subarray(bodyStart)],{type:mime}));}catch{return null;}
  }
  function parseId3(arrayBuffer){
    const out={};const bytes=new Uint8Array(arrayBuffer);if(bytes.length<10||String.fromCharCode(...bytes.subarray(0,3))!=='ID3')return out;
    const version=bytes[3],limit=Math.min(bytes.length,10+synchsafe(bytes,6));let p=10;
    while(p+10<=limit){
      const id=String.fromCharCode(...bytes.subarray(p,p+4));if(!/^[A-Z0-9]{4}$/.test(id))break;
      const size=version===4?synchsafe(bytes,p+4):new DataView(bytes.buffer,bytes.byteOffset+p+4,4).getUint32(0);
      if(!size||p+10+size>limit)break;const body=bytes.subarray(p+10,p+10+size);
      if(id==='TIT2')out.title=decodeText(body);else if(id==='TPE1')out.artist=decodeText(body);else if(id==='TALB')out.album=decodeText(body);else if(id==='APIC'&&!out.artwork)out.artwork=parsePicture(body);
      p+=10+size;
    }
    return out;
  }
  // 'playback' asks for a larger hardware buffer: phones trade a few ms of latency for glitch-free music.
  function createAudioContext(){
    const C=window.AudioContext||window.webkitAudioContext;if(!C)throw new Error('This browser does not provide Web Audio.');
    try{return new C({latencyHint:'playback'});}catch{return new C();}
  }
  const artworkCache=new Map();
  function artworkData(title='Music Stage',artist=''){ // memoized: an identical string keeps the decoded image cached
    const key=`${title}\u0000${artist}`,cached=artworkCache.get(key);if(cached)return cached;
    const value=buildArtwork(title,artist);if(artworkCache.size>=32)artworkCache.delete(artworkCache.keys().next().value);artworkCache.set(key,value);return value;
  }
  function buildArtwork(title,artist){
    const seed=[...`${title}${artist}`].reduce((n,ch)=>(n*31+ch.charCodeAt(0))>>>0,2166136261);
    const h1=seed%360,h2=(h1+55+(seed%90))%360;
    const initials=(title.match(/[\p{L}\p{N}]+/gu)||['♫']).slice(0,2).map(v=>v[0]).join('').toUpperCase();
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${h1} 82% 54%)"/><stop offset="1" stop-color="hsl(${h2} 82% 42%)"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-opacity=".28"/></filter></defs><rect width="512" height="512" rx="96" fill="url(#g)"/><circle cx="105" cy="96" r="150" fill="#fff" opacity=".1"/><circle cx="430" cy="450" r="190" fill="#000" opacity=".12"/><text x="256" y="290" text-anchor="middle" font-family="system-ui,sans-serif" font-size="142" font-weight="750" fill="white" filter="url(#s)">${initials}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  async function fetchBuffer(input,{signal,timeoutMs=DEFAULT_TIMEOUT_MS,maxBytes=MAX_AUDIO_BYTES,onProgress,cache='default'}={}){
    const controller=new AbortController();const abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(new DOMException('Download timed out','TimeoutError')),timeoutMs);
    try{
      const response=await fetch(input,{signal:controller.signal,cache});if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const total=Number(response.headers.get('content-length'))||0;if(total>maxBytes)throw new Error(`File is ${formatBytes(total)}; limit is ${formatBytes(maxBytes)}.`);
      if(!response.body?.getReader){const buffer=await response.arrayBuffer();if(buffer.byteLength>maxBytes)throw new Error(`File exceeds ${formatBytes(maxBytes)}.`);onProgress?.(buffer.byteLength,total||buffer.byteLength);return {buffer,response};}
      const reader=response.body.getReader(),chunks=[];let loaded=0;
      while(true){const {done,value}=await reader.read();if(done)break;loaded+=value.byteLength;if(loaded>maxBytes){controller.abort();throw new Error(`File exceeds ${formatBytes(maxBytes)}.`);}chunks.push(value);onProgress?.(loaded,total);}
      const joined=new Uint8Array(loaded);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}return {buffer:joined.buffer,response};
    }catch(error){if(controller.signal.aborted&&error?.name==='AbortError')throw new Error(controller.signal.reason?.name==='TimeoutError'?'Download timed out.':'Loading cancelled.');throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  return {DEFAULT_TIMEOUT_MS,MAX_AUDIO_BYTES,MAX_AUDIO_SECONDS,artworkData,createAudioContext,fetchBuffer,formatBytes,formatRate,httpUrl,parseId3,titleFromFilename};
})();
