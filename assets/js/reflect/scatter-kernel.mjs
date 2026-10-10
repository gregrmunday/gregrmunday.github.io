// Optional native numeric loop. The JS finite-volume solver remains the
// fallback. The module has no runtime dependencies and no growing heap.
export async function loadScatterModule(){
 if(typeof WebAssembly==='undefined')return null;
 try{
  const response=await fetch(new URL('./scatter.wasm',import.meta.url));
  if(!response.ok)return null;
  return await WebAssembly.compile(await response.arrayBuffer());
 }catch{return null;}
}
export class ScatterKernel {
 constructor(module,grid,edges){
  // Compile each bilateral exchange into two row entries g/area. These
  // replace the JS edge arrays; retain only two native Float64 work planes.
  const align=n=>Math.ceil(n/8)*8,n=grid.count,e=edges.left.length,connections=e*2;
  const offsets=0,neighbours=align((n+1)*4),rates=align(neighbours+connections*4);
  const source=rates+connections*8,scratch=source+n*8,pages=Math.ceil((scratch+n*8)/65536);
  const memory=new WebAssembly.Memory({initial:pages,maximum:pages});
  const instance=new WebAssembly.Instance(module,{env:{memory}}),buffer=memory.buffer;
  const rowOffsets=new Uint32Array(buffer,offsets,n+1),indices=new Uint32Array(buffer,neighbours,connections),coefficients=new Float64Array(buffer,rates,connections);
  for(let k=0;k<e;k++){rowOffsets[edges.left[k]+1]++;rowOffsets[edges.right[k]+1]++;}
  for(let i=0;i<n;i++)rowOffsets[i+1]+=rowOffsets[i];
  const cursor=rowOffsets.slice(0,-1);
  for(let k=0;k<e;k++){
   const i=edges.left[k],j=edges.right[k],g=edges.weights[k],a=cursor[i]++,b=cursor[j]++;
   indices[a]=j;coefficients[a]=g/grid.area[i];indices[b]=i;coefficients[b]=g/grid.area[j];
  }
  this.source=new Float64Array(buffer,source,n);this.scratch=new Float64Array(buffer,scratch,n);
  this.scatter=instance.exports.scatter;this.args=[n,offsets,neighbours,rates,source,scratch];
  // No old graph is needed after a successful native compilation. If module
  // loading or setup fails earlier, the original JS graph stays intact.
  delete edges.left;delete edges.right;delete edges.weights;
 }
 apply(values,steps,dt){
  this.source.set(values);
  const result=this.scatter(...this.args,steps,dt);
  values.set(result===this.args[4]?this.source:this.scratch);
  return values;
 }
}
