// Spherical, daily-mean anomaly EBM. No dependencies and no frame history.
import { brdf, clamp } from './model.mjs';
export { clamp };
import { FairResponse } from './fair-ebm.mjs';
import { PRESENT_CO2 } from './co2-baseline.mjs';
import { directOcean, diffuseOcean } from './jin-ocean.mjs';
export const RADIUS=6371000, YEAR=365.2422, DAY=86400, TAU=2*Math.PI;
export const ECS=[2.5,3,4], DOUBLING=5.35*Math.log(2);
export const DEFAULTS={co2:280,eccentricity:.0167,tilt:23.44,scatter:.3,width:120,wind:5};
export const forcing=co2=>5.35*Math.log(co2/280);
const mod=(x,n)=>(x%n+n)%n;
export function orbit(day,config=DEFAULTS) {
  const e=config.eccentricity,mean=TAU*(day-2)/YEAR;let anomaly=mean;
  for(let j=0;j<8;j++)anomaly-=(anomaly-e*Math.sin(anomaly)-mean)/(1-e*Math.cos(anomaly));
  const distance=1-e*Math.cos(anomaly),trueAnomaly=Math.atan2(Math.sqrt(1-e*e)*Math.sin(anomaly),Math.cos(anomaly)-e);
  const longitude=trueAnomaly+282.94*Math.PI/180;
  return {distance,declination:Math.asin(Math.sin(config.tilt*Math.PI/180)*Math.sin(longitude)),longitude,solar:1361/(distance*distance),anomaly,day:mod(day,YEAR)};
}
export function sphericalGrid(spacing=100) {
  const rows=Math.round(Math.PI*RADIUS/(spacing*1000)),dphi=Math.PI/rows,counts=new Uint32Array(rows),offsets=new Uint32Array(rows+1),latitudes=new Float64Array(rows);
  for(let r=0;r<rows;r++){latitudes[r]=-Math.PI/2+(r+.5)*dphi;counts[r]=Math.max(4,Math.round(2*rows*Math.cos(latitudes[r])));offsets[r+1]=offsets[r]+counts[r];}
  const count=offsets[rows],area=new Float64Array(count),latitude=new Float32Array(count),longitude=new Float32Array(count),rowOf=new Uint16Array(count);
  for(let r=0;r<rows;r++)for(let j=0;j<counts[r];j++){
    const i=offsets[r]+j;area[i]=TAU*(Math.sin(-Math.PI/2+(r+1)*dphi)-Math.sin(-Math.PI/2+r*dphi))/counts[r];
    latitude[i]=latitudes[r];longitude[i]=-Math.PI+(j+.5)*TAU/counts[r];rowOf[i]=r;
  }
  return {rows,counts,offsets,latitudes,dphi,count,area,latitude,longitude,rowOf,spacing};
}
export function cellAt(grid,latitude,longitude) {
  const row=clamp(Math.floor((latitude+Math.PI/2)/grid.dphi),0,grid.rows-1);
  return grid.offsets[row]+Math.min(grid.counts[row]-1,Math.floor(mod(longitude+Math.PI,TAU)/TAU*grid.counts[row]));
}
function graph(grid) {
  const left=[],right=[],weights=[],rates=new Float64Array(grid.count);
  const add=(i,j,g)=>{left.push(i);right.push(j);weights.push(g);rates[i]+=g/grid.area[i];rates[j]+=g/grid.area[j];};
  for(let r=0;r<grid.rows;r++){
    const n=grid.counts[r],start=grid.offsets[r],lat=grid.latitudes[r];
    for(let j=0;j<n;j++)add(start+j,start+(j+1)%n,grid.dphi/(Math.cos(lat)*TAU/n));
    if(r===grid.rows-1)continue;
    const m=grid.counts[r+1],next=grid.offsets[r+1];let j=0,k=0;
    while(j<n&&k<m){const endA=(j+1)/n,endB=(k+1)/m,overlap=Math.min(endA,endB)-Math.max(j/n,k/m);
      if(overlap>1e-14)add(start+j,next+k,overlap*TAU*Math.cos(-Math.PI/2+(r+1)*grid.dphi)/grid.dphi);
      if(endA<=endB+1e-14)j++;if(endB<=endA+1e-14)k++;
    }
  }
  let maximum=0;for(const rate of rates)maximum=Math.max(maximum,rate);
  return {left:Uint32Array.from(left),right:Uint32Array.from(right),weights:Float64Array.from(weights),maximum};
}
// The spherical heat kernel approaches a Gaussian of standard deviation width.
// Pairwise equal/opposite power fluxes conserve the area integral, including poles.
export function gaussianScatter(values,grid,edges,width,scratch) {
  if(width<=0)return values;
  const duration=.5*(width*1000/RADIUS)**2,steps=Math.max(1,Math.ceil(duration*edges.maximum/.42)),dt=duration/steps;
  let input=values,output=scratch;
  for(let k=0;k<steps;k++){
    output.set(input);
    for(let e=0;e<edges.left.length;e++){
      const i=edges.left[e],j=edges.right[e],power=dt*edges.weights[e]*(input[j]-input[i]);
      output[i]+=power/grid.area[i];output[j]-=power/grid.area[j];
    }
    const swap=input;input=output;output=swap;
  }
  return input;
}
// Eight-point Gauss–Legendre integration over sunlit hour angles for BRDF kernels.
const GLX=[-.9602898564975363,-.7966664774136267,-.525532409916329,-.1834346424956498,.1834346424956498,.525532409916329,.7966664774136267,.9602898564975363];
const GLW=[.1012285362903763,.2223810344533745,.3137066458778873,.362683783378362,.362683783378362,.3137066458778873,.2223810344533745,.1012285362903763];
export function dailySun(grid,day,config,incoming,vol,geo,ocean) {
  const state=orbit(day,config),sd=Math.sin(state.declination),cd=Math.cos(state.declination);let integral=0;
  for(let r=0;r<grid.rows;r++){
    const a=Math.sin(grid.latitudes[r])*sd,b=Math.cos(grid.latitudes[r])*cd;
    const H=b<1e-14?(a>0?Math.PI:0):Math.acos(clamp(-a/b,-1,1));
    incoming[r]=Math.max(0,state.solar/Math.PI*(H*a+b*Math.sin(H)));
    let total=0,v=0,g=0,o=0;
    for(let k=0;k<8;k++){
      const cosine=Math.max(0,a+b*Math.cos(H*GLX[k])),theta=Math.acos(clamp(cosine)),weight=GLW[k]*cosine;
      if(ocean)o+=weight*directOcean(cosine,config.wind);
      total+=weight;v+=weight*(-.007574+theta*theta*(-.070987+.307588*theta));g+=weight*(-1.284909+theta*theta*(-.166314+.04184*theta));
    }
    vol[r]=total?v/total:0;geo[r]=total?g/total:0;if(ocean)ocean[r]=total?o/total:diffuseOcean(config.wind);
    integral+=incoming[r]*grid.area[grid.offsets[r]]*grid.counts[r];
  }
  // Remove midpoint-area quadrature error so global incoming is exactly S(r)/4.
  const correction=integral>0?state.solar*Math.PI/integral:1;
  for(let r=0;r<grid.rows;r++)incoming[r]*=correction;
  return state;
}
function noise(seed) { let state=seed>>>0;return()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}; }
export class Planet {
  constructor({spacing=100,seed=42,landMask,...config}={}) {
    if(!(landMask instanceof Uint8Array)||landMask.length!==32400)throw new Error("The Earth land–ocean mask is missing or invalid");
    this.config={...DEFAULTS,co2:PRESENT_CO2.ppm,...config};this.startDay=Number(config.startDay)||0;this.responses=ECS.map(ecs=>new FairResponse(ecs,DOUBLING));this.grid=sphericalGrid(spacing);const n=this.grid.count;this.edges=graph(this.grid);
    this.kinds=new Uint8Array(n);this.coefficients=new Float64Array(n*3);this.baseScatter=new Float32Array(n);this.scatterFactor=new Float32Array(n);
    this.override=new Float32Array(n).fill(NaN);this.capacity=new Float64Array(n);this.referenceT=new Float32Array(n);
    this.localAnomaly=new Float64Array(n);this.localMean=0;this.seasonalT=new Float64Array(n);this.baselineAnnual=new Float64Array(n);
    this.absorbed=new Float64Array(n);this.referenceAbsorbed=new Float64Array(n);this.direct=new Float64Array(n);this.diffuse=new Float64Array(n);this.scratch=new Float64Array(n);
    this.albedo=new Float32Array(n);this.fraction=new Float32Array(n);this.net=new Float32Array(n);this.incoming=new Float32Array(n);
    this.sunRow=new Float64Array(this.grid.rows);this.volRow=new Float64Array(this.grid.rows);this.geoRow=new Float64Array(this.grid.rows);this.oceanRow=new Float64Array(this.grid.rows);
    this.elapsed=0;this.heat=0;this.rolling=new Float64Array(366);this.rollingSum=0;this.rollingIndex=0;this.rollingCount=0;this.history=[];
    const rng=noise(seed);
    for(let i=0;i<n;i++){
      const lat=this.grid.latitude[i],lon=this.grid.longitude[i],pixel=Math.min(359,Math.floor((lat+Math.PI/2)/Math.PI*360))*720+Math.min(719,Math.floor((lon+Math.PI)/TAU*720)),land=Boolean(landMask[pixel>>>3]&(1<<(pixel&7))),t=14-40*(Math.sin(lat)**2-1/3);
      const polar=Math.abs(lat)>1.17,arid=Math.abs(Math.abs(lat)-.46)<.14;
      const kind=!land?(polar?1:0):polar?5:arid?4:(Math.sin(lon*4+lat*7)+Math.cos(lon*9-lat*3)>.1?2:3);
      this.kinds[i]=kind;this.referenceT[i]=t;this.capacity[i]=land?2e7:2.1e8;
      const factor=clamp(.85+.32*Math.sin(3*lon+lat)*Math.cos(4*lat)+.18*Math.sin(8*lon-5*lat),.25,1.6);
      this.baseScatter[i]=factor;this.scatterFactor[i]=factor;
      if(kind<2){this.coefficients[i*3]=kind===1?.6:.06;continue;}
      const high=kind===2?.8:0,low=kind===3?.8:kind===2?.1:0,height=kind===4?350:200+600*rng(),temp=t+273.15;
      const p=brdf([high,low,kind===4?.08:.24,temp,.19,temp+2,height,high*4,low*2,kind===5?.25:0,temp]);
      for(let k=0;k<3;k++)this.coefficients[i*3+k]=.5395*p[k]+.4689*p[k+3];
    }
  }
  shortwave(day,config,reference=false,target=this.absorbed) {
    const grid=this.grid,n=grid.count;this.orbital=dailySun(grid,day,config,this.sunRow,this.volRow,this.geoRow,this.oceanRow);
    const oceanWhite=diffuseOcean(config.wind);
    for(let i=0;i<n;i++){
      const radiation=this.sunRow[grid.rowOf[i]],f=clamp(config.scatter*(reference?this.baseScatter[i]:this.scatterFactor[i]),0,.95);
      this.direct[i]=radiation*(1-f);this.diffuse[i]=radiation*f;
    }
    const diffuse=gaussianScatter(this.diffuse,grid,this.edges,config.width,this.scratch);
    for(let i=0;i<n;i++){
      const row=grid.rowOf[i],offset=i*3,iso=this.coefficients[offset],v=this.coefficients[offset+1],g=this.coefficients[offset+2];
      let black=clamp(iso+this.volRow[row]*v+this.geoRow[row]*g),white=clamp(iso+.189184*v-1.377622*g);
      if(this.kinds[i]<2){black=this.kinds[i]===1?.6:this.oceanRow[row];white=this.kinds[i]===1?.6:oceanWhite;}
      if(!reference&&Number.isFinite(this.override[i]))black=white=this.override[i];
      const incoming=this.direct[i]+diffuse[i],reflected=clamp(incoming>0?(this.direct[i]*black+diffuse[i]*white)/incoming:white)*incoming;
      target[i]=incoming-reflected;
      if(!reference){this.incoming[i]=incoming;this.albedo[i]=incoming>0?reflected/incoming:white;this.fraction[i]=incoming>0?diffuse[i]/incoming:clamp(config.scatter*this.scatterFactor[i],0,.95);}
    }
  }
  async initialize(yieldProgress=async()=>{}) {
    // Solve a periodic reference season analytically instead of spinning up years.
    const n=this.grid.count,B=DOUBLING/3,interval=YEAR*DAY/48,decay=new Float64Array(n),cycle=new Float64Array(n);
    for(let i=0;i<n;i++)decay[i]=Math.exp(-B*interval/this.capacity[i]);
    for(let k=0;k<48;k++){
      this.shortwave(this.startDay+(k+.5)*YEAR/48,DEFAULTS,true,this.referenceAbsorbed);
      for(let i=0;i<n;i++){
        const q=this.referenceAbsorbed[i];this.baselineAnnual[i]+=q/48;
        cycle[i]=cycle[i]*decay[i]+q/B*(1-decay[i]);
      }
      if(k%8===7)await yieldProgress((k+1)/48);
    }
    for(let i=0;i<n;i++)this.seasonalT[i]=cycle[i]/(-Math.expm1(-B*YEAR*DAY/this.capacity[i]))-this.baselineAnnual[i]/B;
    // A deliberate equilibrium-at-present-CO2 starting state, not historical Earth.
    const F=forcing(this.config.co2);for(const response of this.responses)response.equilibrate(F);
    this.localAnomaly.fill(F/B);this.localMean=F/B;
    this.diagnose();this.record();
  }
  calculate(day) {
    this.shortwave(this.startDay+day,DEFAULTS,true,this.referenceAbsorbed);
    this.shortwave(this.startDay+day,this.config,false,this.absorbed);
  }
  step() {
    this.calculate(this.elapsed+.5);const F=forcing(this.config.co2),n=this.grid.count,B=DOUBLING/3;let referenceHeat=0,shortwaveForcing=0,localMean=0;
    for(let i=0;i<n;i++){
      const C=this.capacity[i],previous=this.seasonalT[i],referenceForce=this.referenceAbsorbed[i]-this.baselineAnnual[i],weight=this.grid.area[i]/(4*Math.PI);
      const referenceEquilibrium=referenceForce/B;
      this.seasonalT[i]=referenceEquilibrium+(previous-referenceEquilibrium)*Math.exp(-B*DAY/C);
      const delta=this.absorbed[i]-this.referenceAbsorbed[i];shortwaveForcing+=delta*weight;
      const equilibrium=(delta+F)/B;
      this.localAnomaly[i]=equilibrium+(this.localAnomaly[i]-equilibrium)*Math.exp(-B*DAY/C);localMean+=this.localAnomaly[i]*weight;
      referenceHeat+=C*(this.seasonalT[i]-previous)*this.grid.area[i];
    }
    this.localMean=localMean;
    const central=this.responses[1],previousHeat=central.heat();for(const response of this.responses)response.step(shortwaveForcing+F);
    const energy=referenceHeat*RADIUS*RADIUS+(central.heat()-previousHeat)*YEAR*DAY*4*Math.PI*RADIUS*RADIUS;
    this.heat+=energy;this.elapsed++;this.diagnose(false);
    if(this.rollingCount===366)this.rollingSum-=this.rolling[this.rollingIndex];else this.rollingCount++;
    this.rolling[this.rollingIndex]=energy/(DAY*4*Math.PI*RADIUS*RADIUS);this.rollingSum+=this.rolling[this.rollingIndex];this.rollingIndex=(this.rollingIndex+1)%366;
    this.record();
  }
  diagnose(refresh=true) {
    if(refresh)this.calculate(this.elapsed+.5);
    const F=forcing(this.config.co2),means=this.responses.map(response=>response.temperature[0]);let incoming=0,absorbed=0,referenceNet=0,perturbedNet=0,temperature=0,scatter=0,albedo=0;
    for(let i=0;i<this.grid.count;i++){
      const weight=this.grid.area[i]/(4*Math.PI),baselineN=this.referenceAbsorbed[i]-this.baselineAnnual[i]-DOUBLING/3*this.seasonalT[i];
      const anomaly=this.localAnomaly[i]-this.localMean+means[1];
      const deltaN=this.absorbed[i]-this.referenceAbsorbed[i]+F-DOUBLING/3*anomaly;
      this.net[i]=baselineN+deltaN;
      incoming+=this.incoming[i]*weight;absorbed+=this.absorbed[i]*weight;referenceNet+=baselineN*weight;perturbedNet+=deltaN*weight;
      temperature+=(this.referenceT[i]+this.seasonalT[i]+this.localAnomaly[i]-this.localMean+this.responses[1].temperature[0])*weight;scatter+=this.fraction[i]*weight;albedo+=this.albedo[i]*this.incoming[i]*weight;
    }
    this.metrics={day:this.elapsed,temperature,warming:means[1],lower:Math.min(...means),upper:Math.max(...means),scenarioWarming:means,
      incoming,absorbed,reflected:incoming-absorbed,outgoing:absorbed-referenceNet-perturbedNet,imbalance:referenceNet+perturbedNet,perturbation:perturbedNet,
      forcing:F,shortwaveForcing:perturbedNet-F+DOUBLING/3*means[1],layers:Array.from(this.responses[1].temperature),scatter,albedo:incoming>0?albedo/incoming:0,heat:this.heat/1e21,annual:this.rollingCount>=365?this.rollingSum/this.rollingCount:null,orbital:this.orbital};
  }
  record() {
    // Monthly summaries, bounded history: temperatures, not per-cell snapshots.
    if(this.elapsed%30===0){const m=this.metrics;this.history.push([m.day,m.warming,m.lower,m.upper,m.perturbation,m.imbalance,m.heat]);if(this.history.length>1200)this.history.shift();}
  }
  edit({latitude,longitude,radius=350,mode,value,index}) {
    if(Number.isInteger(index)&&index>=0&&index<this.grid.count){
      if(mode==='albedo')this.override[index]=clamp(value);else if(mode==='scatter')this.scatterFactor[index]=clamp(value,0,3);else if(mode==='restore'){this.override[index]=NaN;this.scatterFactor[index]=this.baseScatter[index];}
    }else{
      const limit=radius*1000/RADIUS,edge=Math.exp(-4.5),s=Math.sin(latitude),c=Math.cos(latitude);
      for(let i=0;i<this.grid.count;i++){
        const distance=Math.acos(clamp(s*Math.sin(this.grid.latitude[i])+c*Math.cos(this.grid.latitude[i])*Math.cos(this.grid.longitude[i]-longitude),-1,1));
        if(distance>=limit)continue;const weight=(Math.exp(-4.5*(distance/limit)**2)-edge)/(1-edge);
        if(mode==='brighten'||mode==='darken'){const a=Number.isFinite(this.override[i])?this.override[i]:this.albedo[i];this.override[i]=clamp(a+(mode==='brighten'?1:-1)*.08*weight);}
        else if(mode==='scatter')this.scatterFactor[i]=clamp(this.scatterFactor[i]+.2*weight,0,3);
        else if(mode==='clear')this.scatterFactor[i]=clamp(this.scatterFactor[i]-.2*weight,0,3);
        else if(mode==='restore'){this.override[i]=NaN;this.scatterFactor[i]=this.baseScatter[i];}
      }
    }
    this.diagnose();
  }
  inspect(index) {
    if(index<0||index>=this.grid.count)return null;
    return {index,latitude:this.grid.latitude[index]*180/Math.PI,longitude:this.grid.longitude[index]*180/Math.PI,kind:this.kinds[index],area:this.grid.area[index]*RADIUS*RADIUS/1e6,
      albedo:this.albedo[index],override:Number.isFinite(this.override[index])?this.override[index]:null,factor:this.scatterFactor[index],diffuse:this.fraction[index],temperature:this.referenceT[index]+this.seasonalT[index]+this.localAnomaly[index]-this.localMean+this.responses[1].temperature[0],incoming:this.incoming[index],net:this.net[index]};
  }
  frame(target=new Float32Array(this.grid.count*5)) {
    for(let i=0;i<this.grid.count;i++){const j=i*5;target[j]=this.referenceT[i]+this.seasonalT[i]+this.localAnomaly[i]-this.localMean+this.responses[1].temperature[0];target[j+1]=this.albedo[i];target[j+2]=this.fraction[i];target[j+3]=this.net[i];target[j+4]=this.localAnomaly[i]-this.localMean+this.responses[1].temperature[0];}
    return target;
  }
}
