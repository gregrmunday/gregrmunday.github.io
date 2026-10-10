import { reflectedFlux } from './radiative-transfer.mjs';
// Spherical, hourly anomaly EBM. No dependencies and no frame history.
import { brdf, clamp } from './model.mjs';
export { clamp };
import { FairResponse } from './fair-ebm.mjs';
import { PRESENT_CO2 } from './co2-baseline.mjs';
import { directOcean, diffuseOcean } from './jin-ocean.mjs';
export const MODEL_VERSION='reflect-planet-2';
export const RADIUS=6371000, YEAR=365.2422, DAY=86400, TAU=2*Math.PI;
export const HOUR=3600, STEP_DAYS=1/24;
const YEAR_HOURS=YEAR*24, ROLLING_HOURS=Math.ceil(YEAR_HOURS);
export const ECS=[2.5,3,4], DOUBLING=5.35*Math.log(2);
export const BASE_TEMPERATURE=14; // Prescribed 280 ppm annual mean, not an observation.
export const DEFAULTS={co2:280,eccentricity:.0167,tilt:23.44,scatter:.3,width:120,wind:5,screening:1,landKernel:'cack'};
export const forcing=co2=>5.35*Math.log(co2/280);
const mod=(x,n)=>(x%n+n)%n;
const LAND_MODES=new Set(['low-vegetation','high-vegetation','bare-ground','snow-cover','raise-terrain','lower-terrain','land-inputs','restore']);
// Index, minimum and maximum in the physical input vector's units. These are
// exploration guardrails, not a claim about the learned model's training range.
export const LAND_FIELDS={high:[0,0,1],low:[1,0,1],topMoisture:[2,0,1],topTemperature:[3,150,350],deepMoisture:[4,0,1],deepTemperature:[5,150,350],height:[6,0,9000],highLai:[7,0,15],lowLai:[8,0,15],snow:[9,0,10],airTemperature:[10,150,350]};
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
  const count=offsets[rows],area=new Float64Array(count),latitude=new Float32Array(count),longitude=new Float32Array(count),rowOf=new Uint16Array(count),sinLongitude=new Float32Array(count),cosLongitude=new Float32Array(count);
  for(let r=0;r<rows;r++)for(let j=0;j<counts[r];j++){
    const i=offsets[r]+j;area[i]=TAU*(Math.sin(-Math.PI/2+(r+1)*dphi)-Math.sin(-Math.PI/2+r*dphi))/counts[r];
    latitude[i]=latitudes[r];longitude[i]=-Math.PI+(j+.5)*TAU/counts[r];rowOf[i]=r;
    sinLongitude[i]=Math.sin(longitude[i]);cosLongitude[i]=Math.cos(longitude[i]);
  }
  return {rows,counts,offsets,latitudes,dphi,count,area,latitude,longitude,rowOf,spacing,sinLongitude,cosLongitude};
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
// Instantaneous zenith kernels at the hourly midpoint. Solar noon is 12 UTC
// at Greenwich; the equation of time is omitted. Direct sunlight is zero on the night side.
export function hourlySun(grid,day,config,incoming,vol,geo,ocean,oceanLookup) {
  const state=orbit(day,config),utcHour=mod(day,1)*24,subsolarLongitude=TAU*(.5-utcHour/24);
  const sd=Math.sin(state.declination),cd=Math.cos(state.declination),sl=Math.sin(subsolarLongitude),cl=Math.cos(subsolarLongitude);let integral=0;
  for(let row=0;row<grid.rows;row++){
    const a=Math.sin(grid.latitudes[row])*sd,b=Math.cos(grid.latitudes[row])*cd;
    for(let i=grid.offsets[row];i<grid.offsets[row+1];i++){
      const mu=clamp(a+b*(grid.cosLongitude[i]*cl+grid.sinLongitude[i]*sl));
      incoming[i]=state.solar*mu;integral+=incoming[i]*grid.area[i];
      if(mu===0){vol[i]=geo[i]=0;ocean[i]=0;continue;}
      const theta=Math.acos(mu);
      vol[i]=-.007574+theta*theta*(-.070987+.307588*theta);
      geo[i]=-1.284909+theta*theta*(-.166314+.04184*theta);
      // A small wind-specific lookup avoids expensive Jin exponentials for
      // each ocean tile/hour. Linear interpolation preserves its coefficients.
      const position=mu*(oceanLookup.length-1),index=Math.min(oceanLookup.length-2,Math.floor(position)),fraction=position-index;
      ocean[i]=oceanLookup[index]+fraction*(oceanLookup[index+1]-oceanLookup[index]);
    }
  }
  const correction=integral>0?state.solar*Math.PI/integral:1;
  for(let i=0;i<grid.count;i++)incoming[i]*=correction;
  return {...state,utcHour,subsolarLongitude};
}
export class Planet {
  constructor({spacing=100,seed=42,boundary,cack,...config}={}) {
    if(!boundary||typeof boundary.landInputs!=="function")throw new Error("Surface boundary data is missing");
    const month=config.initialMonth??0,fraction=config.monthFraction??0;
    if(!Number.isInteger(month)||month<0||month>11||!Number.isFinite(fraction)||fraction<0||fraction>=1)throw new Error("Invalid surface initialisation date");
    this.boundaryInfo={source:boundary.source,commit:boundary.commit,date:config.boundaryDate??"January climatology"};
    this.config={...DEFAULTS,co2:PRESENT_CO2.ppm,...config};this.startDay=(Number(config.startDay)||0)+(Number(config.startHour)||0)/24;this.responses=ECS.map(ecs=>new FairResponse(ecs,DOUBLING,STEP_DAYS/YEAR));this.controlResponses=ECS.map(ecs=>new FairResponse(ecs,DOUBLING,STEP_DAYS/YEAR));this.grid=sphericalGrid(spacing);const n=this.grid.count;this.edges=graph(this.grid);
    this.seed=seed;this.cack=cack??null;if(this.cack)this.cack.bind(this.grid,orbit,DEFAULTS,YEAR);
    this.transferControl=new Float64Array(6);this.physicalChanged=new Uint8Array(n);
    this.ice=new Float32Array(n);this.boundaryFlags=new Uint8Array(n);this.landSlots=new Int32Array(n).fill(-1);
    let landCount=0;for(let i=0;i<n;i++)if(boundary.isLand(this.grid.latitude[i],this.grid.longitude[i]))this.landSlots[i]=landCount++;
    this.landInputs=new Float32Array(landCount*11);
    this.kinds=new Uint8Array(n);this.coefficients=new Float64Array(landCount*3);this.baseScatter=new Float32Array(n);this.scatterFactor=new Float32Array(n);
    this.override=new Float32Array(n).fill(NaN);this.capacity=new Float64Array(n);this.referenceT=new Float32Array(n);
    this.localAnomaly=new Float64Array(n);this.localControl=new Float64Array(n);this.localMean=0;this.controlMean=0;this.seasonalT=new Float64Array(n);this.baselineAnnual=new Float64Array(n);
    this.referenceMean=0;this.seasonalMean=0;this.baselineAnnualMean=0;this.referenceResponse=new FairResponse(3,DOUBLING,STEP_DAYS/YEAR);
    this.undoStack=[];this.redoStack=[];this.surfaceRevision=0;this.lastEdit=null;
    this.controlAbsorbed=new Float64Array(n);this.controlAlbedo=new Float32Array(n);this.surfaceAbsorbed=new Float32Array(n);this.controlSurfaceAbsorbed=new Float32Array(n);this.clipped=new Uint8Array(n);this.transfer=new Float64Array(6);this.changedCells=new Set();this.absorbed=new Float64Array(n);this.referenceAbsorbed=new Float64Array(n);this.direct=new Float64Array(n);this.diffuse=new Float64Array(n);this.scratch=new Float64Array(n);
    this.albedo=new Float32Array(n);this.fraction=new Float32Array(n);this.net=new Float32Array(n);this.incoming=new Float32Array(n);
    this.sunField=new Float64Array(n);this.volField=new Float64Array(n);this.geoField=new Float64Array(n);this.oceanField=new Float64Array(n);
    this.oceanLookups=new Map();this.sunKey=null;
    this.hourDecay=new Float64Array(n);
    this.hours=0;this.elapsed=0;this.heat=0;this.rolling=new Float64Array(ROLLING_HOURS);this.rollingSum=0;this.rollingIndex=0;this.rollingCount=0;this.history=[];this.dailySums=new Float64Array(8);this.daily=null;this.surfaceRolling=new Float64Array(ROLLING_HOURS);this.surfaceRollingSum=0;
    const input=new Float64Array(11),phase=(seed%360)*Math.PI/180;
    for(let i=0;i<n;i++){
      const lat=this.grid.latitude[i],lon=this.grid.longitude[i],land=this.landSlots[i]>=0,t=BASE_TEMPERATURE-40*(Math.sin(lat)**2-1/3);
      this.referenceT[i]=t;this.capacity[i]=land?2e7:2.1e8;this.hourDecay[i]=Math.exp(-this.responses[1].feedback*HOUR/this.capacity[i]);
      this.referenceMean+=this.referenceT[i]*this.grid.area[i]/(4*Math.PI);
      const factor=clamp(.85+.32*Math.sin(3*lon+lat+phase)*Math.cos(4*lat)+.18*Math.sin(8*lon-5*lat+phase),.25,1.6);
      this.baseScatter[i]=factor;this.scatterFactor[i]=factor;
      if(!land){
        this.ice[i]=boundary.oceanIce(lat,lon,month,fraction);this.boundaryFlags[i]=boundary.flags;
        this.kinds[i]=this.ice[i]>=.15?1:0;continue;
      }
      boundary.landInputs(lat,lon,month,fraction,input);this.boundaryFlags[i]=boundary.flags;
      const offset=this.landSlots[i]*11;this.landInputs.set(input,offset);
      this.refreshLand(i);
    }
    // Bounded copies for the unchanged reference and exact surface restoration.
    // The radiation reference must never follow the user's vegetation edits.
    this.baseLandInputs=this.landInputs.slice();this.referenceCoefficients=this.coefficients.slice();
  }
  refreshLand(index) {
    const slot=this.landSlots[index],p=this.landInputs.subarray(slot*11,slot*11+11),coefficients=brdf(p);
    this.kinds[index]=p[9]/(p[9]+.05)>=.5?5:Math.max(p[0],p[1])<.15?4:p[0]>=p[1]?2:3;
    for(let k=0;k<3;k++)this.coefficients[slot*3+k]=.5395*coefficients[k]+.4689*coefficients[k+3];
  }
  editLand(index,mode,weight=1,value) {
    if(!LAND_MODES.has(mode))return false;
    const slot=this.landSlots[index];if(slot<0)return false;
    const offset=slot*11,p=this.landInputs.subarray(offset,offset+11),total=p[0]+p[1];
    const high=p[0],low=p[1],height=p[6],highLai=p[7],lowLai=p[8],snow=p[9];
    let changed=false;
    if(mode==='low-vegetation'&&total>0){
      p[0]*=1-weight;p[1]=total-p[0];p[7]*=1-weight;p[8]+=(2-p[8])*weight;
    }else if(mode==='high-vegetation'&&total>0){
      p[1]*=1-weight;p[0]=total-p[1];p[8]*=1-weight;p[7]+=(5-p[7])*weight;
    }else if(mode==='bare-ground'){
      p[0]*=1-weight;p[1]*=1-weight;p[7]*=1-weight;p[8]*=1-weight;
    }else if(mode==='snow-cover')p[9]+=(Math.max(p[9],.15)-p[9])*weight;
    else if(mode==='raise-terrain'||mode==='lower-terrain')p[6]=clamp(p[6]+(mode==='raise-terrain'?100:-100)*weight,0,9000);
    else if(mode==='land-inputs'){
      // Apply only explicitly changed fields. Display rounding must never
      // rewrite untouched source inputs or create an unrequested forcing.
      for(const [key,next] of Object.entries(value)){const field=LAND_FIELDS[key][0];changed=changed||p[field]!==Math.fround(next);p[field]=next;}
    }else if(mode==='restore'){
      const original=this.baseLandInputs.subarray(offset,offset+11);
      for(let field=0;field<11;field++)changed=changed||p[field]!==original[field];
      p.set(original);
    }
    changed=changed||high!==p[0]||low!==p[1]||height!==p[6]||highLai!==p[7]||lowLai!==p[8]||snow!==p[9];
    if(changed){this.refreshLand(index);this.surfaceRevision++;}
    return changed;
  }

