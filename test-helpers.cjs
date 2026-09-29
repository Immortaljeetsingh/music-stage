'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function launchChannel(channel){let lastError;for(let attempt=0;attempt<3;attempt++){try{return await chromium.launch({channel});}catch(error){lastError=error;await wait(250*(attempt+1));}}throw lastError;}
function cachedChromium(){
  try{const expected=chromium.executablePath(),root=path.dirname(path.dirname(path.dirname(expected))),folders=fs.readdirSync(root).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));for(const folder of folders)for(const relative of [['chrome-win64','chrome.exe'],['chrome-win','chrome.exe'],['chrome-linux','chrome']]){const candidate=path.join(root,folder,...relative);if(fs.existsSync(candidate))return candidate;}}catch(_){}return null;
}
async function launchBrowser(){
  if(process.env.BROWSER_PATH)return chromium.launch({executablePath:process.env.BROWSER_PATH});
  if(process.env.PLAYWRIGHT_BROWSER==='chromium')return chromium.launch();
  if(process.env.BROWSER_CHANNEL)return launchChannel(process.env.BROWSER_CHANNEL);
  try{return await chromium.launch();}catch(_){const cached=cachedChromium();if(cached)try{return await chromium.launch({executablePath:cached});}catch(_){}return launchChannel('chrome');}
}
function listen(server,host='127.0.0.1'){
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,()=>{const address=server.address();resolve(`http://${host}:${address.port}`);});});
}
function closeServer(server){return new Promise(resolve=>server.close(resolve));}
function makeWav({seconds=1,sampleRate=48000,frequency=440,amplitude=.12}={}){
  const frames=Math.floor(seconds*sampleRate),channels=2,bits=16,dataBytes=frames*channels*bits/8,buffer=Buffer.alloc(44+dataBytes);let p=0;
  const text=value=>{buffer.write(value,p,'ascii');p+=value.length;},u16=value=>{buffer.writeUInt16LE(value,p);p+=2;},u32=value=>{buffer.writeUInt32LE(value,p);p+=4;};
  text('RIFF');u32(36+dataBytes);text('WAVE');text('fmt ');u32(16);u16(1);u16(channels);u32(sampleRate);u32(sampleRate*channels*bits/8);u16(channels*bits/8);u16(bits);text('data');u32(dataBytes);
  for(let i=0;i<frames;i++){const value=Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*amplitude*32767);for(let channel=0;channel<channels;channel++){buffer.writeInt16LE(value,p);p+=2;}}
  return buffer;
}
module.exports={closeServer,launchBrowser,listen,makeWav};
