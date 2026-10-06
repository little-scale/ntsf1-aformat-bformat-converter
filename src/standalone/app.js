'use strict';
const $=s=>document.querySelector(s);
const layouts={quad:{count:1,channels:4,hint:'Each four-channel file becomes one recording.'},stereo:{count:2,channels:2,hint:'Two stereo files per recording. First pair → channels 1–2; second → 3–4.'},mono:{count:4,channels:1,hint:'Four mono files per recording. Arrange them in source-channel order.'}};
let mode='quad',groups=[],token='',activeJob=null,lastJob=null,pollTimer=null,uploads=0,connected=false;
const openReports=new Set();
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixed=(v,d=1)=>v===null||v===undefined?'—':Number(v).toFixed(d);
const db=v=>v===null||v===undefined?'−∞':Number(v).toFixed(1);
const duration=s=>`${Math.floor(s/60)}:${(s%60).toFixed(1).padStart(4,'0')}`;
function notify(text){$('#notice').textContent=text;$('#notice').hidden=!text;}
for(let c=1;c<=4;c++){const select=$(`#capsule-${c}`);for(let v=1;v<=4;v++){const option=document.createElement('option');option.value=v;option.textContent=`Channel ${v}`;select.append(option);}select.value=c;}
function config(){return {format:$('#format').value,gain_db:Number($('#gain').value),yaw:Number($('#yaw').value),pitch:Number($('#pitch').value),roll:Number($('#roll').value),orientation:$('#orientation').value,capsule_order:[1,2,3,4].map(c=>Number($(`#capsule-${c}`).value)),clamp:$('#clamp').checked,output_layout:$('#output-layout').value};}
function validation(g){
 if(g.members.length!==layouts[g.mode].count)return 'waiting';
 if(g.members.some(m=>m.error))return 'error';
 if(g.members.some(m=>!m.meta))return 'uploading';
 const first=g.members[0].meta;
 if(g.members.some(m=>m.meta.channels!==layouts[g.mode].channels)){g.validationError=`This layout needs ${layouts[g.mode].channels}-channel files.`;return 'error';}
 if(g.members.some(m=>m.meta.sample_rate!==first.sample_rate||m.meta.frames!==first.frames)){g.validationError='Split files must have identical sample rates and lengths.';return 'error';}
 g.validationError=null;return 'ready';
}
function ready(g){return validation(g)==='ready';}
function controls(){
 const busy=!!activeJob;
 document.querySelectorAll('.output-settings input,.output-settings select,.output-settings button,.output-rotation input,.output-rotation select,.output-rotation button,.microphone input,.microphone select,.microphone button,.modes button').forEach(e=>e.disabled=busy);
 $('#drop-zone').setAttribute('aria-disabled',String(busy));$('#clear').disabled=busy||!groups.length;
 const n=groups.filter(ready).length;
 $('#convert').disabled=busy||uploads>0||n===0||!connected;$('#convert').textContent=busy?'Converting…':`Convert${n?' '+n+(n===1?' recording':' recordings'):''}`;
 $('#cancel').hidden=!busy;$('#cancel').disabled=!busy;$('#count').textContent=groups.length;
 $('#download-all').hidden=!lastJob||activeJob!==null;
 if(lastJob)$('#download-all').href='#';window.SpatialSphere?.refresh(groups,busy);window.BinauralPreview?.refresh(groups,busy);
}
function metrics(a){return `<div class="metrics"><div><span class="metric-label">Max sample peak</span><span class="metric-value">${db(a.max_sample_peak_dbfs)}</span><span class="metric-unit">dBFS</span></div><div><span class="metric-label">Component RMS</span><span class="metric-value">${db(a.combined_component_rms_dbfs)}</span><span class="metric-unit">dBFS</span></div><div><span class="metric-label">W mono loudness</span><span class="metric-value">${fixed(a.w_mono_loudness.integrated_lufs)}</span><span class="metric-unit">LUFS</span></div></div>`;}
function analysisHTML(a,id){
 const labels=a.channel_labels;
 const channelRows=a.channels.map(c=>`<tr><td>${escape(c.name)}</td><td>${db(c.rms_dbfs)}</td><td>${db(c.peak_dbfs)}</td><td>${fixed(c.crest_db)}</td><td>${c.above_full_scale.toLocaleString()}</td></tr>`).join('');
 const rows=a.correlation.map((r,i)=>`<tr><td>${escape(labels[i])}</td>${r.map(v=>`<td>${fixed(v,2)}</td>`).join('')}</tr>`).join('');
 const d=a.directionality;let arrow='';
 if(d.azimuth_degrees!==null){const angle=d.azimuth_degrees*Math.PI/180,x=55-34*Math.sin(angle),y=55-34*Math.cos(angle);arrow=`<line x1="55" y1="55" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke="currentColor" stroke-width="2"/><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3" fill="currentColor"/>`;}
 return `<details class="analysis" data-report="${id}" ${openReports.has(id)?'open':''}><summary>Output analysis</summary><h3>Levels by channel</h3><table><thead><tr><th>Channel</th><th>RMS dBFS</th><th>Peak dBFS</th><th>Crest dB</th><th>Samples above 0 dBFS</th></tr></thead><tbody>${channelRows}</tbody></table><h3>W-channel loudness</h3><p class="hint">Integrated: ${fixed(a.w_mono_loudness.integrated_lufs)} LUFS · Range: ${fixed(a.w_mono_loudness.range_lu)} LU · True peak: ${fixed(a.w_mono_loudness.true_peak_dbtp)} dBTP</p><p class="hint">${escape(a.w_mono_loudness.note)}</p><h3>Channel correlation</h3><table><thead><tr><th></th>${labels.map(l=>`<th>${escape(l)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><h3>Overall directional bias</h3><div class="direction"><svg viewBox="0 0 110 110" role="img" aria-label="Overall directional estimate"><circle cx="55" cy="55" r="35" fill="none" stroke="currentColor"/><line x1="55" y1="20" x2="55" y2="90" stroke="#444"/><line x1="20" y1="55" x2="90" y2="55" stroke="#444"/><g font-size="9" fill="currentColor" text-anchor="middle"><text x="55" y="11">Front</text><text x="55" y="105">Back</text><text x="8" y="58">L</text><text x="102" y="58">R</text></g>${arrow}</svg><div class="direction-values">Azimuth: ${fixed(d.azimuth_degrees)}°<br>Elevation: ${fixed(d.elevation_degrees)}°<br>Directional concentration: ${d.concentration===null?'—':(d.concentration*100).toFixed(0)+'%'}<br>Diffuse estimate: ${d.diffuseness_estimate===null?'—':(d.diffuseness_estimate*100).toFixed(0)+'%'}</div></div><p class="hint">A whole-recording estimate. Moving or opposing sources can cancel. Positive azimuth is left; positive elevation is up.</p></details>`;
}
function render(){
 $('#recordings').innerHTML=groups.length?groups.map(g=>{
  const state=g.result?.status||validation(g);const missing=layouts[g.mode].count-g.members.length;
  const status=g.result?.stage||(state==='waiting'?`Needs ${missing} more ${missing===1?'file':'files'}`:state==='ready'?'Ready':state==='error'?'Check inputs':'Reading files');
  const meta=g.members.find(m=>m.meta)?.meta;const summary=meta?`${(meta.sample_rate/1000).toFixed(1)} kHz · ${duration(meta.duration_seconds)} · ${g.mode==='quad'?'4-channel input':g.mode==='stereo'?'2 stereo inputs':'4 mono inputs'}`:'';
  const memberHTML=g.members.map((m,i)=>{const label=g.mode==='quad'?'Ch 1–4':g.mode==='stereo'?`Ch ${i*2+1}–${i*2+2}`:`Ch ${i+1}`;return `<div class="member"><span class="member-label">${label}</span><span class="member-name" title="${escape(m.name)}">${escape(m.name)}${m.meta?'':m.error?'':' · '+Math.round((m.progress||0)*100)+'%'}</span><span class="member-controls">${g.mode!=='quad'?`<button type="button" data-action="up" data-group="${g.id}" data-index="${i}" aria-label="Move ${escape(m.name)} up" ${i===0||activeJob?'disabled':''}>↑</button><button type="button" data-action="down" data-group="${g.id}" data-index="${i}" aria-label="Move ${escape(m.name)} down" ${i===g.members.length-1||activeJob?'disabled':''}>↓</button>`:''}</span></div>`;}).join('');
  const error=g.validationError||g.members.find(m=>m.error)?.error||g.result?.error;
  const a=g.result?.analysis;const downloads=g.result?.downloads||[];
  return `<article class="recording" data-id="${g.id}"><div class="recording-top"><span class="recording-name">${escape(g.name)}</span><span class="status">${escape(status)}${g.result?.status==='processing'?' · '+Math.round(g.result.progress*100)+'%':''}</span></div><p class="recording-summary">${escape(summary)}</p><div class="members">${memberHTML}</div>${error?`<p class="error">${escape(error)}</p>`:''}${g.result&&['processing','queued'].includes(g.result.status)?`<progress max="1" value="${g.result.progress}" aria-label="Conversion progress"></progress>`:''}<div class="recording-footer"><span class="missing">${missing>0?'Add '+missing+' more '+(missing===1?'file':'files')+' to this recording.':''}</span><button class="small" type="button" data-action="remove" data-group="${g.id}" ${activeJob?'disabled':''}>Remove</button></div>${downloads.length?`<div class="downloads">${downloads.map(d=>`<a class="button" href="${escape(d.url)}" download>${escape(d.label)}</a>`).join('')}</div>`:''}</article>`;
 }).join(''):'<div class="empty">No recordings added.</div>';
 const analyzed=groups.filter(g=>g.result?.analysis);$('#analysis-results').innerHTML=analyzed.length?analyzed.map(g=>`<article class="analysis-recording"><h3>${escape(g.name)}</h3>${metrics(g.result.analysis)}${analysisHTML(g.result.analysis,g.id)}</article>`).join(''):'<p class="hint">Convert a recording to see its output analysis.</p>';
 document.querySelectorAll('details[data-report]').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)openReports.add(d.dataset.report);else openReports.delete(d.dataset.report);}));
 controls();
}
async function api(path,method='GET',body){return BrowserRuntime.api(path,method,body);}
async function upload(file,onprogress){onprogress(0);const metadata=await BrowserRuntime.parse(file);onprogress(1);return metadata;}
async function addFiles(files){
 if(activeJob||!connected)return;notify('');
 files=Array.from(files).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
 for(const file of files){
  if(!/\.wav(?:e)?$/i.test(file.name)){notify('Choose WAV files.');continue;}
  let g=groups.find(g=>g.mode===mode&&g.members.length<layouts[mode].count&&!g.result);
  if(!g){g={id:crypto.randomUUID(),name:file.name.replace(/\.wave?$/i,'').replace(/[_ -](?:ch)?(?:1-2|1)$/i,''),mode,members:[]};groups.push(g);}
  const member={name:file.name,progress:0};g.members.push(member);uploads++;render();
  try{member.meta=await upload(file,p=>{member.progress=p;render();});}
  catch(e){member.error=e.message;}
  finally{uploads--;render();}
 }
 $('#file-picker').value='';
}
$('#file-picker').addEventListener('change',e=>addFiles(e.target.files));
$('#drop-zone').addEventListener('click',()=>{if(!activeJob&&connected)$('#file-picker').click();});
$('#drop-zone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!activeJob&&connected)$('#file-picker').click();}});
$('#drop-zone').addEventListener('dragover',e=>{e.preventDefault();if(!activeJob)$('#drop-zone').classList.add('dragging');});
$('#drop-zone').addEventListener('dragleave',()=>$('#drop-zone').classList.remove('dragging'));
$('#drop-zone').addEventListener('drop',e=>{e.preventDefault();$('#drop-zone').classList.remove('dragging');addFiles(e.dataTransfer.files);});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$('#layout-hint').textContent=layouts[mode].hint;}));
$('#output-layout').addEventListener('change',()=>{$('#output-layout-hint').textContent={quad:'All four B-format components in one file.',stereo:'Channel pairs 1–2 and 3–4. No stereo decoding.',mono:'One file per B-format component, labelled W, X, Y or Z.'}[$('#output-layout').value];});
$('#rotation-reset').addEventListener('click',()=>['yaw','pitch','roll'].forEach(k=>$('#'+k).value='0'));
$('#gain-reset').addEventListener('click',()=>$('#gain').value='0');
$('#order-reset').addEventListener('click',()=>[1,2,3,4].forEach(i=>$(`#capsule-${i}`).value=i));
$('#recordings').addEventListener('click',async e=>{
 const button=e.target.closest('button[data-action]');if(!button||activeJob)return;
 const g=groups.find(g=>g.id===button.dataset.group);if(!g)return;
 const index=Number(button.dataset.index);
 if(button.dataset.action==='up'||button.dataset.action==='down'){
  const other=index+(button.dataset.action==='up'?-1:1);[g.members[index],g.members[other]]=[g.members[other],g.members[index]];g.result=null;render();
 }else if(button.dataset.action==='remove'){
  if(uploads)return;
  groups=groups.filter(x=>x!==g);render();
  for(const m of g.members)if(m.meta)try{await api('/api/files/'+m.meta.id,'DELETE');}catch(e){notify(e.message);}
 }
});
$('#clear').addEventListener('click',async()=>{if(activeJob||uploads)return;const old=groups;groups=[];render();for(const g of old)for(const m of g.members)if(m.meta)try{await api('/api/files/'+m.meta.id,'DELETE');}catch{};});
async function poll(){
 if(!activeJob)return;
 try{
  const job=await api('/api/jobs/'+activeJob);
  for(const item of job.items){const g=groups.find(g=>g.id===item.client_id);if(g)g.result=item;}
  if(['complete','canceled'].includes(job.status)){
   clearInterval(pollTimer);lastJob=job.completed?job.id:null;activeJob=null;
   $('#batch-status').textContent=job.status==='canceled'?'Conversion canceled.':`${job.completed} complete${job.failed?', '+job.failed+' failed':''}.`;
  }
  render();
 }catch(e){clearInterval(pollTimer);activeJob=null;connected=false;notify('Browser conversion failed. Reload this HTML file to restart.');render();}
}
$('#convert').addEventListener('click',async()=>{
 const cfg=config();if(new Set(cfg.capsule_order).size!==4){notify('Assign each source channel exactly once in Capsule order.');return;}
 if(!Number.isFinite(cfg.gain_db)||cfg.gain_db< -60||cfg.gain_db>24){notify('Output level must be between -60 and +24 dB.');return;}
 const recordings=groups.filter(ready).map(g=>({id:g.id,name:g.name,files:g.members.map(m=>m.meta.id)}));
 if(!recordings.length)return;notify('');
 try{const job=await api('/api/jobs','POST',{recordings,settings:cfg});activeJob=job.id;lastJob=null;$('#batch-status').textContent='Converting in your browser…';for(const item of job.items){const g=groups.find(g=>g.id===item.client_id);if(g)g.result=item;}render();pollTimer=setInterval(poll,700);poll();}
 catch(e){notify(e.message);}
});
$('#cancel').addEventListener('click',async()=>{if(!activeJob)return;try{await api('/api/jobs/'+activeJob+'/cancel','POST',{});$('#batch-status').textContent='Canceling…';}catch(e){notify(e.message);}});
(async()=>{try{const config=await api('/api/config');token=config.token;connected=true;render();}catch{notify('The browser converter could not start. WebAssembly and Web Workers must be supported.');render();}})();

$('#download-all').addEventListener('click',async event=>{
 event.preventDefault();if(!lastJob)return;const link=$('#download-all');const old=link.textContent;link.textContent='Preparing ZIP…';
 try{const blob=await BrowserRuntime.zip(lastJob),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='converted_files.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 catch(error){notify(error.message);}finally{link.textContent=old;}
});
