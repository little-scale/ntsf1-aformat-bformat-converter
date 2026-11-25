const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');

const messages=[];
// The split branch must not allocate or process DSP state.
const workerContext={WebAssembly:{instantiate:async()=>({instance:{exports:new Proxy({_initialize(){}},{get(target,key){if(key==='then')return undefined;if(key in target)return target[key];throw Error('Split touched DSP: '+String(key));}})}})},atob,Uint8Array,Float32Array,Float64Array,DataView,ArrayBuffer,Blob,Math,Number,JSON,Error,String,self:{},postMessage:m=>messages.push(m)};
vm.createContext(workerContext);
vm.runInContext(fs.readFileSync('src/standalone/runtime_worker.js','utf8').replace('__WASM_BASE64__',''),workerContext);

const workers=[];
class Worker{constructor(){workers.push(this);setImmediate(()=>this.onmessage({data:{type:'ready'}}));}postMessage(value){this.message=value;}terminate(){}}
const bridgeContext={WORKER_SOURCE:'',Worker,URL,Blob,Map,Promise,Error,Uint8Array,Uint32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Number,String,crypto:crypto.webcrypto};
vm.createContext(bridgeContext);vm.runInContext(fs.readFileSync('src/standalone/bridge.js','utf8')+';this.runtime=BrowserRuntime;',bridgeContext);

