import { Planet } from './globe-model.mjs';
let planet=null,generation=0,pool=[],selected=-1;
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function snapshot(type='frame') {
  let buffer=pool.pop();if(!buffer||buffer.byteLength!==planet.grid.count*20)buffer=new ArrayBuffer(planet.grid.count*20);
  const fields=planet.frame(new Float32Array(buffer));
  postMessage({type,fields,metrics:planet.metrics,history:planet.history,inspection:planet.inspect(selected)},[buffer]);
}
self.onmessage=async({data:message})=>{
  try{
    if(message.type==='recycle'){if(pool.length<2)pool.push(message.buffer);return;}
    if(message.type==='initialize'){
      const id=++generation;planet=null;pool=[];selected=-1;
      const response=await fetch(new URL('../../data/reflect/land-mask.bin',import.meta.url));
      if(!response.ok)throw new Error('Could not load the Earth land–ocean mask');
      const landMask=new Uint8Array(await response.arrayBuffer());
      if(id!==generation)return;
      const next=new Planet({...message.config,landMask});
      await next.initialize(async progress=>{postMessage({type:'progress',progress});await pause();});
      if(id!==generation)return;planet=next;
      const kinds=planet.kinds.slice();postMessage({type:'grid',spacing:planet.grid.spacing,count:planet.grid.count,kinds},[kinds.buffer]);snapshot('ready');return;
    }
    if(!planet)return;
    if(message.type==='configure'){Object.assign(planet.config,message.config);planet.diagnose();snapshot();}
    if(message.type==='advance'){
      const id=generation,model=planet;
      // Bounded batches yield control so edits and pause stay responsive.
      for(let k=0;k<Math.min(32,Math.max(0,Math.floor(message.days)));k++){if(id!==generation)return;model.step();}
      snapshot('advanced');
    }
    if(message.type==='edit'){planet.edit(message.edit);selected=message.edit.index??selected;snapshot();}
    if(message.type==='inspect'){selected=message.index;postMessage({type:'inspection',inspection:planet.inspect(selected)});}
  }catch(error){postMessage({type:'error',message:error.message});}
};
