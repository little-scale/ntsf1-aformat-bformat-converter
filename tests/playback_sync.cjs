const fs=require('fs'),vm=require('vm'),assert=require('assert');
const elements=new Map();
function element(id){if(elements.has(id))return elements.get(id);const listeners={};const e={id,value:'',textContent:'',disabled:false,style:{},addEventListener(k,fn){(listeners[k]??=[]).push(fn);},async emit(k){for(const fn of listeners[k]||[])await fn({});},click(){return this.emit('click');},append(o){if(!this.value)this.value=o.value;},replaceChildren(){this.value='';},getBoundingClientRect(){return {left:0,top:0,width:640,height:560};},setPointerCapture(){},getContext(){return drawContext;}};elements.set(id,e);return e;}
const drawContext=new Proxy({createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};}},{get:(o,k)=>k in o?o[k]:()=>{}});
const document={getElementById:element,createElement:tag=>element('created-'+Math.random())};
for(const key of ['yaw','pitch','roll','gain','audio-position','sphere-time'])element(key).value='0';element('monitor-level').value='50';
const node=()=>({gain:{value:1,setTargetAtTime(){},setValueAtTime(){}},connect(){},disconnect(){},start(){},stop(){}});
class AudioContext{constructor(){this.currentTime=0;AudioContext.instance=this;}resume(){return Promise.resolve();}createGain(){return node();}createChannelSplitter(){return node();}createChannelMerger(){return node();}createWaveShaper(){return node();}createBufferSource(){return node();}createBuffer(ch,n,rate){return {duration:n/rate,length:n,sampleRate:rate,getChannelData:()=>new Float32Array(n)};}}
let tick;const window={AudioContext};const ctx={window,document,Math,Number,Float32Array,Float64Array,Uint8ClampedArray,DataView,Blob,console,setInterval(fn){tick=fn;return 1;},clearInterval(){tick=null;},Omnitone:{createFOARenderer:()=>({input:node(),output:node(),initialize:()=>Promise.resolve()})}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/standalone/frequency_colour.js','utf8'),ctx);vm.runInContext(fs.readFileSync('src/standalone/sphere.js','utf8'),ctx);vm.runInContext(fs.readFileSync('src/standalone/audio_preview.js','utf8'),ctx);
const covariance=Array.from({length:4},(_,i)=>Array.from({length:16},(_,k)=>k%5===0?i+1:0));
const group={id:'a',name:'first',result:{preview_audio:new Blob([new ArrayBuffer(56+20*16)]),analysis:{frames:20,sample_rate:10,spatial_preview:{seconds_per_bin:.5,covariance,frequency_bands:Array.from({length:8},(_,i)=>20*1000**((i+.5)/8)),frequency_covariance:covariance.map((c,j)=>Array.from({length:128},(_,i)=>Math.floor(i/16)===j?c[i%16]:0))}}}};
const second={...group,id:'b',name:'second'};
(async()=>{
 window.SpatialSphere.refresh([group,second],false);window.BinauralPreview.refresh([group,second],false);
 element('sphere-recording').value='b';await element('audio-play').click();assert.equal(element('sphere-recording').value,'a');
 AudioContext.instance.currentTime=.75;tick();assert.equal(element('audio-time').textContent,'0:00.8');
 await element('audio-play').click();assert.equal(tick,null);assert.equal(element('audio-time').textContent,'0:00.8');
 element('audio-position').value='1.25';await element('audio-position').emit('input');assert.equal(element('audio-time').textContent,'0:01.3');
 await element('audio-play').click();AudioContext.instance.currentTime+=.1;tick();assert.equal(element('audio-time').textContent,'0:01.4');
 await element('audio-stop').click();assert.equal(element('audio-time').textContent,'0:00.0');assert.equal(tick,null);
 window.SpatialSphere.setPlayback('a',100);
 window.SpatialSphere.refresh([],false);window.BinauralPreview.refresh([],false);
 console.log('Playback recording, clock, fractional windows, pause, seek, resume, stop and bounds passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