function makeFixture(kind,bits,frames,{extensible=false,rf64=false}={}){
 const frameBytes=bits/8*4,data=Buffer.alloc(frames*frameBytes);
 // Arbitrary patterns include integer extrema, signed zeros, floats above 1,
 // and float64 precision that cannot survive a float32 roundtrip.
 for(let i=0;i<data.length;i++)data[i]=(i*73+(i>>>8)*19+0xa7)&255;
 if(kind===3){const values=[0,-0,1.5,-2.25,1+2**-40,Infinity,-Infinity,NaN];for(let i=0;i<Math.min(values.length,frames*4);i++)bits===32?data.writeFloatLE(values[i],i*4):data.writeDoubleLE(values[i],i*8);}
 const fmt=Buffer.alloc(extensible?40:16);fmt.writeUInt16LE(extensible?0xfffe:kind,0);fmt.writeUInt16LE(4,2);fmt.writeUInt32LE(48000,4);fmt.writeUInt32LE(48000*frameBytes,8);fmt.writeUInt16LE(frameBytes,12);fmt.writeUInt16LE(bits,14);
 if(extensible){fmt.writeUInt16LE(22,16);fmt.writeUInt16LE(bits,18);fmt.writeUInt32LE(kind,24);Buffer.from('00001000800000aa00389b71','hex').copy(fmt,28);}
 const chunk=(tag,payload)=>{const h=Buffer.alloc(8);h.write(tag);h.writeUInt32LE(payload.length,4);return Buffer.concat([h,payload,payload.length%2?Buffer.alloc(1):Buffer.alloc(0)]);};
 const extra=chunk('JUNK',Buffer.from('padding')),format=chunk('fmt ',fmt),dh=Buffer.alloc(8);dh.write('data');dh.writeUInt32LE(rf64?0xffffffff:data.length,4);
 const base=Buffer.alloc(12);base.write(rf64?'RF64':'RIFF');base.write('WAVE',8);let ds=Buffer.alloc(0);
 const length=12+(rf64?36:0)+extra.length+format.length+8+data.length;base.writeUInt32LE(rf64?0xffffffff:length-8,4);
 if(rf64){const payload=Buffer.alloc(28);payload.writeBigUInt64LE(BigInt(length-8),0);payload.writeBigUInt64LE(BigInt(data.length),8);payload.writeBigUInt64LE(BigInt(frames),16);ds=chunk('ds64',payload);}
 const bytes=Buffer.concat([base,ds,extra,format,dh,data]),file=new Blob([bytes]);file.name=`fixture_${kind}_${bits}.wav`;return {file,data,frameBytes,frames,kind,bits};
}
function inspect(bytes){let pos=12,fmt,data;while(pos+8<=bytes.length){const size=bytes.readUInt32LE(pos+4),tag=bytes.toString('ascii',pos,pos+4);if(tag==='fmt ')fmt=bytes.subarray(pos+8,pos+8+size);if(tag==='data'){data=bytes.subarray(pos+8,pos+8+size);break;}pos+=8+size+(size%2);}assert(fmt&&data);return {fmt,data};}
async function splitFixture(fixture){
 const meta=await bridgeContext.runtime.parse(fixture.file);
 // B-format settings are intentionally invalid: split must ignore them.
 const settings={operation:'split',gain_db:NaN,capsule_order:[4,4,4,4],orientation:'none',yaw:999,format:'none',output_layout:'mono',clamp:true};
 const job=await bridgeContext.runtime.api('/api/jobs','POST',{recordings:[{id:'fixture',name:'fixture',files:[meta.id]}],settings});
 const request=workers.at(-1).message;messages.length=0;await workerContext.self.onmessage({data:request});
 const failures=messages.filter(m=>['fatal','error'].includes(m.type));assert.equal(failures.length,0,JSON.stringify(failures));
 const result=messages.find(m=>m.type==='complete');assert(result);assert.equal(result.operation,'split');assert.equal(result.downloads.length,2);assert.equal(result.analysis,undefined);assert.equal(result.preview_audio,undefined);
 for(let pair=0;pair<2;pair++){
  const bytes=Buffer.from(await result.downloads[pair].blob.arrayBuffer()),{fmt,data}=inspect(bytes),pairBytes=fixture.frameBytes/2;
  assert.equal(fmt.readUInt16LE(0),fixture.kind);assert.equal(fmt.readUInt16LE(2),2);assert.equal(fmt.readUInt32LE(4),48000);assert.equal(fmt.readUInt16LE(14),fixture.bits);assert.equal(data.length,fixture.frames*pairBytes);
  const expected=Buffer.alloc(data.length);for(let f=0;f<fixture.frames;f++)fixture.data.copy(expected,f*pairBytes,f*fixture.frameBytes+pair*pairBytes,f*fixture.frameBytes+(pair+1)*pairBytes);assert(data.equals(expected),'Sample bytes changed');assert(result.downloads[pair].name.includes(`ch${pair*2+1}-${pair*2+2}`));
 }
 assert(messages.some(m=>m.type==='progress'&&m.progress===1)||fixture.frames===0);
 // Exercise the bridge's completion and batch ZIP path with split results.
 workers.at(-1).onmessage({data:result});workers.at(-1).onmessage({data:messages.find(m=>m.type==='finished')});assert.equal(job.completed,1);assert.equal(job.failed,0);assert((await bridgeContext.runtime.zip(job.id)).size>0);
}
(async()=>{
 for(const [kind,bits] of [[1,16],[1,24],[1,32],[3,32],[3,64]])for(const options of [{},{extensible:true},{rf64:true}])await splitFixture(makeFixture(kind,bits,17,options));
 await splitFixture(makeFixture(1,24,65539)); // Cross the worker's read-chunk boundary.
 await splitFixture(makeFixture(3,64,0));
 const stereo=makeFixture(3,32,4),meta=await bridgeContext.runtime.parse(stereo.file);
 const fakeMeta={...meta,channels:2};messages.length=0;await workerContext.self.onmessage({data:{type:'convert',jobid:'invalid',settings:{operation:'split'},recordings:[{file_id:'bad',sources:[fakeMeta]}]}});assert(messages.some(m=>m.type==='error'&&m.error.includes('4-channel')));
 await assert.rejects(bridgeContext.runtime.api('/api/jobs','POST',{settings:{operation:'invalid'},recordings:[]}),/Unknown operation/);
 await assert.rejects(bridgeContext.runtime.api('/api/jobs','POST',{settings:{operation:'split'},recordings:[{files:[meta.id,meta.id]}]}),/one 4-channel/);
 for(const [kind,bits] of [[1,24],[3,64]]){const frames=0x100000000,header=Buffer.from(vm.runInContext(`makeHeader(2,48000,${frames},${kind},${bits})`,workerContext));assert.equal(header.toString('ascii',0,4),'RF64');assert.equal(header.readBigUInt64LE(28),BigInt(frames*2*bits/8));assert.equal(header.readBigUInt64LE(20),BigInt(frames*2*bits/8+header.length-8));}
 console.log('Lossless split passed: PCM16/24/32, float32/64, extensible/RF64 input, chunk edges, empty audio, RF64 headers, batch ZIP and DSP bypass');
})().catch(error=>{console.error(error);process.exitCode=1;});
