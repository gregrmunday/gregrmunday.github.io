import { brdf, clamp } from './model.mjs';
import { hourlySun, gaussianScatter, LAND_FIELDS, RADIUS, TAU } from './globe-model.mjs';
import { reflectedFlux } from './radiative-transfer.mjs';
// Snapshot inputs and optics, not climate history. One bounded workspace is
// released on completion; no changes are made to the live planet's arrays.
export async function sensitivity(planet,{index,key,radius=0,min,max,request},yieldWork) {
 const field=LAND_FIELDS[key];if(!field||!Number.isInteger(index)||index<0||index>=planet.grid.count||planet.landSlots[index]<0)throw new Error('Select a land tile and input');
 const indices=radius>0?planet.regionCells(planet.grid.latitude[index],planet.grid.longitude[index],radius,true):Uint32Array.of(index);
 if(!indices.length||indices.length>4096)throw new Error('Choose a smaller land region (at most 4096 cells)');
 const [inputIndex,low,high]=field,inputs=new Float32Array(indices.length*11),coefficients=new Float64Array(indices.length*3),config={...planet.config},scatter=planet.scatterFactor.slice(),responses=planet.responses.map(p=>p.feedback),grid=planet.grid,n=grid.count;
 let upper=high,area=0,meanInput=0;
 for(let j=0;j<indices.length;j++){
  const i=indices[j],slot=planet.landSlots[i],p=planet.landInputs.subarray(slot*11,slot*11+11);inputs.set(p,j*11);coefficients.set(planet.coefficients.subarray(slot*3,slot*3+3),j*3);
  if(inputIndex===0||inputIndex===1)upper=Math.min(upper,1-p[1-inputIndex]);
  area+=grid.area[i];meanInput+=grid.area[i]*p[inputIndex];
 }
 if(!Number.isFinite(min)||!Number.isFinite(max)||min<low||max>upper+1e-7||min>=max)throw new Error(`Choose a range within ${low}–${upper.toFixed(4)} in physical units; cover must remain valid in every tile`);
 const solar=new Float64Array(n),vol=new Float64Array(n),geo=new Float64Array(n),ocean=new Float64Array(n),direct=new Float64Array(n),diffuse=new Float64Array(n),scratch=new Float64Array(n);
 const samples=25,lighting=new Float32Array(indices.length*24*5),lookup=planet.oceanLookups.get(config.wind),day=planet.startDay+planet.elapsed,transmission=1-.25*config.screening,flux=new Float64Array(6),working=new Float64Array(11),useCack=config.landKernel==='cack'&&planet.cack;
 for(let hour=0;hour<24;hour++){
  hourlySun(grid,day+(hour+.5)/24,config,solar,vol,geo,ocean,lookup);
  for(let i=0;i<n;i++){const f=clamp(config.scatter*scatter[i],0,.95);direct[i]=transmission*solar[i]*(1-f);diffuse[i]=transmission*solar[i]*f;}
  const spread=gaussianScatter(diffuse,grid,planet.edges,config.width,scratch);
  const kernel=useCack?planet.cack.factors(day+(hour+.5)/24):null;
  for(let j=0;j<indices.length;j++){const i=indices[j],offset=(hour*indices.length+j)*5;lighting[offset]=direct[i];lighting[offset+1]=spread[i];lighting[offset+2]=vol[i];lighting[offset+3]=geo[i];lighting[offset+4]=kernel?kernel[i]*(direct[i]+spread[i])/transmission:0;}
  await yieldWork(hour/49);
 }
 let baselineReflection=0,baselineIncoming=0,baselineSurfaceAbsorbed=0,baselineToa=0;
 for(let hour=0;hour<24;hour++)for(let j=0;j<indices.length;j++){
  const o=(hour*indices.length+j)*5,c=j*3,weight=grid.area[indices[j]]/24;
  reflectedFlux(lighting[o],lighting[o+1],coefficients[c]+lighting[o+2]*coefficients[c+1]+lighting[o+3]*coefficients[c+2],coefficients[c]+.189184*coefficients[c+1]-1.377622*coefficients[c+2],config.screening,flux);
  const firstIncoming=lighting[o]+lighting[o+1];
  baselineReflection+=flux[5]*firstIncoming*weight;baselineIncoming+=firstIncoming*weight;baselineSurfaceAbsorbed+=flux[2]*weight;
  baselineToa+=(useCack?lighting[o+4]*flux[5]:flux[3])*weight;
 }
 const points=[];
 for(let sample=0;sample<samples;sample++){
  const value=min+(max-min)*sample/(samples-1);let reflected=0,incoming=0,surfaceAbsorbed=0,clipped=0,daylight=0,toa=0;
  for(let j=0;j<indices.length;j++){
   working.set(inputs.subarray(j*11,j*11+11));working[inputIndex]=value;const parameters=brdf(working),iso=.5395*parameters[0]+.4689*parameters[3],v=.5395*parameters[1]+.4689*parameters[4],g=.5395*parameters[2]+.4689*parameters[5],white=iso+.189184*v-1.377622*g,weight=grid.area[indices[j]]/24;
   for(let hour=0;hour<24;hour++){
    const o=(hour*indices.length+j)*5;
    reflectedFlux(lighting[o],lighting[o+1],iso+lighting[o+2]*v+lighting[o+3]*g,white,config.screening,flux);
    const firstIncoming=lighting[o]+lighting[o+1];
    reflected+=flux[5]*firstIncoming*weight;incoming+=firstIncoming*weight;surfaceAbsorbed+=flux[2]*weight;
    toa+=(useCack?lighting[o+4]*flux[5]:flux[3])*weight;
    if(flux[0]>0){daylight+=weight;if(flux[4])clipped+=weight;}
   }
  }
  const forcing=(baselineToa-toa)/(4*Math.PI),temperatures=responses.map(feedback=>forcing/feedback);
  points.push({value,albedo:incoming>0?reflected/incoming:null,surfaceChange:(surfaceAbsorbed-baselineSurfaceAbsorbed)/area,forcing,equilibrium:temperatures[1],lower:Math.min(...temperatures),upper:Math.max(...temperatures),clippedFraction:daylight>0?clipped/daylight:0});
  await yieldWork((24+sample+1)/49);
 }
 return {request,index,key,radius,cells:indices.length,area:area*RADIUS*RADIUS/1e6,meanInput:meanInput/area,baselineAlbedo:baselineIncoming>0?baselineReflection/baselineIncoming:null,day:planet.elapsed,points};
}
