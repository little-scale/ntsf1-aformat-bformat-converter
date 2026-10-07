/* Frequency moments of directional spectral energy, on a log-frequency axis. */
(()=>{
 function moments(covariance,bands){const out=[new Float64Array(16),new Float64Array(16),new Float64Array(16)],lo=Math.log(20),span=Math.log(bands[bands.length-1]*Math.sqrt(bands[1]/bands[0]))-lo;for(let b=0;b<bands.length;b++){const f=Math.max(0,Math.min(1,(Math.log(bands[b])-lo)/span));for(let i=0;i<16;i++){const e=covariance[b*16+i];out[0][i]+=e;out[1][i]+=e*f;out[2][i]+=e*f*f;}}return out;}
 function sample(m,a){const q=m.map(c=>{let value=0;for(let i=0;i<4;i++)for(let j=0;j<4;j++)value+=a[i]*c[i*4+j]*a[j];return value;});const energy=Math.max(0,q[0]);if(energy<=1e-30)return {energy:0,hue:0,saturation:0};const mean=Math.max(0,Math.min(1,q[1]/energy)),variance=Math.max(0,q[2]/energy-mean*mean);return {energy,hue:270*mean,saturation:Math.max(.1,Math.min(1,1-Math.sqrt(variance)/.3))};}
 function rgb(hue,saturation,level){const chroma=level*saturation,h=hue/60,x=chroma*(1-Math.abs(h%2-1)),base=level-chroma;const c=h<1?[chroma,x,0]:h<2?[x,chroma,0]:h<3?[0,chroma,x]:h<4?[0,x,chroma]:h<5?[x,0,chroma]:[chroma,0,x];return c.map(v=>Math.round(255*(v+base)));}
 window.FrequencyColour={moments,sample,rgb};
})();
