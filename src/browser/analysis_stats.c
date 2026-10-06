/* Descriptive FOA statistics; processing does not modify audio. */
#include <stdlib.h>
#include <math.h>
typedef struct {unsigned long long n,above[4],full[4];double sum[4],square[4],cross[16],peak[4];} Stats;
void*stats_create(void){return calloc(1,sizeof(Stats));}
void stats_push(Stats*s,const float*x,int frames){
 for(int k=0;k<frames;k++){s->n++;for(int i=0;i<4;i++){double v=x[4*k+i];s->sum[i]+=v;s->square[i]+=v*v;s->peak[i]=fmax(s->peak[i],fabs(v));s->above[i]+=fabs(v)>1.;s->full[i]+=fabs(v)>=1.;for(int j=0;j<4;j++)s->cross[4*i+j]+=v*x[4*k+j];}}
}
void stats_get(Stats*s,double*out){out[0]=(double)s->n;for(int i=0;i<4;i++){out[1+i]=s->sum[i];out[5+i]=s->square[i];out[9+i]=s->peak[i];out[13+i]=(double)s->above[i];out[17+i]=(double)s->full[i];}for(int i=0;i<16;i++)out[21+i]=s->cross[i];}
void stats_destroy(void*s){free(s);}
