/* Self-contained worker: WASM and all processing assets are embedded at build time. */
const WASM_BASE64='__WASM_BASE64__';
const coreReady=(async()=>{
 const bytes=Uint8Array.from(atob(WASM_BASE64),c=>c.charCodeAt(0));
 const {instance}=await WebAssembly.instantiate(bytes,{env:{emscripten_notify_memory_growth(){}}});
 instance.exports._initialize();postMessage({type:'ready'});return instance.exports;
})();
const orientationFlags={'upright':0,'upside-down':2,'end-fire':1,'end-fire-upside-down':3};
function finite(v){return Number.isFinite(v)?v:null;}
function db(v){return v>0?20*Math.log10(v):null;}
function makeHeader(channels,rate,frames){
 const size=frames*channels*4,rf64=size+48>0xffffffff,b=new ArrayBuffer(rf64?92:56),v=new DataView(b);let p=0;
 const text=s=>{for(const c of s)v.setUint8(p++,c.charCodeAt(0));};const u32=n=>{v.setUint32(p,n,true);p+=4;};const u16=n=>{v.setUint16(p,n,true);p+=2;};const u64=n=>{v.setBigUint64(p,BigInt(n),true);p+=8;};
 text(rf64?'RF64':'RIFF');u32(rf64?0xffffffff:size+48);text('WAVE');
 if(rf64){text('ds64');u32(28);u64(size+84);u64(size);u64(frames);u32(0);}
 text('fmt ');u32(16);u16(3);u16(channels);u32(rate);u32(rate*channels*4);u16(channels*4);u16(32);
 text('fact');u32(4);u32(Math.min(frames,0xffffffff));text('data');u32(rf64?0xffffffff:size);return b;
}
class Reader{
 constructor(meta){this.meta=meta;this.start=-1;this.count=0;this.view=null;}
 async cache(frame,count){
  if(this.view&&frame>=this.start&&frame+count<=this.start+this.count)return;
  const m=this.meta,n=Math.min(m.frames-frame,Math.max(count,65536));
  const buffer=await m.file.slice(m.data_offset+frame*m.align,m.data_offset+(frame+n)*m.align).arrayBuffer();
  if(buffer.byteLength!==n*m.align)throw Error('Truncated input audio');
  this.start=frame;this.count=n;this.view=new DataView(buffer);
 }
 sample(frame,channel){
  const m=this.meta,offset=(frame-this.start)*m.align+channel*(m.bits/8),v=this.view;let x;
  if(m.kind===3)x=m.bits===32?v.getFloat32(offset,true):v.getFloat64(offset,true);
  else if(m.bits===16)x=v.getInt16(offset,true)/32768;
  else if(m.bits===32)x=v.getInt32(offset,true)/2147483648;
  else{let z=v.getUint8(offset)|(v.getUint8(offset+1)<<8)|(v.getUint8(offset+2)<<16);if(z&0x800000)z-=0x1000000;x=z/8388608;}
  if(!Number.isFinite(x))throw Error('Input contains NaN or infinite samples');return x;
 }
}
function reportStats(values,loudness,meta,format,settings){
 const n=values[0],names=format==='ambix'?['W','Y','Z','X']:['W','X','Y','Z'];const channels=[];
 for(let i=0;i<4;i++){const rms=n?Math.sqrt(Math.max(0,values[5+i]/n)):0,peak=values[9+i];channels.push({channel:i+1,name:names[i],rms_dbfs:db(rms),peak_dbfs:db(peak),crest_db:rms?db(peak/rms):null,above_full_scale:values[13+i],at_full_scale:values[17+i],mean:n?values[1+i]/n:0});}
 const correlation=[];for(let i=0;i<4;i++){const row=[];for(let j=0;j<4;j++){const ei=n?values[5+i]-values[1+i]*values[1+i]/n:0,ej=n?values[5+j]-values[1+j]*values[1+j]/n:0,cov=n?values[21+4*i+j]-values[1+i]*values[1+j]/n:0;row.push(ei>0&&ej>0?Math.max(-1,Math.min(1,cov/Math.sqrt(ei*ej))):null);}correlation.push(row);}
 const indices=['X','Y','Z'].map(k=>names.indexOf(k)),wscale=format==='ambix'?1:Math.SQRT2,ew=values[5]*wscale*wscale,ed=indices.reduce((s,i)=>s+values[5+i],0),intensity=indices.map(i=>values[21+i]*wscale),length=Math.hypot(...intensity);
 const concentration=ew+ed>0?Math.max(0,Math.min(1,2*length/(ew+ed))):null,available=concentration!==null&&concentration>=.01;
 return {sample_rate:meta.sample_rate,frames:meta.frames,duration_seconds:meta.frames/meta.sample_rate,format,channel_labels:names,source_name:meta.name,settings,
  max_sample_peak_dbfs:db(Math.max(...values.slice(9,13))),combined_component_rms_dbfs:n?db(Math.sqrt(values.slice(5,9).reduce((a,b)=>a+b,0)/(4*n))):null,channels,correlation,
  w_mono_loudness:{integrated_lufs:ew?finite(loudness[0]):null,range_lu:finite(loudness[1]),true_peak_dbtp:finite(loudness[2]),note:'SN3D W as mono. BS.1770 K-weighting and gating; 4× FIR true-peak estimate. Not four-channel programme LUFS.'},
  directionality:{azimuth_degrees:available?Math.atan2(intensity[1],intensity[0])*180/Math.PI:null,elevation_degrees:available?Math.atan2(intensity[2],Math.hypot(intensity[0],intensity[1]))*180/Math.PI:null,concentration,diffuseness_estimate:concentration===null?null:1-concentration,note:'Overall active-intensity estimate. Positive azimuth is left; positive elevation is up. Moving/opposing sources can cancel.'}};
}
function rotationMatrix(settings){
 const rad=Math.PI/180,y=(settings.yaw||0)*rad,p=(settings.pitch||0)*rad,r=(settings.roll||0)*rad;
 const cy=Math.cos(y),sy=Math.sin(y),cp=Math.cos(p),sp=Math.sin(p),cr=Math.cos(r),sr=Math.sin(r);
 // Active sound-field rotation Rz(yaw) Ry(-pitch) Rx(roll), X front, Y left, Z up.
 return [cy*cp,-cy*sp*sr-sy*cr,-cy*sp*cr+sy*sr,sy*cp,-sy*sp*sr+cy*cr,-sy*sp*cr-cy*sr,sp,cp*sr,cp*cr];
}
function rotateAudio(audio,frames,ambix,m){
 const xi=ambix?3:1,yi=ambix?1:2,zi=ambix?2:3;
 for(let k=0;k<frames;k++){const i=k*4,x=audio[i+xi],y=audio[i+yi],z=audio[i+zi];
  audio[i+xi]=m[0]*x+m[1]*y+m[2]*z;audio[i+yi]=m[3]*x+m[4]*y+m[5]*z;audio[i+zi]=m[6]*x+m[7]*y+m[8]*z;
 }
}
function safeStem(s){return String(s).replace(/\.wave?$/i,'').replace(/[^\w .()\-]/g,'_').slice(0,140)||'recording';}
async function convertRecording(e,recording,settings,jobid){
 const sources=recording.sources,meta=sources[0],rate=meta.sample_rate,frames=meta.frames,format=settings.format,ambix=format==='ambix';
 if(sources.some(s=>s.sample_rate!==rate||s.frames!==frames))throw Error('Split inputs must have identical sample rates and lengths');
 const counts=sources.map(s=>s.channels);
 if(!(['4','2,2','1,1,1,1'].includes(counts.join(','))))throw Error('Use one 4-channel, two stereo, or four mono WAV files');
 const order=settings.capsule_order;
 if(order.length!==4||[...order].sort().join(',')!=='1,2,3,4')throw Error('Each source channel must be assigned once');
 const rotate=!!(settings.yaw||settings.pitch||settings.roll),rotation=rotationMatrix(settings);
 const readers=sources.map(s=>new Reader(s));const addresses=[];for(let i=0;i<sources.length;i++)for(let ch=0;ch<sources[i].channels;ch++)addresses.push([i,ch]);
 const state=e.rode_create(rate);if(!state)throw Error('Converter could not allocate memory');e.rode_match_neutral_api(state,1);e.rode_set_orientation(state,orientationFlags[settings.orientation]||0);
 const hop=e.rode_hop(state),input=e.malloc(hop*16),output=e.malloc(hop*16),stats=e.stats_create(),meter=e.meter_create(rate,ambix?1:0),statsResult=e.malloc(37*8),meterResult=e.malloc(5*8);
 if(!input||!output||!stats||!meter||!statsResult||!meterResult){e.rode_destroy(state);throw Error('Browser memory is exhausted. Try a smaller recording.');}
 const nc=settings.output_layout==='mono'?1:settings.output_layout==='stereo'?2:4;
 const parts=Array.from({length:4/nc},()=>[makeHeader(nc,rate,frames)]);const gain=Math.fround(10**(settings.gain_db/20));let pos=0,written=0,first=true,lastProgress=-1;
 const previewParts=[makeHeader(4,rate,frames)];
 const spatial=[],binFrames=Math.max(Math.round(rate*.5),Math.ceil(frames/2000));let bin=new Float64Array(16),binCount=0;
 function spatialPush(audio,n){for(let k=0;k<n;k++){let i=k*4;const v=ambix?[audio[i],audio[i+3],audio[i+1],audio[i+2]]:[audio[i]*Math.SQRT2,audio[i+1],audio[i+2],audio[i+3]];for(let a=0;a<4;a++)for(let b=0;b<4;b++)bin[a*4+b]+=v[a]*v[b];if(++binCount===binFrames){spatial.push(Array.from(bin,x=>x/binCount));bin.fill(0);binCount=0;}}}

 const update=(progress,stage='Converting')=>{if(progress-lastProgress>=.005||progress===1){lastProgress=progress;postMessage({type:'progress',jobid,file_id:recording.file_id,progress,stage});}};
 try{
  while(pos<frames||written<frames){
   const count=Math.min(hop,frames-pos);for(const reader of readers)if(count)await reader.cache(pos,count);
   let inputView=new Float32Array(e.memory.buffer,input,hop*4);inputView.fill(0);
   for(let k=0;k<count;k++)for(let c=0;c<4;c++){const [source,ch]=addresses[order[c]-1];inputView[k*4+c]=readers[source].sample(pos+k,ch);}
   pos+=count;e.rode_process(state,input,output,ambix?1:0);
   if(first){first=false;continue;}
   const emit=Math.min(hop,frames-written);let audio=new Float32Array(e.memory.buffer,output,hop*4);
   spatialPush(audio,emit);
   const previewChunk=audio.slice(0,emit*4);
   if(!ambix)for(let k=0;k<emit;k++){const i=k*4,w=previewChunk[i],x=previewChunk[i+1],y=previewChunk[i+2],z=previewChunk[i+3];previewChunk[i]=w*Math.SQRT2;previewChunk[i+1]=y;previewChunk[i+2]=z;previewChunk[i+3]=x;}
   previewParts.push(previewChunk.buffer);
   if(rotate)rotateAudio(audio,emit,ambix,rotation);
   for(let k=0;k<emit*4;k++){if(gain!==1)audio[k]=audio[k]*gain;if(settings.clamp)audio[k]=Math.max(-1,Math.min(1,audio[k]));}
   e.stats_push(stats,output,emit);e.meter_push(meter,output,emit);audio=new Float32Array(e.memory.buffer,output,hop*4);
   if(nc===4)parts[0].push(audio.slice(0,emit*4).buffer);
   else for(let file=0;file<4/nc;file++){const chunk=new Float32Array(emit*nc);for(let k=0;k<emit;k++)for(let ch=0;ch<nc;ch++)chunk[k*nc+ch]=audio[k*4+file*nc+ch];parts[file].push(chunk.buffer);}
   written+=emit;update(frames?.95*written/frames:.95);
  }
  update(.97,'Analyzing');e.stats_get(stats,statsResult);e.meter_finish(meter,meterResult);
  const values=Array.from(new Float64Array(e.memory.buffer,statsResult,37)),loudness=Array.from(new Float64Array(e.memory.buffer,meterResult,5));
  const analysis=reportStats(values,loudness,{...meta,name:recording.name},format,settings);if(binCount)spatial.push(Array.from(bin,x=>x/binCount));analysis.spatial_preview={seconds_per_bin:binFrames/rate,covariance:spatial,note:'Pre-output-rotation directional cardioid energy; normalized per window. Front hemisphere only. Before output gain and clamp.'};const labels=analysis.channel_labels;const stem=safeStem(recording.name);
  const downloads=parts.map((chunks,index)=>{const components=labels.slice(index*nc,(index+1)*nc),suffix=nc===4?'':`_${components.join('')}`;return {label:nc===4?'4-channel WAV':nc===2?`Pair ${index+1}: ${components.join('/')}`:`Mono: ${components[0]}`,name:`${stem}_${format}${suffix}.wav`,blob:new Blob(chunks,{type:'audio/wav'})};});
  downloads.push({label:'Analysis JSON',name:`${stem}_analysis.json`,blob:new Blob([JSON.stringify(analysis,null,2)+'\n'],{type:'application/json'})});return {analysis,downloads,preview_audio:new Blob(previewParts,{type:'audio/wav'})};
 }finally{e.rode_destroy(state);e.stats_destroy(stats);e.meter_destroy(meter);e.free(input);e.free(output);e.free(statsResult);e.free(meterResult);}
}
self.onmessage=async event=>{
 if(event.data.type!=='convert')return;const {jobid,recordings,settings}=event.data;
 try{
  const e=await coreReady;
  for(const recording of recordings){
   postMessage({type:'progress',jobid,file_id:recording.file_id,progress:0,stage:'Converting'});
   try{const result=await convertRecording(e,recording,settings,jobid);postMessage({type:'complete',jobid,file_id:recording.file_id,...result});}
   catch(error){postMessage({type:'error',jobid,file_id:recording.file_id,error:error.message||String(error)});}
  }
  postMessage({type:'finished',jobid});
 }catch(error){postMessage({type:'fatal',jobid,error:error.message||String(error)});}
};
