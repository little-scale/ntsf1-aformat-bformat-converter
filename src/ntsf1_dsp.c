/* Reconstructed SoundField by RODE 1.0.0 A-to-B DSP, not original source.
 * Build with -ffp-contract=off; floating-point grouping is intentional.
 * Four input channels: LFU, RFD, LBD, RBU. Output: FuMa or ACN/SN3D.
 */
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

/* Apple's Intel float math and ARM float math do not always round alike.
 * On ARM, double evaluation followed by float rounding is measurably closer
 * to the installed Intel plugin. This is verified, not assumed bit-identical.
 */
#if (defined(__arm64__) || defined(__aarch64__) || defined(__wasm__)) && !defined(RODE_NATIVE_FLOAT_MATH)
static float rode_sinf(float x){return (float)sin((double)x);}
static float rode_cosf(float x){return (float)cos((double)x);}
static float rode_atan2f(float y,float x){return (float)atan2((double)y,(double)x);}
static float rode_hypotf(float x,float y){return (float)hypot((double)x,(double)y);}
#define sinf rode_sinf
#define cosf rode_cosf
#define atan2f rode_atan2f
#define hypotf rode_hypotf
#endif

typedef struct {float r,i;} Cx;
typedef struct {
 int hop,n,span,offset,nb;
 float *window,*cosine;int *reverse;
 int edges[64];float steps[64];float beta;
 float *previous,*temporal,*oldenergy,*newenergy,*q;
 Cx spatial[3][64],gains[64];
 float *input[4],*output[4],*spectra[4],*scratch;
 float neutral_mix;int neutral_api;int orientation;
} DSP;
static float norm(Cx c){return sqrtf(c.r*c.r+c.i*c.i);}
static Cx times(Cx a,Cx b){return (Cx){a.r*b.r-a.i*b.i,a.i*b.r+a.r*b.i};}
static Cx cross(Cx a,Cx b){return (Cx){a.r*b.r+a.i*b.i,a.i*b.r-a.r*b.i};}
static Cx get(float*s,int k,int n){return k==0?(Cx){s[0],0}:k==n/2?(Cx){s[1],0}:(Cx){s[2*k],s[2*k+1]};}
static void put(float*s,int k,int n,Cx c){if(!k)s[0]=c.r;else if(k==n/2)s[1]=c.r;else{s[2*k]=c.r;s[2*k+1]=c.i;}}
static void butterflies(float*d,int n,float*table,int inverse){
 int m=n/2,q=n/4;
 for(int k=0;k<m;k+=2){Cx a={d[2*k],d[2*k+1]},b={d[2*k+2],d[2*k+3]};d[2*k]=a.r+b.r;d[2*k+1]=a.i+b.i;d[2*k+2]=a.r-b.r;d[2*k+3]=a.i-b.i;}
 for(int half=2,stride=q;half<m;half*=2,stride/=2){
  for(int start=0;start<m;start+=half*2){
   Cx a={d[2*start],d[2*start+1]},b={d[2*(start+half)],d[2*(start+half)+1]};
   d[2*start]=a.r+b.r;d[2*start+1]=a.i+b.i;d[2*(start+half)]=a.r-b.r;d[2*(start+half)+1]=a.i-b.i;
   for(int j=1;j<half;j++){
    int lo=start+j,hi=lo+half;float co=table[j*stride],si=table[j*stride+q];
    Cx b={d[2*hi],d[2*hi+1]},a={d[2*lo],d[2*lo+1]};
    float r=inverse?b.i*si+b.r*co:co*b.r-b.i*si;
    float im=inverse?b.i*co-b.r*si:b.r*si+co*b.i;
    d[2*lo]=a.r+r;d[2*lo+1]=a.i+im;d[2*hi]=a.r-r;d[2*hi+1]=a.i-im;
   }
  }
 }
}
void rode_fft(DSP*s,const float*x,float*d){
 int n=s->n,m=n/2,q=n/4;
 for(int k=0;k<m;k++){int j=s->reverse[k];d[2*k]=x[j];d[2*k+1]=x[j+1];}
 butterflies(d,n,s->cosine,0);
 float r=d[0],im=d[1];d[0]=r+im;d[1]=r-im;d[2*q+1]=-d[2*q+1];
 for(int k=1;k<q;k++){
  int j=m-k;float diff=d[2*j]-d[2*k],sumim=d[2*k+1]+d[2*j+1];
  float co=s->cosine[k],si=s->cosine[k+q];
  float tr=co*sumim-diff*si,ti=sumim*si+diff*co;
  float di=d[2*k+1]-d[2*j+1],sr=d[2*j]+d[2*k];
  d[2*k]=(sr+tr)*.5f;d[2*k+1]=(ti+di)*.5f;
  d[2*j]=(sr-tr)*.5f;d[2*j+1]=(di-ti)*-.5f;
 }
}
void rode_ifft(DSP*s,const float*d,float*x){
 int n=s->n,m=n/2,q=n/4;float*table=s->cosine;
 x[0]=d[0]+d[1];x[1]=d[0]-d[1];int j=s->reverse[q];x[j]=d[2*q]+d[2*q];x[j+1]=d[2*q+1]*-2.f;
 for(int k=1;k<q;k++){
  int a=s->reverse[k],b=s->reverse[m-k];float sr=d[2*k]+d[2*(m-k)],di=d[2*k+1]-d[2*(m-k)+1];
  float dr=d[2*k]-d[2*(m-k)],si=d[2*k+1]+d[2*(m-k)+1];
  float tr=si*table[k]-dr*table[k+q],ti=si*table[k+q]+dr*table[k];
  x[a]=sr-tr;x[a+1]=di+ti;x[b]=tr+sr;x[b+1]=ti-di;
 }
 butterflies(x,n,table,1);float scale=1.f/n;for(int k=0;k<n;k++)x[k]*=scale;
}
static void band_gains(DSP*s,float*x,Cx*g){
 int b,cursor,edge;
 if(s->edges[0]==1){
  b=0;do{Cx v=get(x,b,s->n);if(!b)v.r*=g[b].r;else v=times(v,g[b]);put(x,b,s->n,v);b++;if(b>=s->nb)break;}while(s->edges[b]-s->edges[b-1]==1);
  edge=s->edges[b-1];cursor=edge;
 }else{b=1;edge=s->edges[0];cursor=edge/2;x[0]*=g[0].r;for(int k=1;k<cursor;k++)put(x,k,s->n,times(get(x,k,s->n),g[0]));}
 for(;b<s->nb;b++){
  int next=s->edges[b],center=(edge+next)/2;Cx v=g[b-1];float dr=g[b].r-v.r,di=g[b].i-v.i;
  for(int k=cursor;k<center;k++){v.r=v.r+s->steps[b]*dr;v.i=v.i+s->steps[b]*di;put(x,k,s->n,times(get(x,k,s->n),v));}
  edge=next;cursor=center;
 }
 for(int k=cursor;k<s->n/2;k++)put(x,k,s->n,times(get(x,k,s->n),g[s->nb-1]));x[1]*=g[s->nb-1].r;
}
void rode_spectral(DSP*s,float**a){
 float beta=s->beta,rem=1.f-beta;int n=s->n;
 for(int b=0;b<s->nb;b++){
  float ep=0,ec=0,sum=0;int start=b?s->edges[b-1]:0,end=s->edges[b]+(b==s->nb-1);
  for(int k=start;k<end;k++){
   Cx p=get(s->previous,k,n),v=get(a[0],k,n),c=cross(p,v),old=get(s->temporal,k,n);
   ep=ep+(p.r*p.r+p.i*p.i);ec=ec+(v.r*v.r+v.i*v.i);
   Cx t={c.r*beta+old.r*rem,c.i*beta+old.i*rem};put(s->temporal,k,n,t);sum=sum+hypotf(t.r,t.i);
  }
  s->oldenergy[b]=ep*beta+s->oldenergy[b]*rem;s->newenergy[b]=ec*beta+s->newenergy[b]*rem;
  s->q[b]=(sum+1e-20f)/(fmaxf(s->oldenergy[b],s->newenergy[b])+1e-20f);
 }
 memcpy(s->previous,a[0],n*sizeof(float));
 for(int ch=1;ch<4;ch++){
  for(int b=0;b<s->nb;b++){
   Cx c={0,0};int start=b?s->edges[b-1]:0,end=s->edges[b]+(b==s->nb-1);
   for(int k=start;k<end;k++){Cx v=cross(get(a[0],k,n),get(a[ch],k,n));c.r+=v.r;c.i+=v.i;}
   Cx old=s->spatial[ch-1][b];float cn=norm(c),on=norm(old);
   float weight=fminf(1.f,fmaxf(0.f,fabsf(cn-on)/fmaxf(on,cn+1e-20f))),rem=1.f-weight;
   Cx sm={c.r*weight+old.r*rem,c.i*weight+old.i*rem};s->spatial[ch-1][b]=sm;
   float phi=atan2f(sm.i,sm.r),gate=(float)pow((double)s->q[b],3.0);float angle=(1.f-gate)*phi;
   s->gains[b]=(Cx){cosf(angle),sinf(angle)};
  }
  band_gains(s,a[ch],s->gains);
 }
 static const float mat[4][4]={{.454545468f,.454545468f,.454545468f,.454545468f},{1.11340451f,1.11340451f,-1.11340451f,-1.11340451f},{1.11340451f,-1.11340451f,1.11340451f,-1.11340451f},{1.11340451f,-1.11340451f,-1.11340451f,1.11340451f}};
 for(int k=0;k<n;k++){
  float v[4]={a[0][k],a[1][k],a[2][k],a[3][k]};for(int c=0;c<4;c++){
   float t0=mat[c][0]*v[0],t1=mat[c][1]*v[1],t2=mat[c][2]*v[2],t3=mat[c][3]*v[3];
   a[c][k]=k<2?((t0+t1)+t2)+t3:(t0+t1)+(t2+t3);
  }
 }
}
void rode_destroy(DSP*s);
DSP*rode_create(int sr){
 if(sr<11025||sr>192000)return NULL;DSP*s=calloc(1,sizeof(*s));if(!s)return NULL;
 s->hop=(int)((float)sr*10.f*.001f);s->span=s->hop*2;s->n=1;while(s->n<s->span)s->n*=2;s->offset=(s->n-s->span)/2;
 int n=s->n,q=n/4;s->window=calloc(s->span/2,sizeof(float));s->cosine=calloc(n*5/4,sizeof(float));s->reverse=calloc(n,sizeof(int));
 if(!s->window||!s->cosine||!s->reverse){rode_destroy(s);return NULL;}
 for(int k=0;k<s->span/2;k++)s->window[k]=sinf((((float)k+.5f)*3.1415927410125732f)/(float)s->span);
 for(int k=0;k<n*5/4;k++)s->cosine[k]=cosf(((float)k*6.2831854820251465f)/(float)n);
 int bits=0;for(int k=n/2;k>1;k/=2)bits++;
 for(int k=0;k<n/2;k++){int r=0;for(int b=0;b<bits;b++)r=(r<<1)|((k>>b)&1);s->reverse[k]=r*2;}
 float erb=1.f;int last=0,width=0;
 do{
  float hz=((float)pow(10.,(double)(erb/21.399999618530273f))-1.f)/.004370000213384628f;
  int j=0,next;do{j++;next=last+j;}while(j<width||((float)next*(float)sr)/(float)n<hz);
  width=j;if(s->nb>=64){rode_destroy(s);return NULL;}s->edges[s->nb++]=next<n/2?next:n/2;last=next;erb+=1.f;
 }while(last<n/2);
 int b=0,edge=1,cursor=1;
 do{s->steps[b++]=1.f;if(b>=s->nb)break;int next=s->edges[b],w=next-edge;edge=next;if(w!=1)break;}while(1);
 edge=s->edges[b-1];cursor=edge;
 for(;b<s->nb;b++){int next=s->edges[b],center=(edge+next)/2;s->steps[b]=1.f/(float)(center-cursor);edge=next;cursor=center;}
 s->beta=fminf(1.f,(((float)s->hop*1000.f)/(float)sr)/30.f);
 s->previous=calloc(n,sizeof(float));s->temporal=calloc(n,sizeof(float));s->oldenergy=calloc(64,sizeof(float));s->newenergy=calloc(64,sizeof(float));s->q=calloc(64,sizeof(float));s->scratch=calloc(n,sizeof(float));
 for(int c=0;c<4;c++){s->input[c]=calloc(s->span,sizeof(float));s->output[c]=calloc(s->span,sizeof(float));s->spectra[c]=calloc(n,sizeof(float));}
 if(!s->previous||!s->temporal||!s->oldenergy||!s->newenergy||!s->q||!s->scratch){rode_destroy(s);return NULL;}
 for(int c=0;c<4;c++)if(!s->input[c]||!s->output[c]||!s->spectra[c]){rode_destroy(s);return NULL;}
 (void)q;return s;
}
/* The neutral plugin API retains its delay crossfade even with EQ bypassed. */
void rode_match_neutral_api(DSP*s,int enabled){s->neutral_api=enabled!=0;}
/* flags: 1=end-fire, 2=upside-down; order matches the original plugin. */
void rode_set_orientation(DSP*s,int flags){s->orientation=flags&3;}
int rode_hop(DSP*s){return s->hop;}
int rode_fft_size(DSP*s){return s->n;}
void rode_window(DSP*s,float*dest){memcpy(dest,s->window,s->span/2*sizeof(float));}
void rode_process(DSP*s,const float*input,float*output,int ambix){
 int h=s->hop,n=s->n;
 if(s->neutral_api)s->neutral_mix=s->neutral_mix*.8999999761581421f+.10000000149011612f;
 for(int c=0;c<4;c++){
  memmove(s->input[c],s->input[c]+h,h*sizeof(float));for(int k=0;k<h;k++)s->input[c][h+k]=s->neutral_api?((1.f-s->neutral_mix)*input[4*k+c]+s->neutral_mix*input[4*k+c]):input[4*k+c];
  memset(s->scratch,0,n*sizeof(float));for(int k=0;k<s->span;k++){float w=s->window[k<h?k:s->span-1-k];s->scratch[s->offset+k]=s->input[c][k]*w;}
  rode_fft(s,s->scratch,s->spectra[c]);
 }
 rode_spectral(s,s->spectra);
 if(s->orientation){
  for(int k=0;k<n;k++){
   if(s->orientation&1){float x=s->spectra[1][k];s->spectra[1][k]=s->spectra[3][k];s->spectra[3][k]=-x;}
   if(s->orientation&2){s->spectra[2][k]=-s->spectra[2][k];s->spectra[3][k]=-s->spectra[3][k];}
  }
 }
 /* The plugin applies AmbiX W normalization before the inverse FFT. */
 if(ambix)for(int k=0;k<n;k++)s->spectra[0][k]*=1.4142135381698608f;
 for(int c=0;c<4;c++){
  rode_ifft(s,s->spectra[c],s->scratch);
  for(int k=0;k<s->span;k++){float w=s->window[k<h?k:s->span-1-k];float v=s->scratch[s->offset+k]*w;if(k<h)s->output[c][k]+=v;else s->output[c][k]=v;}
 }
 for(int k=0;k<h;k++){
  if(ambix){output[4*k]=s->output[0][k];output[4*k+1]=s->output[2][k];output[4*k+2]=s->output[3][k];output[4*k+3]=s->output[1][k];}
  else for(int c=0;c<4;c++)output[4*k+c]=s->output[c][k];
 }
 for(int c=0;c<4;c++){memmove(s->output[c],s->output[c]+h,h*sizeof(float));memset(s->output[c]+h,0,h*sizeof(float));}
}
void rode_destroy(DSP*s){if(!s)return;free(s->window);free(s->cosine);free(s->reverse);free(s->previous);free(s->temporal);free(s->oldenergy);free(s->newenergy);free(s->q);free(s->scratch);for(int c=0;c<4;c++){free(s->input[c]);free(s->output[c]);free(s->spectra[c]);}free(s);}

/* Read-only spectral covariance for the energy sphere; never alters audio. */
void rode_frequency_covariance(DSP*s,int rate,int ambix,double*out){
 memset(out,0,8*16*sizeof(double));double top=fmin(20000.,rate*.5),range=log(top/20.);
 for(int k=0;k<=s->n/2;k++){
  double hz=(double)k*rate/s->n;int band=hz<=20.?0:(int)(log(hz/20.)/range*8.);if(band>7)band=7;
  Cx v[4];for(int c=0;c<4;c++)v[c]=get(s->spectra[c],k,s->n);
  double scale[4]={ambix?1.:1.4142135623730951,1.,1.,1.};double weight=(k==0||k==s->n/2)?1.:2.;
  for(int a=0;a<4;a++)for(int b=0;b<4;b++)out[band*16+a*4+b]+=weight*scale[a]*scale[b]*((double)v[a].r*v[b].r+(double)v[a].i*v[b].i)/((double)s->n*s->n);
 }
}
