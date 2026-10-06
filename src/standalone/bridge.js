/* All operations below are local File/Blob APIs. No HTTP requests. */
const BrowserRuntime=(()=>{
 const files=new Map(),jobs=new Map();let worker=null,workerReady;
 function makeWorker(){
  const url=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'application/javascript'}));
  worker=new Worker(url);URL.revokeObjectURL(url);
  workerReady=new Promise((resolve,reject)=>{
   worker.onerror=event=>{reject(Error(event.message||'Browser converter failed to start'));for(const job of jobs.values())if(job.status==='processing'){job.status='complete';for(const item of job.items)if(['queued','processing'].includes(item.status)){item.status='error';item.error=event.message||'Browser conversion failed';}}};
   worker.onmessage=event=>{
    const data=event.data;if(data.type==='ready'){resolve(true);return;}
    const job=jobs.get(data.jobid);if(!job)return;
    const item=job.items.find(i=>i.file_id===data.file_id);
    if(data.type==='progress'&&item){item.status='processing';item.progress=data.progress;item.stage=data.stage;}
    if(data.type==='complete'&&item){item.status='complete';item.progress=1;item.stage='Complete';item.analysis=data.analysis;item.preview_audio=data.preview_audio;item.downloads=data.downloads.map(d=>({...d,url:URL.createObjectURL(d.blob)}));}
    if(data.type==='error'&&item){item.status='error';item.stage='Failed';item.error=data.error;}
    if(data.type==='fatal'){for(const i of job.items)if(['queued','processing'].includes(i.status)){i.status='error';i.error=data.error;}job.status='complete';}
    if(['finished','fatal'].includes(data.type)){job.status='complete';job.completed=job.items.filter(i=>i.status==='complete').length;job.failed=job.items.filter(i=>i.status==='error').length;}
   };
  });
 }
 async function parse(file){
  const header=await file.slice(0,12).arrayBuffer();if(header.byteLength!==12)throw Error('Not a WAV file');
  const decode=new TextDecoder();const signature=decode.decode(header.slice(0,4));if(!['RIFF','RF64'].includes(signature)||decode.decode(header.slice(8))!=='WAVE')throw Error('Choose a RIFF WAV or RF64 file');
  let pos=12,fmt=null,data=null,large=null;
  while(pos+8<=file.size){
   const h=new DataView(await file.slice(pos,pos+8).arrayBuffer()),tag=String.fromCharCode(...new Uint8Array(h.buffer,0,4)),size=h.getUint32(4,true);const offset=pos+8;
   if(tag==='ds64'){if(size<28)throw Error('Invalid RF64 size chunk');const v=new DataView(await file.slice(offset,offset+28).arrayBuffer());large=Number(v.getBigUint64(8,true));}
   if(tag==='fmt '){if(size<16||size>65536)throw Error('Invalid WAV format');fmt=new DataView(await file.slice(offset,offset+size).arrayBuffer());}
   let actual=size;
   if(tag==='data'){actual=size===0xffffffff?large:size;if(actual===null)throw Error('Missing RF64 data size');data={offset,size:actual};if(fmt)break;}
   if(!Number.isSafeInteger(actual))throw Error('WAV size is unsupported');pos=offset+actual+(actual%2);
  }
  if(!fmt||!data)throw Error('WAV format or audio data is missing');
  let kind=fmt.getUint16(0,true);const channels=fmt.getUint16(2,true),rate=fmt.getUint32(4,true),align=fmt.getUint16(12,true),bits=fmt.getUint16(14,true);
  if(kind===65534){if(fmt.byteLength<40)throw Error('Invalid extensible WAV');const valid=fmt.getUint16(18,true);if(valid!==0&&valid!==bits)throw Error('Padded PCM containers are unsupported');kind=fmt.getUint32(24,true);const tail=Array.from(new Uint8Array(fmt.buffer,28,12));if(tail.join(',')!=='0,0,16,0,128,0,0,170,0,56,155,113')throw Error('Unsupported extensible audio format');}
  if(![1,2,4].includes(channels))throw Error('Inputs must have 1, 2 or 4 channels');
  if(rate<11025||rate>192000)throw Error('Sample rate must be 11025–192000 Hz');
  if(!((kind===1&&[16,24,32].includes(bits))||(kind===3&&[32,64].includes(bits))))throw Error('Unsupported WAV sample format');
  if(align!==channels*(bits/8)||data.size%align||data.offset+data.size>file.size)throw Error('Invalid or truncated WAV data');
  const meta={id:crypto.randomUUID(),name:file.name,bytes:file.size,sample_rate:rate,bits,frames:data.size/align,duration_seconds:data.size/align/rate,channels,kind,align,data_offset:data.offset,file};files.set(meta.id,meta);return meta;
 }
 function validate(settings){
  for(const k of ['yaw','pitch','roll'])if(settings[k]!==undefined&&(!Number.isFinite(settings[k])||Math.abs(settings[k])>180))throw Error('Rotation angles must be between -180 and +180 degrees');
  if(!['ambix','fuma'].includes(settings.format))throw Error('Unknown output format');
  if(!['quad','stereo','mono'].includes(settings.output_layout))throw Error('Unknown output layout');
  if(!['upright','upside-down','end-fire','end-fire-upside-down'].includes(settings.orientation))throw Error('Unknown orientation');
  if(!Number.isFinite(settings.gain_db)||settings.gain_db< -60||settings.gain_db>24)throw Error('Gain must be -60 to +24 dB');
  if([...settings.capsule_order].sort().join(',')!=='1,2,3,4')throw Error('Assign each source channel once');
 }
 async function api(path,method='GET',body){
  if(path==='/api/config'){await workerReady;return {token:'local',app:'ntsf1-standalone',engine:'wasm'};}
  if(path.startsWith('/api/files/')&&method==='DELETE'){files.delete(path.split('/').pop());return {removed:true};}
  if(path==='/api/jobs'&&method==='POST'){
   await workerReady;validate(body.settings);
   const recordings=body.recordings.map(r=>{
    const sources=r.files.map(id=>files.get(id));if(sources.some(s=>!s))throw Error('An input is missing');
    if(!['4','2,2','1,1,1,1'].includes(sources.map(s=>s.channels).join(',')))throw Error('Choose matching input layouts');
    if(sources.some(s=>s.frames!==sources[0].frames||s.sample_rate!==sources[0].sample_rate))throw Error('Split inputs must have identical sample rates and lengths');
    return {...r,file_id:crypto.randomUUID(),client_id:r.id,sources};
   });
   const job={id:crypto.randomUUID(),status:'processing',settings:body.settings,items:recordings.map(r=>({file_id:r.file_id,client_id:r.client_id,name:r.name,status:'queued',stage:'Queued',progress:0}))};
   jobs.set(job.id,job);worker.postMessage({type:'convert',jobid:job.id,recordings,settings:body.settings});return job;
  }
  const parts=path.split('/');const job=jobs.get(parts[3]);if(!job)throw Error('Unknown conversion');
  if(method==='POST'&&parts[4]==='cancel'){
   worker.terminate();job.status='canceled';for(const item of job.items)if(['queued','processing'].includes(item.status)){item.status='canceled';item.stage='Canceled';}
   job.completed=job.items.filter(i=>i.status==='complete').length;job.failed=job.items.filter(i=>i.status==='error').length;makeWorker();return {canceled:true};
  }
  return job;
 }
 const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
 async function crc32(blob){let c=0xffffffff;const reader=blob.stream().getReader();while(true){const {value,done}=await reader.read();if(done)break;for(const v of value)c=(c>>>8)^crcTable[(c^v)&255];}return (c^0xffffffff)>>>0;}
 function zipHeader(signature,length){const b=new ArrayBuffer(length),v=new DataView(b);v.setUint32(0,signature,true);return [b,v];}
 async function zip(jobid){
  const job=jobs.get(jobid);if(!job)throw Error('No batch to download');const parts=[],central=[];let offset=0,entries=0;const encoder=new TextEncoder();
  for(let i=0;i<job.items.length;i++){
   const item=job.items[i];if(item.status!=='complete')continue;
   for(const d of item.downloads){
    const clean=String(item.name).replace(/[^\w .()\-]/g,'_'),name=encoder.encode(`${String(i+1).padStart(2,'0')}_${clean}/${d.name}`),size=d.blob.size;
    if(size>0xffffffff||offset+size+name.length+30>0xffffffff)throw Error('Batch is too large for ZIP. Download the WAV files individually.');
    const crc=await crc32(d.blob);const [h,v]=zipHeader(0x04034b50,30);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,size,true);v.setUint32(22,size,true);v.setUint16(26,name.length,true);
    parts.push(h,name,d.blob);const [c,cv]=zipHeader(0x02014b50,46);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,crc,true);cv.setUint32(20,size,true);cv.setUint32(24,size,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.push(c,name);offset+=30+name.length+size;entries++;
   }
  }
  const centralLength=central.reduce((n,b)=>n+b.byteLength,0);const [end,v]=zipHeader(0x06054b50,22);v.setUint16(8,entries,true);v.setUint16(10,entries,true);v.setUint32(12,centralLength,true);v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
 }
 makeWorker();return {parse,api,zip};
})();
