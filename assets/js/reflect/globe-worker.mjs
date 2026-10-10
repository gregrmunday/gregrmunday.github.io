import { sensitivity } from './sensitivity.mjs';
import { Planet, LAND_FIELDS } from './globe-model.mjs';
import { loadBoundary } from './globe-boundary.mjs';
import { loadCack } from './cack-kernel.mjs';
import { loadScatterModule } from './scatter-kernel.mjs';
let planet=null,generation=0,pool=[],selected=-1,surfaceRevision=0,analysisId=0;
const OUTPUT_HOURS=24;
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function snapshot(type='frame',brushEdit=false,completedHours=0) {
  let buffer=pool.pop();if(!buffer||buffer.byteLength!==planet.grid.count*32)buffer=new ArrayBuffer(planet.grid.count*32);
  const fields=planet.frame(new Float32Array(buffer));
  const message={type,fields,metrics:planet.metrics,history:planet.history,inspection:planet.inspect(selected),completedHours},transfers=[buffer];
  if(surfaceRevision!==planet.surfaceRevision){message.kinds=planet.kinds.slice();transfers.push(message.kinds.buffer);surfaceRevision=planet.surfaceRevision;}
  if(type==='edited'){message.editSummary=planet.lastEdit;message.brushEdit=brushEdit;}
  postMessage(message,transfers);
}
self.onmessage=async({data:message})=>{
  try{
    if(message.type==='recycle'){if(pool.length<2)pool.push(message.buffer);return;}
    if(message.type==='initialize'){
      analysisId++;
      const id=++generation;planet=null;pool=[];selected=-1;surfaceRevision=0;
      postMessage({type:'loading'});
      let [boundary,cack,scatterModule]=await Promise.all([loadBoundary(),loadCack(),loadScatterModule()]);
      if(id!==generation)return;
      const next=new Planet({...message.config,boundary,cack,scatterModule});
      boundary=null; // Source buffers can be released after caching learned albedo inputs/BRDFs.
      cack=null;
      await next.initialize(async progress=>{postMessage({type:'progress',progress});await pause();});
      if(id!==generation)return;planet=next;
      const kinds=planet.kinds.slice(),ice=planet.ice.slice();postMessage({type:'grid',spacing:planet.grid.spacing,count:planet.grid.count,kinds,ice},[kinds.buffer,ice.buffer]);snapshot('ready');return;
    }
    if(!planet)return;
    if(message.type==='configure'){analysisId++;Object.assign(planet.config,message.config);planet.diagnose();snapshot();}
    if(message.type==='snapshot'){planet.diagnose();snapshot(message.purpose==='export'?'export-ready':'frame');}
    if(message.type==='advance'){
      const id=generation,model=planet,started=performance.now(),untilOutput=OUTPUT_HOURS-model.hours%OUTPUT_HOURS;
      const requested=Math.min(192,untilOutput,Math.max(0,Math.floor(message.hours)));let completed=0;
      // Yield after a bounded CPU slice, but send only a tiny acknowledgement
      // until a daily output boundary. Every intervening hour is integrated.
      for(;completed<requested;){if(id!==generation)return;model.step(false);completed++;if(performance.now()-started>=32)break;}
      if(message.forceOutput||completed>0&&model.hours%OUTPUT_HOURS===0){model.diagnose();snapshot('advanced',false,completed);}
      else postMessage({type:'advanced',completedHours:completed});
    }
    if(message.type==='edit'){analysisId++;planet.edit(message.edit);selected=message.edit.index??selected;snapshot('edited',Boolean(message.brushEdit));}
    if(message.type==='undo'||message.type==='redo'){analysisId++;planet.undo(message.type==='redo');snapshot('edited');}
    if(message.type==='save-setup')postMessage({type:'saved-setup',setup:planet.surfaceSetup(message.name)});
    if(message.type==='load-surface'){analysisId++;if(message.commit!==planet.boundaryInfo.commit)throw new Error('Saved boundary-data version differs');planet.loadSurface(message.edits);snapshot('loaded-surface');}
    if(message.type==='sensitivity-bounds'){
      const field=LAND_FIELDS[message.key];if(!field||!Number.isInteger(message.index)||message.index<0||message.index>=planet.grid.count)throw new Error('Invalid sensitivity input');
      const indices=planet.regionCells(planet.grid.latitude[message.index],planet.grid.longitude[message.index],message.radius,true);let max=field[2];if(field[0]<2)for(const i of indices)max=Math.min(max,1-planet.landInputs[planet.landSlots[i]*11+1-field[0]]);
      postMessage({type:'sensitivity-bounds',request:message.request,index:message.index,min:field[1],max});
    }
    if(message.type==='sensitivity'){
      const id=++analysisId,model=planet;
      try{const result=await sensitivity(model,message,async progress=>{if(id!==analysisId||model!==planet)throw new Error('Analysis cancelled');postMessage({type:'sensitivity-progress',request:message.request,progress});await pause();});if(id===analysisId)postMessage({type:'sensitivity-result',result});}
      catch(error){postMessage({type:'sensitivity-error',request:message.request,message:error.message});}
    }
    if(message.type==='cancel-analysis')analysisId++;
    if(message.type==='inspect'){selected=message.index;planet.diagnose();snapshot('inspected');}
  }catch(error){
    // Rejected user edits leave the valid climate state running and release
    // brush backpressure; they must not disable the entire experiment.
    if(message.type==='edit')postMessage({type:'edit-error',message:error.message,index:message.edit.index,brushEdit:Boolean(message.brushEdit)});
    else postMessage({type:'error',message:error.message});
  }
};
