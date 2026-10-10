import { Planet } from './globe-model.mjs';
import { loadBoundary } from './globe-boundary.mjs';
let planet=null,generation=0,pool=[],selected=-1,surfaceRevision=0;
const OUTPUT_HOURS=24;
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function snapshot(type='frame',brushEdit=false,completedHours=0) {
  let buffer=pool.pop();if(!buffer||buffer.byteLength!==planet.grid.count*20)buffer=new ArrayBuffer(planet.grid.count*20);
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
      const id=++generation;planet=null;pool=[];selected=-1;surfaceRevision=0;
      postMessage({type:'loading'});
      let boundary=await loadBoundary();
      if(id!==generation)return;
      const next=new Planet({...message.config,boundary});
      boundary=null; // Source buffers can be released after caching C45 inputs/BRDFs.
      await next.initialize(async progress=>{postMessage({type:'progress',progress});await pause();});
      if(id!==generation)return;planet=next;
      const kinds=planet.kinds.slice(),ice=planet.ice.slice();postMessage({type:'grid',spacing:planet.grid.spacing,count:planet.grid.count,kinds,ice},[kinds.buffer,ice.buffer]);snapshot('ready');return;
    }
    if(!planet)return;
    if(message.type==='configure'){Object.assign(planet.config,message.config);planet.diagnose();snapshot();}
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
    if(message.type==='edit'){planet.edit(message.edit);selected=message.edit.index??selected;snapshot('edited',Boolean(message.brushEdit));}
    if(message.type==='inspect'){selected=message.index;planet.diagnose();snapshot('inspected');}
  }catch(error){
    // Rejected user edits leave the valid climate state running and release
    // brush backpressure; they must not disable the entire experiment.
    if(message.type==='edit')postMessage({type:'edit-error',message:error.message,index:message.edit.index,brushEdit:Boolean(message.brushEdit)});
    else postMessage({type:'error',message:error.message});
  }
};
