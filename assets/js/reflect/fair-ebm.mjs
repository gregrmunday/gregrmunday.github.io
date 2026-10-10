// Independent JavaScript implementation of FaIR's deterministic n-layer thermal
// equations, specialised to three layers. Source equations: FaIR 2.2.x
// https://docs.fairmodel.net/en/latest/api_reference.html#fair-energy-balance-model
// Capacities/exchanges: FaIR 2.2.4 HadGEM2-ES example (Cummins et al. 2020).
// https://docs.fairmodel.net/en/v2.2.4/examples/n-layer-ebm.html
// Feedback is reset for each assessed ECS; efficacy is set to 1, not the example
// value 1.59. This is an illustrative configuration, not that model calibration.
// No carbon cycle, stochastic forcing process or calibrated posterior ensemble.
export const FAIR_CAPACITY=[3.62,9.47,98.66]; // W yr m^-2 K^-1
export const FAIR_EXCHANGE=[2.39,.63]; // W m^-2 K^-1
export const FAIR_EFFICACY=1; // FaIR's default: conservative layer exchange
function multiply(a,b){const out=new Float64Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let k=0;k<4;k++)out[i*4+j]+=a[i*4+k]*b[k*4+j];return out;}
function exponential(matrix){
 let norm=0;for(let i=0;i<4;i++){let row=0;for(let j=0;j<4;j++)row+=Math.abs(matrix[i*4+j]);norm=Math.max(norm,row);}
 const squarings=Math.max(0,Math.ceil(Math.log2(norm/.5))),scale=2**squarings,a=Float64Array.from(matrix,v=>v/scale);
 let sum=new Float64Array(16),term=new Float64Array(16);for(let j=0;j<4;j++)sum[j*4+j]=term[j*4+j]=1;
 for(let order=1;order<=40;order++){term=multiply(term,a);let largest=0;for(let i=0;i<16;i++){term[i]/=order;sum[i]+=term[i];largest=Math.max(largest,Math.abs(term[i]));}if(largest<1e-17)break;}
 for(let i=0;i<squarings;i++)sum=multiply(sum,sum);return sum;
}
export class FairResponse {
 constructor(ecs,forcing2co2,timestep=1/365.2422){
  this.ecs=ecs;this.feedback=forcing2co2/ecs;this.capacity=FAIR_CAPACITY;this.temperature=new Float64Array(3);
  const [c0,c1,c2]=FAIR_CAPACITY,[k1,k2]=FAIR_EXCHANGE,e=FAIR_EFFICACY;
  const generator=new Float64Array([
   -(this.feedback+k1)/c0,k1/c0,0,1/c0,
   k1/c1,-(k1+e*k2)/c1,e*k2/c1,0,
   0,k2/c2,-k2/c2,0,
   0,0,0,0
  ]);
  this.transition=exponential(Float64Array.from(generator,x=>x*timestep));
 }
 equilibrate(forcing){this.temperature.fill(forcing/this.feedback);}
 initializePeriodic(forcings){
  // Compose one cycle T_end = A T_start + b, then solve (I - A) T_start = b.
  // Uses the same exact transition as step(), without a multi-year spin-up.
  const m=this.transition;let a=new Float64Array([1,0,0,0,1,0,0,0,1]),b=new Float64Array(3);
  for(const forcing of forcings){
   const nextA=new Float64Array(9),nextB=new Float64Array(3);
   for(let i=0;i<3;i++){
    nextB[i]=m[i*4+3]*forcing;
    for(let k=0;k<3;k++){
     nextB[i]+=m[i*4+k]*b[k];
     for(let j=0;j<3;j++)nextA[i*3+j]+=m[i*4+k]*a[k*3+j];
    }
   }
   a=nextA;b=nextB;
  }
  const rows=Array.from({length:3},(_,i)=>[(i===0?1:0)-a[i*3],(i===1?1:0)-a[i*3+1],(i===2?1:0)-a[i*3+2],b[i]]);
  for(let j=0;j<3;j++){
   let pivot=j;for(let i=j+1;i<3;i++)if(Math.abs(rows[i][j])>Math.abs(rows[pivot][j]))pivot=i;
   [rows[j],rows[pivot]]=[rows[pivot],rows[j]];
   const divisor=rows[j][j];if(Math.abs(divisor)<1e-14)throw new Error('Periodic thermal response is singular');
   for(let k=j;k<4;k++)rows[j][k]/=divisor;
   for(let i=0;i<3;i++)if(i!==j){const factor=rows[i][j];for(let k=j;k<4;k++)rows[i][k]-=factor*rows[j][k];}
  }
  for(let i=0;i<3;i++)this.temperature[i]=rows[i][3];
 }
 step(forcing){
  const t=this.temperature,m=this.transition,x=t[0],y=t[1],z=t[2];
  t[0]=m[0]*x+m[1]*y+m[2]*z+m[3]*forcing;
  t[1]=m[4]*x+m[5]*y+m[6]*z+m[7]*forcing;
  t[2]=m[8]*x+m[9]*y+m[10]*z+m[11]*forcing;
 }
 imbalance(forcing){return forcing-this.feedback*this.temperature[0]+(1-FAIR_EFFICACY)*FAIR_EXCHANGE[1]*(this.temperature[1]-this.temperature[2]);}
 heat(){return this.capacity.reduce((sum,c,i)=>sum+c*this.temperature[i],0);}
}