  shortwave(day,config,reference=false,target=this.absorbed,capture=!reference) {
    const grid=this.grid,n=grid.count,key=`${day}/${config.eccentricity}/${config.tilt}/${config.wind}`;
    if(key!==this.sunKey){
      let lookup=this.oceanLookups.get(config.wind);
      if(!lookup){
        lookup=Float64Array.from({length:4097},(_,i)=>directOcean(i/4096,config.wind));
        // Keep at most the fixed reference wind and the current experiment wind.
        for(const wind of this.oceanLookups.keys())if(wind!==DEFAULTS.wind)this.oceanLookups.delete(wind);
        this.oceanLookups.set(config.wind,lookup);
      }
      this.orbital=hourlySun(grid,day,config,this.sunField,this.volField,this.geoField,this.oceanField,lookup);this.sunKey=key;
    }
    const oceanWhite=diffuseOcean(config.wind),screening=config.screening??1,transmission=1-.25*screening,atmosphericReflection=.2*screening;
    for(let i=0;i<n;i++){
      const radiation=this.sunField[i],f=clamp(config.scatter*(reference?this.baseScatter[i]:this.scatterFactor[i]),0,.95);
      this.direct[i]=transmission*radiation*(1-f);this.diffuse[i]=transmission*radiation*f;
    }
    const diffuse=gaussianScatter(this.diffuse,grid,this.edges,config.width,this.scratch);
    const kernel=!reference&&config.landKernel==='cack'&&this.cack?this.cack.factors(day):null;
    for(let i=0;i<n;i++){
      const slot=this.landSlots[i];let black,white;
      if(slot<0){const ice=this.ice[i];black=(1-ice)*this.oceanField[i]+ice*.6;white=(1-ice)*oceanWhite+ice*.6;}
      else{
        const coefficients=reference?this.referenceCoefficients:this.coefficients,offset=slot*3,iso=coefficients[offset],v=coefficients[offset+1],g=coefficients[offset+2];
        black=iso+this.volField[i]*v+this.geoField[i]*g;white=iso+.189184*v-1.377622*g;
      }
      if(!reference&&Number.isFinite(this.override[i]))black=white=this.override[i];
      const flux=reflectedFlux(this.direct[i],diffuse[i],black,white,screening,this.transfer),incoming=flux[0];
      // Atmospheric reflection escapes directly; transmitted surface reflection
      // escapes after a convergent series of atmosphere/surface bounces.
      target[i]=this.sunField[i]*(1-atmosphericReflection)-flux[3];
      if(kernel&&slot>=0&&this.physicalChanged[i]){
        const o=slot*3,c=this.referenceCoefficients;
        // Isolate the albedo intervention under identical edited illumination.
        // Keep any scattering-only effect in the illustrative baseline budget.
        const original=reflectedFlux(this.direct[i],diffuse[i],c[o]+this.volField[i]*c[o+1]+this.geoField[i]*c[o+2],c[o]+.189184*c[o+1]-1.377622*c[o+2],screening,this.transferControl);
        const illumination=(this.direct[i]+diffuse[i])/transmission;
        // CACK already contains all-sky screening: replace, never multiply,
        // the two-stream albedo contribution. Its monthly mean is distributed
        // over the hourly sunlight cycle relative to reference monthly insolation.
        target[i]=this.sunField[i]*(1-atmosphericReflection)-original[3]-kernel[i]*illumination*(flux[5]-original[5]);
      }
      if(capture){this.incoming[i]=incoming;this.albedo[i]=flux[5];this.surfaceAbsorbed[i]=flux[2];this.clipped[i]=flux[4];this.fraction[i]=incoming>0?(incoming-this.direct[i])/incoming:clamp(config.scatter*this.scatterFactor[i],0,.95);}
    }
  }
  async initialize(yieldProgress=async()=>{}) {
    // Resolve 24 solar phases at each of 48 seasons for startup quadrature.
    // Only one daily mean and one thermal cycle buffer are retained, not frames.
    const n=this.grid.count,B=this.responses[1].feedback,interval=YEAR*DAY/48,decay=new Float64Array(n),cycle=new Float64Array(n),dailyMean=new Float64Array(n),annualSamples=new Float64Array(48);
    for(let i=0;i<n;i++)decay[i]=Math.exp(-B*interval/this.capacity[i]);
    for(let k=0;k<48;k++){
      dailyMean.fill(0);
      for(let hour=0;hour<24;hour++){
        this.shortwave(this.startDay+(k+.5)*YEAR/48+(hour+.5)/24,DEFAULTS,true,this.referenceAbsorbed);
        for(let i=0;i<n;i++)dailyMean[i]+=this.referenceAbsorbed[i]/24;
        if(hour%6===5)await yieldProgress((k+(hour+1)/24)/49);
      }
      for(let i=0;i<n;i++){
        const q=dailyMean[i];this.baselineAnnual[i]+=q/48;
        cycle[i]=cycle[i]*decay[i]+q/B*(1-decay[i]);
        annualSamples[k]+=q*this.grid.area[i]/(4*Math.PI);
      }
    }
    for(let i=0;i<n;i++){
      const weight=this.grid.area[i]/(4*Math.PI);
      this.seasonalT[i]=cycle[i]/(-Math.expm1(-B*YEAR*DAY/this.capacity[i]))-this.baselineAnnual[i]/B;
      this.seasonalMean+=this.seasonalT[i]*weight;this.baselineAnnualMean+=this.baselineAnnual[i]*weight;
    }
    // Regional land/ocean buckets have different lags. Their seasonal mean is
    // not the global FaIR response; keep only their spatial pattern.
    const periodic=new FairResponse(3,DOUBLING,1/48);
    periodic.initializePeriodic(annualSamples.map(q=>q-this.baselineAnnualMean));
    this.referenceResponse.temperature.set(periodic.temperature);
    // Add a periodic diurnal perturbation at the startup season. This is a
    // seasonal-plus-diurnal approximation, not an hourly historical spin-up.
    cycle.fill(0);dailyMean.fill(0);const diurnalSamples=new Float64Array(24);let dailyGlobal=0;
    for(let hour=0;hour<24;hour++){
      this.shortwave(this.startDay+(hour+.5)/24,DEFAULTS,true,this.referenceAbsorbed);
      for(let i=0;i<n;i++){
        const q=this.referenceAbsorbed[i],d=this.hourDecay[i];
        dailyMean[i]+=q/24;cycle[i]=cycle[i]*d+q/B*(1-d);
        diurnalSamples[hour]+=q*this.grid.area[i]/(4*Math.PI);
      }
      dailyGlobal+=diurnalSamples[hour]/24;
      if(hour%6===5)await yieldProgress((48+(hour+1)/24)/49);
    }
    this.seasonalMean=0;
    for(let i=0;i<n;i++){
      this.seasonalT[i]+=cycle[i]/(-Math.expm1(-B*DAY/this.capacity[i]))-dailyMean[i]/B;
      this.seasonalMean+=this.seasonalT[i]*this.grid.area[i]/(4*Math.PI);
    }
    const diurnal=new FairResponse(3,DOUBLING,STEP_DAYS/YEAR);
    diurnal.initializePeriodic(diurnalSamples.map(q=>q-dailyGlobal));
    for(let layer=0;layer<3;layer++)this.referenceResponse.temperature[layer]+=diurnal.temperature[layer];
    // A deliberate equilibrium-at-present-CO2 starting state, not historical Earth.
    const F=forcing(this.config.co2);for(const response of [...this.responses,...this.controlResponses])response.equilibrate(F);
    this.localAnomaly.fill(F/B);this.localControl.fill(F/B);this.localMean=this.controlMean=F/B;
    this.diagnose();this.record();
  }
  calculate(day) {
    const same=['eccentricity','tilt','scatter','width','wind','screening'].every(key=>this.config[key]===DEFAULTS[key]);
    this.shortwave(this.startDay+day,DEFAULTS,true,this.referenceAbsorbed,same);
    if(same)this.controlAbsorbed.set(this.referenceAbsorbed);
    else this.shortwave(this.startDay+day,this.config,true,this.controlAbsorbed,true);
    this.controlAlbedo.set(this.albedo);this.controlSurfaceAbsorbed.set(this.surfaceAbsorbed);
    if(this.changedCells.size===0)this.absorbed.set(this.controlAbsorbed);
    else this.shortwave(this.startDay+day,this.config,false,this.absorbed);

  }
  step(diagnose=true) {
    this.calculate((this.hours+.5)/24);const F=forcing(this.config.co2),n=this.grid.count,B=this.responses[1].feedback;let referenceForcing=0,shortwaveForcing=0,controlForcing=0,localMean=0,controlMean=0,seasonalMean=0,incoming=0,absorbed=0;
    for(let i=0;i<n;i++){
      const previous=this.seasonalT[i],referenceForce=this.referenceAbsorbed[i]-this.baselineAnnual[i],weight=this.grid.area[i]/(4*Math.PI),decay=this.hourDecay[i];
      const referenceEquilibrium=referenceForce/B;
      this.seasonalT[i]=referenceEquilibrium+(previous-referenceEquilibrium)*decay;
      const delta=this.absorbed[i]-this.referenceAbsorbed[i];shortwaveForcing+=delta*weight;
      const controlDelta=this.controlAbsorbed[i]-this.referenceAbsorbed[i];controlForcing+=controlDelta*weight;
      const controlEquilibrium=(controlDelta+F)/B;
      this.localControl[i]=controlEquilibrium+(this.localControl[i]-controlEquilibrium)*decay;controlMean+=this.localControl[i]*weight;
      incoming+=this.sunField[i]*weight;absorbed+=this.absorbed[i]*weight;
      const equilibrium=(delta+F)/B;
      this.localAnomaly[i]=equilibrium+(this.localAnomaly[i]-equilibrium)*decay;localMean+=this.localAnomaly[i]*weight;
      seasonalMean+=this.seasonalT[i]*weight;referenceForcing+=referenceForce*weight;
    }
    this.localMean=localMean;this.controlMean=controlMean;this.seasonalMean=seasonalMean;
    const previousReferenceHeat=this.referenceResponse.heat();this.referenceResponse.step(referenceForcing);
    const central=this.responses[1],control=this.controlResponses[1],previousHeat=central.heat(),previousControlHeat=control.heat();for(const response of this.responses)response.step(shortwaveForcing+F);for(const response of this.controlResponses)response.step(controlForcing+F);
    const energy=(this.referenceResponse.heat()-previousReferenceHeat+central.heat()-previousHeat)*YEAR*DAY*4*Math.PI*RADIUS*RADIUS;
    this.heat+=energy;this.hours++;this.elapsed=this.hours/24;
    const net=energy/(HOUR*4*Math.PI*RADIUS*RADIUS),surfaceForcing=shortwaveForcing-controlForcing;
    const editNet=(central.heat()-previousHeat-control.heat()+previousControlHeat)*YEAR*DAY/HOUR;
    const flux=[incoming,absorbed,incoming-absorbed,absorbed-net,net,shortwaveForcing,surfaceForcing,editNet];
    for(let j=0;j<8;j++)this.dailySums[j]+=flux[j];
    if(this.hours%24===0){this.daily={hours:24,startHour:this.hours-24,endHour:this.hours,incoming:this.dailySums[0]/24,absorbed:this.dailySums[1]/24,reflected:this.dailySums[2]/24,outgoing:this.dailySums[3]/24,imbalance:this.dailySums[4]/24,shortwaveForcing:this.dailySums[5]/24,surfaceForcing:this.dailySums[6]/24,surfaceImbalance:this.dailySums[7]/24};this.dailySums.fill(0);}
    if(this.rollingCount===ROLLING_HOURS)this.surfaceRollingSum-=this.surfaceRolling[this.rollingIndex];
    this.surfaceRolling[this.rollingIndex]=surfaceForcing;this.surfaceRollingSum+=surfaceForcing;
    if(this.rollingCount===ROLLING_HOURS)this.rollingSum-=this.rolling[this.rollingIndex];else this.rollingCount++;
    this.rolling[this.rollingIndex]=energy/(HOUR*4*Math.PI*RADIUS*RADIUS);this.rollingSum+=this.rolling[this.rollingIndex];this.rollingIndex=(this.rollingIndex+1)%ROLLING_HOURS;
    if(diagnose||this.hours%720===0)this.diagnose();
    if(this.hours%720===0)this.record();
  }
  diagnose(refresh=true) {
    if(refresh)this.calculate(this.elapsed);
    const F=forcing(this.config.co2),means=this.responses.map(response=>response.temperature[0]),referenceSeason=this.referenceResponse.temperature[0];let incoming=0,absorbed=0,referenceNet=0,perturbedNet=0,scatter=0,albedo=0;
    for(let i=0;i<this.grid.count;i++){
      const weight=this.grid.area[i]/(4*Math.PI),baselineN=this.referenceAbsorbed[i]-this.baselineAnnual[i]-this.responses[1].feedback*(this.seasonalT[i]-this.seasonalMean+referenceSeason);
      const anomaly=this.localAnomaly[i]-this.localMean+means[1];
      const deltaN=this.absorbed[i]-this.referenceAbsorbed[i]+F-this.responses[1].feedback*anomaly;
      this.net[i]=baselineN+deltaN;
      incoming+=this.sunField[i]*weight;absorbed+=this.absorbed[i]*weight;referenceNet+=baselineN*weight;perturbedNet+=deltaN*weight;
      scatter+=this.fraction[i]*weight;albedo+=(this.sunField[i]-this.absorbed[i])*weight;
    }
    const shortwaveForcing=perturbedNet-F+this.responses[1].feedback*means[1];
    const globalPerturbation=this.responses[1].imbalance(shortwaveForcing+F),globalReference=this.referenceResponse.imbalance(referenceNet+this.referenceResponse.feedback*referenceSeason);
    // FaIR efficacy contributes to TOA imbalance. Centre the illustrative local
    // pattern on the global thermal budget, including this energy term.
    const correction=globalPerturbation+globalReference-perturbedNet-referenceNet;
    for(let i=0;i<this.grid.count;i++)this.net[i]+=correction;
    perturbedNet=globalPerturbation;referenceNet=globalReference;
    const edits=this.responses.map((response,i)=>response.temperature[0]-this.controlResponses[i].temperature[0]),central=this.responses[1],control=this.controlResponses[1];
    let surfaceForcing=0;for(let i=0;i<this.grid.count;i++)surfaceForcing+=(this.absorbed[i]-this.controlAbsorbed[i])*this.grid.area[i]/(4*Math.PI);
    const layerHeat=central.capacity.map((capacity,i)=>capacity*(central.temperature[i]-control.temperature[i])*YEAR*DAY*4*Math.PI*RADIUS*RADIUS/1e21);
    this.metrics={surfaceWarming:edits[1],surfaceLower:Math.min(...edits),surfaceUpper:Math.max(...edits),surfaceForcing,surfaceImbalance:central.imbalance(shortwaveForcing+F)-control.imbalance(shortwaveForcing-surfaceForcing+F),controlWarming:control.temperature[0],layerHeat,surfaceHeat:layerHeat.reduce((sum,x)=>sum+x,0),undoCount:this.undoStack.length,redoCount:this.redoStack.length,daily:this.daily,annualSurfaceForcing:this.rollingCount===ROLLING_HOURS?(this.surfaceRollingSum-this.surfaceRolling[this.rollingIndex]*(ROLLING_HOURS-YEAR_HOURS))/YEAR_HOURS:null,day:this.elapsed,hours:this.hours,temperature:BASE_TEMPERATURE+referenceSeason+means[1],referenceSeason,warming:means[1],lower:Math.min(...means),upper:Math.max(...means),scenarioWarming:means,
      incoming,absorbed,reflected:incoming-absorbed,outgoing:absorbed-referenceNet-perturbedNet,imbalance:referenceNet+perturbedNet,perturbation:perturbedNet,
      boundary:this.boundaryInfo,kernel:this.cack?.source.sha256??null,forcing:F,shortwaveForcing,layers:Array.from(this.responses[1].temperature),scatter,albedo:incoming>0?albedo/incoming:0,heat:this.heat/1e21,annual:this.rollingCount===ROLLING_HOURS?(this.rollingSum-this.rolling[this.rollingIndex]*(ROLLING_HOURS-YEAR_HOURS))/YEAR_HOURS:null,orbital:this.orbital};
  }
  temperatureAt(index) {
    return BASE_TEMPERATURE+this.referenceT[index]-this.referenceMean+this.seasonalT[index]-this.seasonalMean+this.referenceResponse.temperature[0]+this.localAnomaly[index]-this.localMean+this.responses[1].temperature[0];
  }
  record() {
    // Monthly summaries, bounded history: temperatures, not per-cell snapshots.
    if(this.hours%720===0){const m=this.metrics;this.history.push([m.day,m.warming,m.lower,m.upper,m.perturbation,m.imbalance,m.heat,m.surfaceWarming,m.surfaceLower,m.surfaceUpper,m.surfaceForcing,m.surfaceHeat]);if(this.history.length>1200)this.history.shift();}
  }
  regionCells(latitude,longitude,radius=350,landOnly=false) {
    if(!Number.isFinite(latitude)||latitude<-Math.PI/2||latitude>Math.PI/2||!Number.isFinite(longitude)||!Number.isFinite(radius)||radius<=0||radius>20000)throw new Error('Invalid region coordinates or radius');
    const limit=Math.min(Math.PI,radius*1000/RADIUS),cosLimit=Math.cos(limit),s=Math.sin(latitude),c=Math.cos(latitude),grid=this.grid,result=[];
    const first=clamp(Math.floor((latitude-limit+Math.PI/2)/grid.dphi),0,grid.rows-1),last=clamp(Math.floor((latitude+limit+Math.PI/2)/grid.dphi),0,grid.rows-1);
    for(let row=first;row<=last;row++){
      const lat=grid.latitudes[row],sr=Math.sin(lat),cr=Math.cos(lat);
      for(let i=grid.offsets[row];i<grid.offsets[row+1];i++){
        if(landOnly&&this.landSlots[i]<0)continue;
        if(s*sr+c*cr*Math.cos(grid.longitude[i]-longitude)>cosLimit)result.push(i);
      }
    }
    return Uint32Array.from(result);
  }
  captureEdits(indices) {
    const values=new Float32Array(indices.length*13);
    for(let j=0;j<indices.length;j++){
      const i=indices[j],slot=this.landSlots[i],offset=j*13;
      if(slot>=0)values.set(this.landInputs.subarray(slot*11,slot*11+11),offset);
      values[offset+11]=this.override[i];values[offset+12]=this.scatterFactor[i];
    }
    return values;
  }
  trackCell(i) {
    const slot=this.landSlots[i];let physical=Number.isFinite(this.override[i]);
    if(slot>=0)for(let k=0;k<11;k++)physical=physical||this.landInputs[slot*11+k]!==this.baseLandInputs[slot*11+k];
    this.physicalChanged[i]=physical?1:0;const changed=physical||this.scatterFactor[i]!==this.baseScatter[i];
    if(changed)this.changedCells.add(i);else this.changedCells.delete(i);
  }
  restoreEdits(indices,values) {
    for(let j=0;j<indices.length;j++){
      const i=indices[j],slot=this.landSlots[i],offset=j*13;
      if(slot>=0){this.landInputs.set(values.subarray(offset,offset+11),slot*11);this.refreshLand(i);}
      this.override[i]=values[offset+11];this.scatterFactor[i]=values[offset+12];this.trackCell(i);
    }
    this.surfaceRevision++;this.diagnose();
  }
  edit({latitude,longitude,radius=350,mode,value,index}) {
    const physical=mode==='land-region'?'land-inputs':mode,landOnly=LAND_MODES.has(physical)&&physical!=='restore';
    const single=Number.isInteger(index)&&mode!=='land-region';
    if(single&&(index<0||index>=this.grid.count))throw new Error('Invalid tile');
    if(mode==='land-region'){
      if(!Number.isInteger(index)||index<0||index>=this.grid.count)throw new Error('Select a region centre');
      latitude=this.grid.latitude[index];longitude=this.grid.longitude[index];
    }
    const indices=single?Uint32Array.of(index):this.regionCells(latitude,longitude,radius,landOnly);
    if(physical==='land-inputs'){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([key,next])=>!Object.hasOwn(LAND_FIELDS,key)||!Number.isFinite(next)||next<LAND_FIELDS[key][1]||next>LAND_FIELDS[key][2]))throw new Error('Invalid land input value: check the displayed limits');
      for(const i of indices){
        const slot=this.landSlots[i];if(slot<0)throw new Error('Select land to edit learned albedo inputs');
        if((value.high??this.landInputs[slot*11])+(value.low??this.landInputs[slot*11+1])>1+1e-7)throw new Error('Cover must total at most 100% in every selected tile');
      }
      if(!Object.keys(value).length){this.lastEdit={mode,changedCells:0,area:0};return;}
    }
    if(mode==='albedo'&&!Number.isNaN(value)&&(!Number.isFinite(value)||value<0||value>1))throw new Error('Albedo must be a number from 0 to 1, or blank for the scheme');
    if(mode==='scatter'&&single&&(!Number.isFinite(value)||value<0||value>3))throw new Error('Scattering multiplier must be a number from 0 to 3');
    if(!LAND_MODES.has(physical)&&!['albedo','scatter','clear','brighten','darken'].includes(mode))throw new Error('Unknown surface edit');
    const before=this.captureEdits(indices),limit=radius*1000/RADIUS,edge=Math.exp(-4.5);let changedCells=0,area=0;
    for(const i of indices){
      let weight=1;
      if(!single&&mode!=='land-region'){
        const cosine=clamp(Math.sin(latitude)*Math.sin(this.grid.latitude[i])+Math.cos(latitude)*Math.cos(this.grid.latitude[i])*Math.cos(this.grid.longitude[i]-longitude),-1,1);
        weight=(Math.exp(-4.5*(Math.acos(cosine)/limit)**2)-edge)/(1-edge);
      }
      if(mode==='albedo')this.override[i]=Number.isNaN(value)?NaN:value;
      else if(mode==='scatter')this.scatterFactor[i]=single?value:clamp(this.scatterFactor[i]+.2*weight,0,3);
      else if(mode==='clear')this.scatterFactor[i]=clamp(this.scatterFactor[i]-.2*weight,0,3);
      else if(mode==='brighten'||mode==='darken'){const a=Number.isFinite(this.override[i])?this.override[i]:this.albedo[i];this.override[i]=clamp(a+(mode==='brighten'?1:-1)*.08*weight);}
      else if(mode==='restore'){this.override[i]=NaN;this.scatterFactor[i]=this.baseScatter[i];}
      this.editLand(i,physical,weight,value);
      if(LAND_MODES.has(physical)&&this.landSlots[i]>=0)this.override[i]=NaN;
      this.trackCell(i);
    }
    const after=this.captureEdits(indices),changed=[];
    for(let j=0;j<indices.length;j++)if(!before.subarray(j*13,j*13+13).every((value,k)=>Object.is(value,after[j*13+k]))){changed.push(j);changedCells++;area+=this.grid.area[indices[j]];}
    if(changed.length){
      const changedIndices=Uint32Array.from(changed,j=>indices[j]),oldValues=new Float32Array(changed.length*13),newValues=new Float32Array(changed.length*13);
      for(let j=0;j<changed.length;j++){oldValues.set(before.subarray(changed[j]*13,changed[j]*13+13),j*13);newValues.set(after.subarray(changed[j]*13,changed[j]*13+13),j*13);}
      const entry={indices:changedIndices,before:oldValues,after:newValues,bytes:changedIndices.byteLength+oldValues.byteLength+newValues.byteLength};
      if(entry.bytes<=4*1024*1024)this.undoStack.push(entry);else this.undoStack.length=0;this.redoStack.length=0;
      let bytes=this.undoStack.reduce((sum,e)=>sum+e.bytes,0);while(this.undoStack.length>1&&(bytes>4*1024*1024||this.undoStack.length>24))bytes-=this.undoStack.shift().bytes;
    }
    this.lastEdit={mode,changedCells,area:area*RADIUS*RADIUS/1e6};this.diagnose();
  }
  undo(redo=false) {
    const from=redo?this.redoStack:this.undoStack,to=redo?this.undoStack:this.redoStack,entry=from.pop();
    if(!entry)return;to.push(entry);this.restoreEdits(entry.indices,redo?entry.after:entry.before);
    this.lastEdit={mode:redo?'redo':'undo',changedCells:entry.indices.length,area:0};
  }
  surfaceSetup(name='My surface experiment') {
    return {modelVersion:MODEL_VERSION,format:'reflect-surface-1',name:String(name).slice(0,80),boundaryCommit:this.boundaryInfo.commit,kernelSha:this.cack?.source.sha256??null,config:{...this.config,seed:this.seed,spacing:this.grid.spacing,startDay:this.startDay,startHour:0},edits:Array.from(this.changedCells,i=>({index:i,inputs:this.landSlots[i]>=0?Array.from(this.landInputs.subarray(this.landSlots[i]*11,this.landSlots[i]*11+11)):null,albedo:Number.isFinite(this.override[i])?this.override[i]:null,scatter:this.scatterFactor[i]}))};
  }
  loadSurface(edits) {
    if(!Array.isArray(edits)||edits.length>this.grid.count)throw new Error('Invalid saved surface');
    const seen=new Set();
    for(const edit of edits){
      const i=edit.index;if(!Number.isInteger(i)||i<0||i>=this.grid.count||seen.has(i))throw new Error('Invalid saved tile');seen.add(i);
      if(edit.albedo!==null&&(!Number.isFinite(edit.albedo)||edit.albedo<0||edit.albedo>1)||!Number.isFinite(edit.scatter)||edit.scatter<0||edit.scatter>3)throw new Error('Invalid saved albedo or scattering');
      if(this.landSlots[i]>=0){
        if(!Array.isArray(edit.inputs)||edit.inputs.length!==11)throw new Error('Saved land inputs are missing');
        for(const [k,min,max] of Object.values(LAND_FIELDS))if(!Number.isFinite(edit.inputs[k])||edit.inputs[k]<min||edit.inputs[k]>max)throw new Error('Invalid saved land inputs');
        if(edit.inputs[0]+edit.inputs[1]>1+1e-7)throw new Error('Invalid saved vegetation cover');
      }else if(edit.inputs!==null)throw new Error('Saved ocean tile contains land inputs');
    }
    for(const edit of edits){const i=edit.index,slot=this.landSlots[i];if(slot>=0){this.landInputs.set(edit.inputs,slot*11);this.refreshLand(i);}this.override[i]=edit.albedo===null?NaN:edit.albedo;this.scatterFactor[i]=edit.scatter;this.trackCell(i);}
    this.surfaceRevision++;this.undoStack.length=this.redoStack.length=0;this.diagnose();
  }
  inspect(index) {
    if(index<0||index>=this.grid.count)return null;
    const offset=this.landSlots[index]*11;
    return {inputs:offset>=0?Array.from(this.landInputs.subarray(offset,offset+11)):null,referenceInputs:offset>=0?Array.from(this.baseLandInputs.subarray(offset,offset+11)):null,shortwaveChange:this.absorbed[index]-this.controlAbsorbed[index],albedoChange:this.albedo[index]-this.controlAlbedo[index],surfaceShortwaveChange:this.surfaceAbsorbed[index]-this.controlSurfaceAbsorbed[index],clipped:Boolean(this.clipped[index]),globalContribution:(this.absorbed[index]-this.controlAbsorbed[index])*this.grid.area[index]/(4*Math.PI),ice:this.ice[index],boundaryFlags:this.boundaryFlags[index],boundary:this.boundaryInfo,index,latitude:this.grid.latitude[index]*180/Math.PI,longitude:this.grid.longitude[index]*180/Math.PI,kind:this.kinds[index],area:this.grid.area[index]*RADIUS*RADIUS/1e6,
      albedo:this.albedo[index],override:Number.isFinite(this.override[index])?this.override[index]:null,factor:this.scatterFactor[index],diffuse:this.fraction[index],temperature:this.temperatureAt(index),incoming:this.incoming[index],net:this.net[index]};
  }
  frame(target=new Float32Array(this.grid.count*8)) {
    for(let i=0;i<this.grid.count;i++){const j=i*8;target[j]=this.temperatureAt(i);target[j+1]=this.albedo[i];target[j+2]=this.fraction[i];target[j+3]=this.net[i];target[j+4]=this.localAnomaly[i]-this.localMean+this.responses[1].temperature[0];target[j+5]=this.albedo[i]-this.controlAlbedo[i];target[j+6]=this.surfaceAbsorbed[i]-this.controlSurfaceAbsorbed[i];target[j+7]=this.localAnomaly[i]-this.localMean-(this.localControl[i]-this.controlMean)+this.responses[1].temperature[0]-this.controlResponses[1].temperature[0];}
    return target;
  }
}
