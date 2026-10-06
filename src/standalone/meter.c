/* W-mono BS.1770 integrated loudness, descriptive range and 4x true-peak estimate.
 * Filter/gating: ITU-R BS.1770-4; other-rate K coefficients use bilinear
 * equivalents of the specified 48 kHz response. True-peak FIR: Annex 2.
 * Metering is read-only and never changes the conversion samples.
 */
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef struct{double b0,b1,b2,a1,a2,z1,z2;} Biquad;
typedef struct{
 int rate,block,hop,shortblock,ambix;uint64_t count;
 Biquad shelf,hp;double*ring,sum400,sum3;
 double*blocks,*shorts;size_t nb,ns,bc,sc;
 double history[12],peak;int position;
} Meter;
static double filter(Biquad*b,double x){double y=b->b0*x+b->z1;b->z1=b->b1*x-b->a1*y+b->z2;b->z2=b->b2*x-b->a2*y;return y;}
static void append(double**data,size_t*n,size_t*cap,double x){if(*n>=*cap){size_t c=*cap?*cap*2:512;double*p=realloc(*data,c*sizeof(double));if(!p)return;*data=p;*cap=c;}(*data)[(*n)++]=x;}
static const double fir[4][12]={
 {0.001708984375,0.010986328125,-0.0196533203125,0.033203125,-0.0594482421875,0.1373291015625,0.97216796875,-0.102294921875,0.047607421875,-0.026611328125,0.014892578125,-0.00830078125},
 {-0.0291748046875,0.029296875,-0.0517578125,0.089111328125,-0.16650390625,0.465087890625,0.77978515625,-0.2003173828125,0.1015625,-0.0582275390625,0.0330810546875,-0.0189208984375},
 {-0.0189208984375,0.0330810546875,-0.0582275390625,0.1015625,-0.2003173828125,0.77978515625,0.465087890625,-0.16650390625,0.089111328125,-0.0517578125,0.029296875,-0.0291748046875},
 {-0.00830078125,0.014892578125,-0.026611328125,0.047607421875,-0.102294921875,0.97216796875,0.1373291015625,-0.0594482421875,0.033203125,-0.0196533203125,0.010986328125,0.001708984375}
};
static void truepeak(Meter*m,double w){m->history[m->position]=w;m->peak=fmax(m->peak,fabs(w));for(int p=0;p<4;p++){double v=0;for(int j=0;j<12;j++)v+=fir[p][j]*m->history[(m->position-j+12)%12];m->peak=fmax(m->peak,fabs(v));}m->position=(m->position+1)%12;}
void*meter_create(int rate,int ambix){
 Meter*m=calloc(1,sizeof(*m));if(!m)return NULL;m->rate=rate;m->ambix=ambix;m->block=(int)floor(rate*.4+.5);m->hop=(int)floor(rate*.1+.5);m->shortblock=rate*3;m->ring=calloc(m->shortblock,sizeof(double));if(!m->ring){free(m);return NULL;}
 double k=tan(3.14159265358979323846*1681.974450955533/rate),q=.7071752369554196,vh=pow(10.,3.99984385397335/20.),vb=pow(vh,.4996667741545416),a=1+k/q+k*k;
 m->shelf=(Biquad){(vh+vb*k/q+k*k)/a,2*(k*k-vh)/a,(vh-vb*k/q+k*k)/a,2*(k*k-1)/a,(1-k/q+k*k)/a,0,0};
 k=tan(3.14159265358979323846*38.13547087613982/rate);q=.5003270373253953;a=1+k/q+k*k;
 m->hp=(Biquad){1,-2,1,2*(k*k-1)/a,(1-k/q+k*k)/a,0,0};return m;
}
void meter_push(Meter*m,const float*x,int frames){
 double scale=m->ambix?1.:1.4142135623730950488;
 for(int n=0;n<frames;n++){
  double w=x[n*4]*scale;truepeak(m,w);double y=filter(&m->hp,filter(&m->shelf,w)),e=y*y;
  int pos=(int)(m->count%m->shortblock);
  if(m->count>=(uint64_t)m->shortblock)m->sum3-=m->ring[pos];
  if(m->count>=(uint64_t)m->block)m->sum400-=m->ring[(m->count-m->block)%m->shortblock];
  m->ring[pos]=e;m->sum3+=e;m->sum400+=e;m->count++;
  if(m->count>=(uint64_t)m->block&&(m->count-m->block)%m->hop==0)append(&m->blocks,&m->nb,&m->bc,fmax(0,m->sum400/m->block));
  if(m->count>=(uint64_t)m->shortblock&&(m->count-m->shortblock)%m->hop==0)append(&m->shorts,&m->ns,&m->sc,fmax(0,m->sum3/m->shortblock));
 }
}
static int compare(const void*a,const void*b){double x=*(const double*)a,y=*(const double*)b;return (x>y)-(x<y);}
static double quantile(double*x,size_t n,double p){double rank=p*(n-1);size_t i=(size_t)rank;return i+1<n?x[i]+(rank-i)*(x[i+1]-x[i]):x[i];}
void meter_finish(Meter*m,double*out){
 out[0]=NAN;out[1]=NAN;double abs_gate=pow(10.,(-70.+.691)/10.),sum=0;size_t n=0;
 for(size_t i=0;i<m->nb;i++)if(m->blocks[i]>abs_gate){sum+=m->blocks[i];n++;}
 if(n){double relative=sum/n*.1;sum=0;n=0;for(size_t i=0;i<m->nb;i++)if(m->blocks[i]>abs_gate&&m->blocks[i]>relative){sum+=m->blocks[i];n++;}if(n&&sum>0)out[0]=-.691+10*log10(sum/n);}
 sum=0;n=0;for(size_t i=0;i<m->ns;i++)if(m->shorts[i]>abs_gate){sum+=m->shorts[i];n++;}
 if(n){double relative=sum/n*.01;size_t used=0;for(size_t i=0;i<m->ns;i++)if(m->shorts[i]>abs_gate&&m->shorts[i]>relative)m->shorts[used++]=-.691+10*log10(m->shorts[i]);if(used){qsort(m->shorts,used,sizeof(double),compare);out[1]=quantile(m->shorts,used,.95)-quantile(m->shorts,used,.10);}}
 for(int n=0;n<12;n++)truepeak(m,0);
 out[2]=m->peak>0?20*log10(m->peak):NAN;out[3]=(double)m->nb;out[4]=(double)m->ns;
}
void meter_destroy(Meter*m){if(!m)return;free(m->ring);free(m->blocks);free(m->shorts);free(m);}
