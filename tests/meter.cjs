const fs=require('fs'),assert=require('assert');
(async()=>{
 const {instance}=await WebAssembly.instantiate(fs.readFileSync('src/standalone/ntsf1.wasm'),{env:{emscripten_notify_memory_growth(){}}});
 const e=instance.exports;e._initialize();const p=e.malloc(4800*16),r=e.malloc(40);
 for(const rate of [44100,48000]){
  const n=Math.round(rate/10),m=e.meter_create(rate,1);
  for(let k=0;k<100;k++){const a=new Float32Array(e.memory.buffer,p,n*4);a.fill(0);for(let i=0;i<n;i++)a[i*4]=.1*Math.sin(2*Math.PI*997*(k*n+i)/rate);e.meter_push(m,p,n);}
  e.meter_finish(m,r);const v=Array.from(new Float64Array(e.memory.buffer,r,5));assert(Math.abs(v[0]+23.01)<.03);assert(Math.abs(v[1])<.01);assert(Math.abs(v[2]+20)<.1);e.meter_destroy(m);
 }
 e.free(p);e.free(r);console.log('Sine loudness, range and true-peak estimate passed at 44.1/48 kHz');
})().catch(e=>{console.error(e);process.exitCode=1;});
