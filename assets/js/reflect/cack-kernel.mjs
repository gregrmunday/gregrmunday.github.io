// Prescribed monthly all-sky CACK, not a cloud simulation. Only the approved
// quantised climatological mean is fetched; raw NetCDF never enters the browser.
const WIDTH=180,HEIGHT=90,PLANE=WIDTH*HEIGHT,TAU=2*Math.PI;
const wrap=(value,n)=>(value%n+n)%n;
export const MONTH_DAYS=[31,28,31,30,31,30,31,31,30,31,30,31];
const edges=[0];for(const days of MONTH_DAYS)edges.push(edges.at(-1)+days);
export async function loadCack(){
 const responses=await Promise.all(['cack-monthly.json','cack-monthly.bin'].map(name=>fetch(new URL('../../data/reflect/'+name,import.meta.url))));
 if(responses.some(response=>!response.ok))throw new Error('Could not load the prescribed CACK radiative kernel');
 const [metadata,buffer]=await Promise.all([responses[0].json(),responses[1].arrayBuffer()]);
 if(metadata.format!=='reflect-cack-1'||metadata.shape?.join(',')!=='12,90,180'||metadata.scale!==.01||metadata.dtype!=='uint16_little_endian'||buffer.byteLength!==12*PLANE*2)throw new Error('Unsupported CACK data format');
 return new CackKernel(metadata,buffer);
}
export class CackKernel {
 constructor(metadata,buffer){this.source=metadata;this.data=new DataView(buffer);this.cache=new Map();this.grid=null;}
 sample(month,latitude,longitude){
  const y=Math.max(0,Math.min(HEIGHT-1,(latitude*180/Math.PI+90)/2-.5)),x=wrap((longitude*180/Math.PI+180)/2-.5,WIDTH),y0=Math.floor(y),y1=Math.min(y0+1,HEIGHT-1),x0=Math.floor(x),x1=(x0+1)%WIDTH,fy=y-y0,fx=x-x0;
  const value=(row,col)=>this.data.getUint16((month*PLANE+row*WIDTH+col)*2,true)*.01;
  return (1-fy)*((1-fx)*value(y0,x0)+fx*value(y0,x1))+fy*((1-fx)*value(y1,x0)+fx*value(y1,x1));
 }
 // Mean daily TOA insolation over a reference calendar month, by latitude.
 // This analytic geometry quadrature does not integrate climate temperatures.
 bind(grid,orbit,defaults,year){
  this.grid=grid;this.referenceSolar=new Float64Array(12*grid.rows);this.year=year;
  for(let month=0;month<12;month++)for(let d=edges[month];d<edges[month+1];d++){
   const state=orbit((d+.5)*year/365,defaults),sd=Math.sin(state.declination),cd=Math.cos(state.declination);
   for(let row=0;row<grid.rows;row++){
    const latitude=grid.latitudes[row],a=Math.sin(latitude)*sd,b=Math.cos(latitude)*cd,h=Math.acos(Math.max(-1,Math.min(1,-a/b)));
    const mean=state.solar/Math.PI*Math.max(0,h*a+b*Math.sin(h));
    this.referenceSolar[month*grid.rows+row]+=mean/MONTH_DAYS[month];
   }
  }
 }
 calendar(day){
  const date=wrap(day,this.year)/this.year*365;let month=0;while(month<11&&date>=edges[month+1])month++;
  // Piecewise monthly values retain the published monthly-mean interpretation.
  return month;
 }
 factors(day){
  const month=this.calendar(day);let factors=this.cache.get(month);if(factors)return factors;
  const grid=this.grid;factors=new Float32Array(grid.count);
  for(let i=0;i<grid.count;i++){
   const mean=this.referenceSolar[month*grid.rows+grid.rowOf[i]];
   // A monthly polar-night kernel cannot constrain an artificial lit season.
   factors[i]=mean>1?this.sample(month,grid.latitude[i],grid.longitude[i])/mean:0;
  }
  // Keep only the current and neighbouring month's grid planes, not 12 copies.
  while(this.cache.size>=2)this.cache.delete(this.cache.keys().next().value);
  this.cache.set(month,factors);return factors;
 }
}
