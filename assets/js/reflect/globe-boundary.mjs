// Compact, same-origin SpeedyWeatherAssets inputs. Used only at initialisation.
// C45 consumes physical inputs; the prescribed albedo asset is never loaded.
import { clamp } from './model.mjs';
const WIDTH=720,HEIGHT=360,ROWS=48,COLS=96,PLANE=ROWS*COLS,MISSING=65535;
const wrap=(value,length)=>(value%length+length)%length;
const VARIABLES=['swl1','swl2','lst','snow','sic','sst'];
const SCALES=[.00001,.00001,.01,1,1/65535,.01];
export async function loadBoundary(){
 const names=['boundary-conditions.json','boundary-static.bin','boundary-land-mask.bin','boundary-climate.bin'];
 const responses=await Promise.all(names.map(name=>fetch(new URL('../../data/reflect/'+name,import.meta.url))));
 for(let i=0;i<responses.length;i++)if(!responses[i].ok)throw new Error(`Could not load surface boundary data (${names[i]})`);
 const [metadata,staticBuffer,maskBuffer,climateBuffer]=await Promise.all(responses.map((response,i)=>i===0?response.json():response.arrayBuffer()));
 return new BoundaryData(metadata,staticBuffer,maskBuffer,climateBuffer);
}
export class BoundaryData{
 constructor(metadata,staticBuffer,maskBuffer,climateBuffer){
  const m=metadata;
  if(m.static?.width!==WIDTH||m.static?.height!==HEIGHT||m.static?.stride!==6||m.static?.rows!=='south-to-north'||
     m.mask?.width!==WIDTH||m.mask?.height!==HEIGHT||m.mask?.bit_order!=='least-significant-bit-first'||
     m.climate?.shape?.join(',')!=='12,6,48,96'||m.climate?.dtype!=='uint16_little_endian'||
     m.climate?.missing!==MISSING||m.climate?.order!=='month,field,latitude,longitude'||
     m.climate?.fields?.some((field,i)=>field.variable!==VARIABLES[i]||field.scale!==SCALES[i])||m.climate?.fields?.length!==6||
     staticBuffer.byteLength!==WIDTH*HEIGHT*6||maskBuffer.byteLength!==WIDTH*HEIGHT/8||climateBuffer.byteLength!==12*6*PLANE*2)
    throw new Error('Surface boundary data has an unsupported format or size');
  this.latitude=m.climate.latitude;this.longitude=m.climate.longitude;
  if(this.latitude?.length!==ROWS||this.longitude?.length!==COLS||
     this.latitude.some((v,i)=>!Number.isFinite(v)||v<=-90||v>=90||(i>0&&v<=this.latitude[i-1]))||
     this.longitude.some((v,i)=>v!==i*3.75))throw new Error('Surface boundary coordinates are invalid');
  this.static=new Uint8Array(staticBuffer);this.mask=new Uint8Array(maskBuffer);this.climate=new DataView(climateBuffer);
  this.source=m.source;this.commit=m.commit;this.flags=0;this.nearest=new Map();
  this.vectors=new Float64Array(PLANE*3);
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
   const p=(y*COLS+x)*3,phi=this.latitude[y]*Math.PI/180,lambda=this.longitude[x]*Math.PI/180;
   this.vectors[p]=Math.cos(phi)*Math.cos(lambda);this.vectors[p+1]=Math.cos(phi)*Math.sin(lambda);this.vectors[p+2]=Math.sin(phi);
  }
 }
 pixel(latitude,longitude){
  const y=clamp(Math.floor((latitude+Math.PI/2)/Math.PI*HEIGHT),0,HEIGHT-1),x=Math.floor(wrap(longitude+Math.PI,2*Math.PI)/(2*Math.PI)*WIDTH);
  return y*WIDTH+x;
 }
 isLand(latitude,longitude){const p=this.pixel(latitude,longitude);return Boolean(this.mask[p>>>3]&(1<<(p&7)));}
 staticAt(latitude,longitude,target){
  const p=this.pixel(latitude,longitude)*6,s=this.static;
  target[0]=s[p]/255;target[1]=s[p+1]/255;
  // Quantisation and independently recorded covers can overlap. Preserve their ratio.
  const cover=target[0]+target[1];if(cover>1){target[0]/=cover;target[1]/=cover;}
  target[6]=s[p+4]+256*s[p+5];target[7]=s[p+2]/32;target[8]=s[p+3]/32;
 }
 locate(latitude,longitude){
  const phi=latitude*180/Math.PI;let low=0,high=ROWS-1;
  while(high-low>1){const mid=(low+high)>>>1;if(this.latitude[mid]<=phi)low=mid;else high=mid;}
  const fy=clamp((phi-this.latitude[low])/(this.latitude[high]-this.latitude[low]));
  const column=wrap(longitude*180/Math.PI,360)/3.75,x0=Math.floor(column),x1=(x0+1)%COLS,fx=column-x0;
  return {indices:[low*COLS+x0,low*COLS+x1,high*COLS+x0,high*COLS+x1],
   weights:[(1-fy)*(1-fx),(1-fy)*fx,fy*(1-fx),fy*fx],nearest:(fy<.5?low:high)*COLS+(fx<.5?x0:x1)};
 }
 value(plane,index){return this.climate.getUint16((plane*PLANE+index)*2,true);}
 nearestValid(plane,index){
  let cache=this.nearest.get(plane);if(!cache){cache=new Int16Array(PLANE).fill(-1);this.nearest.set(plane,cache);}
  if(cache[index]>=0)return this.value(plane,cache[index]);
  const v=this.vectors,p=index*3;let best=-Infinity,chosen=-1;
  // Rare wholly masked coast/island samples: nearest valid source node on a sphere.
  // Cache by source node, not by every ~100 km model tile.
  for(let i=0;i<PLANE;i++)if(this.value(plane,i)!==MISSING){const q=i*3,dot=v[p]*v[q]+v[p+1]*v[q+1]+v[p+2]*v[q+2];if(dot>best){best=dot;chosen=i;}}
  if(chosen<0)throw new Error('A monthly surface boundary field has no valid samples');
  cache[index]=chosen;return this.value(plane,chosen);
 }
 monthValue(month,field,location){
  const plane=wrap(month,12)*6+field;let sum=0,total=0;
  for(let i=0;i<4;i++){
   const weight=location.weights[i];if(weight<=0)continue;
   const value=this.value(plane,location.indices[i]);
   if(value===MISSING){this.flags|=1;continue;}sum+=value*weight;total+=weight;
  }
  if(total>1e-12)return sum/total*SCALES[field];
  this.flags|=2;return this.nearestValid(plane,location.nearest)*SCALES[field];
 }
 sample(field,location,month,fraction){
  const current=this.monthValue(month,field,location);
  if(fraction===0)return current;
  return current*(1-fraction)+this.monthValue(month+1,field,location)*fraction;
 }
 landInputs(latitude,longitude,month,fraction,target){
  this.flags=0;this.staticAt(latitude,longitude,target);const location=this.locate(latitude,longitude);
  target[2]=clamp(this.sample(0,location,month,fraction));target[4]=clamp(this.sample(1,location,month,fraction));
  const temperature=this.sample(2,location,month,fraction);
  // No distinct deep-soil/2 m temperature exists in this asset bundle.
  target[3]=target[5]=target[10]=temperature;
  target[9]=Math.max(0,this.sample(3,location,month,fraction))/1000; // kg/m² -> water-equivalent metres
  return target;
 }
 oceanIce(latitude,longitude,month,fraction){
  this.flags=0;return clamp(this.sample(4,this.locate(latitude,longitude),month,fraction));
 }
}
