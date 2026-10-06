const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('src/standalone/runtime_worker.js','utf8');
const ctx={Math};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function rotationMatrix'),source.indexOf('function safeStem')),ctx);
for(const ambix of [true,false]){
 const pack=(x,y,z)=>new Float32Array(ambix?[.37,y,z,x]:[.37,x,y,z]);
 const unpack=a=>ambix?[a[3],a[1],a[2]]:[a[1],a[2],a[3]];
 for(const [settings,input,expected] of [[{yaw:90},[1,0,0],[0,1,0]],[{pitch:90},[1,0,0],[0,0,1]],[{roll:90},[0,1,0],[0,0,1]]]){
  const a=pack(...input),w=a[0];ctx.rotateAudio(a,1,ambix,ctx.rotationMatrix(settings));assert.equal(a[0],w);unpack(a).forEach((v,i)=>assert(Math.abs(v-expected[i])<1e-6));
 }
 for(let k=0;k<100;k++){
  const a=pack(Math.sin(k),Math.cos(k),.2),v=unpack(a),energy=v.reduce((s,x)=>s+x*x,0),w=a[0];
  ctx.rotateAudio(a,1,ambix,ctx.rotationMatrix({yaw:k*1.7,pitch:k*.8,roll:-k*1.3}));assert.equal(a[0],w);assert(Math.abs(unpack(a).reduce((s,x)=>s+x*x,0)-energy)<2e-7);
 }
}
console.log('Both formats: cardinal rotations, unchanged W and directional energy passed');
