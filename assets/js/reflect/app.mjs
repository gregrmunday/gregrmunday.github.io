import { STRIDE, FIELDS, clamp, createFrame, evaluateFrame } from './model.mjs';
const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
const palette = [[65,139,162],[190,223,225],[57,106,82],[158,174,104],[186,151,106],[230,235,226]];
const names = ['Ocean','Sea ice','Forest','Grass','Bare soil','Snow'];
const brushKinds = {ocean:0,ice:1,forest:2,grass:3,soil:4,snow:5};
const fieldInfo = [
 ['High vegetation cover',0,1,.01],['Low vegetation cover',0,1,.01],['Topsoil water · m³/m³',0,.6,.01],['Topsoil temperature · K',230,330,1],['Deep-soil water · m³/m³',0,.6,.01],['Deep-soil temperature · K',230,330,1],['Elevation · m',0,3000,10],['High leaf area · m²/m²',0,10,.1],['Low leaf area · m²/m²',0,10,.1],['Snow depth · m',0,2,.01],['Near-surface air · K',230,330,1],['Sea-ice fraction',0,1,.01]
];
let size = 32, data, kinds, selected = -1, brush = 'inspect', view = 'surface', result = null;
let step = 0, running = false, preparing = false, requestId = 0, worldVersion = 0, resultVersion = -1;
let worker = null, polygons = [], geometry = null, frame = null, framePhase = -1, dragging = false, lastPainted = -1, recomputeTimer;
let playbackStart = 0, startStep = 0, resumeWhenReady = false;
let animationHandle = 0, lastDraw = 0, lastUI = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let canvasWidth = 1000, canvasHeight = 690;
function status(message) { $('status').textContent = message; }
function random(seed) { let state = seed >>> 0; return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15,t | 1); t ^= t + Math.imul(t ^ t >>> 7,t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function setSurface(i, kind, randomValue = .5) {
  kinds[i] = kind;
  const o = i * STRIDE, height = data[o + 6];
  const temperature = (kind === 5 || kind === 1 ? 260 : 287) - height * .006;
  const covers = kind === 2 ? [.8,.12] : kind === 3 ? [.02,.85] : [0,0];
  const water = kind === 4 ? .07 : .22 + .08 * randomValue;
  data.set([covers[0],covers[1],water,temperature,water*.9,temperature+2,height,kind===2?3.8:0,kind===3?1.8:.1,kind===5?.2:0,temperature+1,kind===1?1:0],o);
  if (kind < 2) data[o+6] = 0;
}
function generate() {
  pause(); size = Number($('size').value);
  const rng = random(Number($('seed').value) || 0), preset = $('preset').value;
  data = new Float32Array(size * size * STRIDE); kinds = new Uint8Array(size * size);
  const offset = rng() * 5, offset2 = rng() * 5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, u = x/(size-1), v = y/(size-1);
    const rolling = Math.sin(u*6+offset)*Math.cos(v*5+offset2) + .45*Math.sin(u*13+v*9);
    const coast = .22 + .1*Math.sin(v*8+offset);
    let kind, height;
    if (preset === 'coast') { const water = u < coast; height = water ? 0 : 45 + Math.max(0,rolling+.4)*160 + (u-coast)*100; kind = water ? 0 : rolling > .15 ? 2 : rolling < -.4 ? 4 : 3; }
    else if (preset === 'alpine') { height = 100 + 950*Math.pow(Math.abs(Math.sin(u*5+offset)*Math.cos(v*4+offset2)),1.8); kind = height > 720 ? 5 : height > 380 ? 2 : 3; }
    else if (preset === 'polar') { height = u < coast+.15 ? 0 : 80 + Math.max(0,rolling)*220; kind = u < coast ? 0 : u < coast+.15 ? 1 : 5; }
    else { height = 40 + Math.max(0,rolling+.5)*90; kind = rolling > .65 ? 2 : rolling < -.25 ? 4 : 3; }
    data[i*STRIDE+6] = height;
    setSurface(i,kind,rng());
  }
  selected = -1; worldVersion++; step = 0; result = null; geometry = null;
  frame = createFrame(size); framePhase = -1;
  $('tile-hint').textContent = `${(size*size).toLocaleString()} tiles · 100 m per tile`;
  updateInspector(); prepare(false);
}
function workerConfig() { return {data:data.slice(),kinds:kinds.slice(),size,cloud:Number($('cloud').value)/100,scheme:$('scheme').value,terrainShadows:$('shadows').checked,hours:Number($('hours').value)}; }
function prepare(play = false) {
  clearTimeout(recomputeTimer); resumeWhenReady = play; pause();
  preparing = true; $('run').disabled = true; $('run').textContent = 'Calculating…'; $('export').disabled = true;
  $('stage-label').textContent = 'CALCULATING THE LIGHT'; status('Tracing terrain horizons and integrating the day…');
  const id = ++requestId, version = worldVersion;
  if (worker) worker.terminate();
  try {
    worker = new Worker(new URL('./worker.mjs', import.meta.url),{type:'module'});
    worker.onmessage = event => {
      if (event.data.id !== requestId) return;
      if (event.data.error) { calculationFailed(event.data.error); return; }
      result = event.data.result; resultVersion = version; preparing = false; framePhase = -1;
      worker.terminate(); worker = null; $('run').disabled = false;
      $('export').disabled = false; $('stage-label').textContent = 'YOUR LITTLE WORLD';
      $('run').textContent = '▶ Run the day'; update(); draw();
      status('Ready. Paint a surface, inspect a tile, or send the sun across your world.');
      if (resumeWhenReady) start();
    };
    worker.onerror = () => calculationFailed('The background simulation could not start. Try reloading this page.');
    const config = workerConfig(); worker.postMessage({id,config},[config.data.buffer,config.kinds.buffer]);
  } catch (error) { calculationFailed(error.message); }
}
function calculationFailed(message) {
  preparing = false; $('run').disabled = false; $('run').textContent = 'Retry calculation'; result = null;
  $('stage-label').textContent = 'CALCULATION PAUSED'; status(message);
}
function invalidate() {
  requestId++; if (worker) worker.terminate(); preparing = false;
  pause(); step = 0; worldVersion++; result = null; geometry = null; framePhase = -1; $('export').disabled = true;
  update(); draw(); clearTimeout(recomputeTimer); recomputeTimer = setTimeout(() => prepare(false),160);
}
function start() {
  if (preparing) return;
  if (!result || resultVersion !== worldVersion) { prepare(true); return; }
  if (step >= 180) step = 0;
  running = true; startStep = step; playbackStart = performance.now();
  $('run').textContent = 'Ⅱ Pause'; $('live-dot').classList.add('running'); $('stage-label').textContent = 'FOLLOWING THE SUN';
  status('The sun is moving. Watch the shadows and reflected energy build.');
  animationHandle = requestAnimationFrame(animate);
}
function pause() {
  const wasRunning = running; running = false; cancelAnimationFrame(animationHandle);
  $('live-dot').classList.remove('running');
  if (!preparing) $('run').textContent = step >= 180 ? '↻ Run again' : '▶ Run the day';
  if (wasRunning && step < 180) { $('stage-label').textContent = 'PAUSED IN THE SUNLIGHT'; status('Paused. Resume the day or scrub along the solar arc.'); }
}
function animate(now) {
  if (!running) return;
  const duration = Number($('speed').value)*1000;
  step = Math.min(180, startStep + (now-playbackStart)/duration*180);
  if (now-lastDraw >= 1000/60 || step === 180) { draw(); lastDraw = now; }
  // Numerical state remains continuous; slower text updates avoid DOM churn.
  if (now-lastUI >= 1000/20 || step === 180) { update(); lastUI = now; }
  if (step >= 180) {
    pause(); $('stage-label').textContent = 'A DAY WELL SPENT';
    const share = result.reflected[result.steps]/result.incident[result.steps]*100;
    status(`Day complete. ${share.toFixed(1)}% reflected; ${(100-share).toFixed(1)}% absorbed. Try a different landscape or equation.`);
  } else animationHandle = requestAnimationFrame(animate);
}
function update() {
  if (!running && !preparing) $('run').textContent = step >= 180 ? '↻ Run again' : '▶ Run the day';
  $('time').value = step; $('phase').textContent = `${step.toFixed(1)}° / 180°`;
  const zenith = Math.abs(90-step), period = step===0?'Sunrise':step===180?'Sunset':step===90?'Noon':step<90?'Morning':'Afternoon';
  $('sun-label').textContent = `${period} · zenith ${zenith.toFixed(1)}°`;
  const incident = energyAt(result?.incident), reflected = energyAt(result?.reflected);
  const fraction = incident > 0 ? reflected/incident : 0;
  $('reflected').firstChild.nodeValue = (reflected/1000).toFixed(2);
  $('incoming').firstChild.nodeValue = (incident/1000).toFixed(2);
  $('share').firstChild.nodeValue = incident>0?(fraction*100).toFixed(1):'—';
  $('total-energy').textContent = `${(reflected*size*size*.01).toLocaleString(undefined,{maximumFractionDigits:1})} MWh across the landscape`;
  $('energy-fill').style.width = `${fraction*100}%`; $('energy-progress').setAttribute('aria-valuenow',(fraction*100).toFixed(1));
  $('challenge-text').textContent = step===180 && result ? fraction>=.35 ? `Challenge complete! You returned ${(fraction*100).toFixed(1)}% of the day’s sunlight. What could push it higher?` : `You returned ${(fraction*100).toFixed(1)}%. Try adding snow or sea ice to reach the 35% challenge.` : 'Your challenge: return 35% of the day’s sunlight to the sky. Can you do it?';
  if (selected>=0) updateTileAlbedo(); updateIrradiance();
}
function energyAt(values) {
  if (!values || !result) return 0;
  const position = step / 180 * result.steps, lower = Math.floor(position), upper = Math.min(result.steps, lower + 1);
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}
function currentFrame() {
  if (!result || !frame) return null;
  const phase = step / 180;
  if (framePhase !== phase) {
    evaluateFrame({data, size, cloud:Number($('cloud').value)/100, terrainShadows:$('shadows').checked}, result.cache, phase, frame);
    framePhase = phase;
  }
  return frame;
}
function updateIrradiance() {
  const live = currentFrame();
  for (const [name, watts] of [['incoming',live?.watts || 0],['reflected',live?.reflectionWatts || 0]]) {
    $(`${name}-bar`).style.height = `${clamp(watts/1000)*100}%`;
    $(`${name}-watts`).textContent = watts.toFixed(0);
    $(`${name}-meter`).setAttribute('aria-valuenow',watts.toFixed(1));
  }
}
function resize() {
  const box=canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return;
  const dpr=Math.min(devicePixelRatio || 1,1.5,Math.sqrt(1500000/(box.width*box.height)));
  canvasWidth=1000; canvasHeight=1000*box.height/box.width;
  canvas.width=Math.round(box.width*dpr); canvas.height=Math.round(box.height*dpr);
  ctx.setTransform(canvas.width/canvasWidth,0,0,canvas.height/canvasHeight,0,0);
  geometry=null; draw();
}
function rgb(color,factor=1) {
  return `rgb(${Math.round(clamp(color[0]*factor,0,255))},${Math.round(clamp(color[1]*factor,0,255))},${Math.round(clamp(color[2]*factor,0,255))})`;
}
function polygon(points,color,stroke) {
  ctx.beginPath();
  for(let i=0;i<points.length;i++) { const p=points[i]; if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]); }
  ctx.closePath();ctx.fillStyle=color;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke();}
}
// Geometry and decorative paths are cached; dense simulation grids use screen-sized groups.
function buildGeometry() {
  const w=canvasWidth,h=canvasHeight,tile=860/(size*2),ty=h*.54/(2*size),originX=w/2,originY=h*.36;
  const target=clamp(Math.floor(canvas.clientWidth/13),24,64),block=Math.ceil(size/target),columns=Math.ceil(size/block);
  let maximum=1000;
  for(let i=0;i<size*size;i++)maximum=Math.max(maximum,data[i*STRIDE+6]);
  const heightScale=Math.min(90,h*.16)/maximum;
  const project=(x,y,height=0)=>[originX+(x-y)*tile,originY+(x+y)*ty-height*heightScale];
  const cells=[],byIndex=new Array(columns*columns);
  for(let diagonal=0;diagonal<columns*2-1;diagonal++)for(let gy=Math.max(0,diagonal-columns+1);gy<=Math.min(columns-1,diagonal);gy++) {
    const gx=diagonal-gy,x=gx*block,y=gy*block,nx=Math.min(block,size-x),ny=Math.min(block,size-y),counts=new Uint32Array(6);
    let height=0;
    for(let yy=y;yy<y+ny;yy++)for(let xx=x;xx<x+nx;xx++){const i=yy*size+xx;height+=data[i*STRIDE+6];counts[kinds[i]]++;}
    height/=nx*ny;let kind=0;for(let k=1;k<6;k++)if(counts[k]>counts[kind])kind=k;
    const top=[project(x,y,height),project(x+nx,y,height),project(x+nx,y+ny,height),project(x,y+ny,height)];
    const centre=project(x+nx/2,y+ny/2,height),texture=new Path2D(),objects=new Path2D(),rng=random(y*size+x+71),width=tile*Math.min(nx,ny);
    const point=(u,v)=>project(x+u*nx,y+v*ny,height);
    for(let n=0;n<3;n++){
      const u=.15+rng()*.65,v=.15+rng()*.65,q=point(u,v);
      if(kind===0||kind===5){const end=point(Math.min(.96,u+.2),v);texture.moveTo(...q);texture.quadraticCurveTo(q[0]+width*.12,q[1]-width*.07,...end);}
      if(kind===1){texture.moveTo(...point(u-.1,v));texture.lineTo(...q);texture.lineTo(...point(u+.12,v+.1));texture.lineTo(...point(u+.2,v+.04));}
      if(kind===3){for(let k=-1;k<=1;k++){texture.moveTo(...q);texture.lineTo(q[0]+k*width*.07,q[1]-width*(.13+rng()*.12));}}
      if(kind===2){const tall=width*(.45+rng()*.45);texture.moveTo(...q);texture.lineTo(q[0],q[1]-tall*.5);objects.moveTo(q[0],q[1]-tall);objects.lineTo(q[0]+width*.19,q[1]-tall*.12);objects.lineTo(q[0]-width*.19,q[1]-tall*.12);objects.closePath();}
      if(kind===4||kind===1||kind===5){const r=width*(.04+rng()*.07);objects.moveTo(q[0]-r,q[1]);objects.lineTo(q[0]-r*.3,q[1]-r*.65);objects.lineTo(q[0]+r,q[1]-r*.3);objects.lineTo(q[0]+r*.7,q[1]+r*.4);objects.closePath();}
    }
    const cell={i:y*size+x,x,y,nx,ny,kind,points:top,centre,height,texture,objects,
      right:[top[1],project(x+nx,y),project(x+nx,y+ny),top[2]],
      left:[top[2],project(x+nx,y+ny),project(x,y+ny),top[3]]};
    cells.push(cell);byIndex[gy*columns+gx]=cell;
  }
  polygons=cells;
  return {cells,tile,project,cellAt:i=>byIndex[Math.floor(Math.floor(i/size)/block)*columns+Math.floor((i%size)/block)],base:[project(0,0),project(size,0),project(size,size),project(0,size)]};
}
function draw() {
  if (!data) return;
  if (!geometry) geometry=buildGeometry();
  const live=currentFrame(),phase=step/180,w=canvasWidth,h=canvasHeight,sine=Math.sin(phase*Math.PI);
  const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,rgb([17+19*sine,36+18*sine,33+20*sine]));sky.addColorStop(1,'#10271f');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
  const sunX=110+780*phase,arcBase=h*.24,arcHeight=h*.14,sunY=arcBase-arcHeight*sine;
  const glow=ctx.createRadialGradient(sunX,sunY,2,sunX,sunY,65);glow.addColorStop(0,'#fce9a14a');glow.addColorStop(1,'#fce9a100');ctx.fillStyle=glow;ctx.fillRect(sunX-65,sunY-65,130,130);
  ctx.strokeStyle='#b5cc9c20';ctx.setLineDash([3,7]);ctx.beginPath();
  for(let k=0;k<=180;k+=3){const x=110+780*k/180,y=arcBase-arcHeight*Math.sin(k/180*Math.PI);k?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#f2dfa0';ctx.beginPath();ctx.arc(sunX,sunY,9,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.shadowColor='#0006';ctx.shadowBlur=25;ctx.shadowOffsetY=12;polygon(geometry.base,'#11291e');ctx.restore();
  const brightness=.53+.45*sine;
  const colors=palette.map(color=>[rgb(color,brightness),rgb(color,brightness-.22),rgb(color,brightness*.62),rgb(color,(brightness-.22)*.62),rgb(color,brightness*.77),rgb(color,(brightness-.22)*.77)]);
  const albedoColor=[0,0,0],treeColor=rgb([56,98,58],brightness),treeShade=rgb([56,98,58],brightness-.22);
  for(const cell of geometry.cells) {
    const {i,points:top,centre,height,kind}=cell;
    let shadeTotal=0,albedoTotal=0;
    if(live)for(let y=cell.y;y<cell.y+cell.ny;y++)for(let x=cell.x;x<cell.x+cell.nx;x++){const j=y*size+x;shadeTotal+=live.shades[j];albedoTotal+=live.albedos[j];}
    const count=cell.nx*cell.ny,shade=shadeTotal/count>.5?1:0,light=brightness-.22*shadeTotal/count;
    let topColor=colors[kind][shade],rightColor=colors[kind][2+shade],leftColor=colors[kind][4+shade];
    if(view==='albedo') {
      const a=live ? albedoTotal/count : .3;
      albedoColor[0]=36+208*a;albedoColor[1]=76+162*a;albedoColor[2]=86+107*a;
      topColor=rgb(albedoColor,light);rightColor=rgb(albedoColor,light*.62);leftColor=rgb(albedoColor,light*.77);
    }
    if(height>1){polygon(cell.right,rightColor);polygon(cell.left,leftColor);}
    polygon(top,topColor,'#10251f24');
    if(view==='surface'){
      ctx.strokeStyle=kind===2?'#203c29':kind===3?'#4b6837':kind===4?'#8a7050':'#e6f6ef';
      ctx.globalAlpha=.5*light;ctx.lineWidth=kind===3?.8:1;ctx.stroke(cell.texture);
      ctx.fillStyle=kind===2?'#335c37':kind===4?'#9d8b75':kind===1?'#edf8f5':'#ced8d0';ctx.fill(cell.objects);ctx.globalAlpha=1;
    }
    if(selected>=0 && geometry.cellAt(selected)===cell){
      const x=selected%size,y=Math.floor(selected/size),points=[geometry.project(x,y,height),geometry.project(x+1,y,height),geometry.project(x+1,y+1,height),geometry.project(x,y+1,height)];
      ctx.beginPath();for(let k=0;k<4;k++)k?ctx.lineTo(...points[k]):ctx.moveTo(...points[k]);ctx.closePath();ctx.strokeStyle='#f4e3a0';ctx.lineWidth=2;ctx.stroke();
    }
  }
  if(running && !reducedMotion.matches && sine>.08 && live) {
    for(let ray=0;ray<4;ray++) {
      const i=Math.floor((.2+ray*.19)*size*size);if(live.shades[i])continue;
      const target=geometry.cellAt(i).centre,travel=(performance.now()/1700+ray*.23)%1;
      ctx.strokeStyle='#edda9122';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sunX,sunY+12);ctx.lineTo(...target);ctx.stroke();
      ctx.fillStyle='#ffe9a9a0';ctx.beginPath();ctx.arc(sunX+(target[0]-sunX)*travel,sunY+12+(target[1]-sunY-12)*travel,1.6,0,Math.PI*2);ctx.fill();
      const up=(travel+.5)%1;ctx.fillStyle=`rgba(198,230,157,${live.albedos[i]*.8})`;ctx.beginPath();ctx.arc(target[0]+(phase<.5?65:-65)*up,target[1]-h*.28*up,2,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.fillStyle='#c2d5be65';ctx.font='11px system-ui';ctx.textAlign='center';
  const east=geometry.project(-2,size*.55),west=geometry.project(size+2,size*.55);ctx.fillText('E',east[0]-8,east[1]);ctx.fillText('W',west[0]+8,west[1]+10);ctx.textAlign='start';
}
function hit(event) {
  const box=canvas.getBoundingClientRect(),px=(event.clientX-box.left)/box.width*canvasWidth,py=(event.clientY-box.top)/box.height*canvasHeight;
  for(let k=polygons.length-1;k>=0;k--){
    const cell=polygons[k],p=cell.points[0],a=cell.points[1],b=cell.points[3];
    const ax=a[0]-p[0],ay=a[1]-p[1],bx=b[0]-p[0],by=b[1]-p[1],dx=px-p[0],dy=py-p[1],det=ax*by-ay*bx;
    const u=(dx*by-dy*bx)/det,v=(ax*dy-ay*dx)/det;
    if(u>=0&&u<1&&v>=0&&v<1)return (cell.y+Math.floor(v*cell.ny))*size+cell.x+Math.floor(u*cell.nx);
  }return -1;
}
function applyBrush(i) {
  if(i<0)return;selected=i;
  if(brush==='inspect'){updateInspector();draw();return;}
  if(brush==='hill'){
    // A compact Gaussian, tapered to exactly zero at the circular boundary.
    const radius=Math.max(2,size/16),cx=i%size,cy=Math.floor(i/size),sigma=radius*.42,edge=Math.exp(-radius*radius/(2*sigma*sigma));
    for(let y=Math.max(0,Math.ceil(cy-radius));y<=Math.min(size-1,Math.floor(cy+radius));y++)for(let x=Math.max(0,Math.ceil(cx-radius));x<=Math.min(size-1,Math.floor(cx+radius));x++){
      const distance=(x-cx)**2+(y-cy)**2;if(distance>=radius*radius)continue;
      const j=y*size+x;if(kinds[j]<2)setSurface(j,4);
      const lift=100*(Math.exp(-distance/(2*sigma*sigma))-edge)/(1-edge);
      data[j*STRIDE+6]=Math.min(3000,data[j*STRIDE+6]+lift);
    }
  }
  else setSurface(i,brushKinds[brush]);
  updateInspector();invalidate();
}
function updateTileAlbedo() { $('tile-albedo').textContent = result && selected>=0 ? `α ${currentFrame().albedos[selected].toFixed(3)}` : 'α —'; }
function updateInspector() {
  $('tile-fields').replaceChildren(); updateTileAlbedo();
  $('inspector-summary').textContent=selected<0?'Select a tile in the landscape to explore its inputs.':`${names[kinds[selected]]} · column ${selected%size+1}, row ${Math.floor(selected/size)+1} · edits reset the day`;
  fieldInfo.forEach(([label,min,max,increment],index)=>{
    const wrapper=document.createElement('div'),lab=document.createElement('label'),input=document.createElement('input');input.id=`field-${FIELDS[index]}`;lab.htmlFor=input.id;lab.textContent=label;input.type='number';input.min=min;input.max=max;input.step=increment;
    input.disabled=selected<0||(kinds[selected]<2&&index!==11)||(kinds[selected]>=2&&index===11);
    if(selected>=0)input.value=Number(data[selected*STRIDE+index].toFixed(3));
    input.addEventListener('change',()=>{
      if(selected<0||!Number.isFinite(input.valueAsNumber)){updateInspector();return;}
      const o=selected*STRIDE,value=clamp(input.valueAsNumber,min,max);data[o+index]=value;
      if(index===0||index===1){const other=index===0?1:0;data[o+other]=Math.min(data[o+other],1-value);}
      updateInspector();invalidate();
    });wrapper.append(lab,input);$('tile-fields').append(wrapper);
  });
}
$('generate').addEventListener('click',generate);
$('inspector-link').addEventListener('click',()=> $('inspector').showModal());
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}));
$('science-link').addEventListener('click',()=>{$('science').showModal();});
$('brushes').addEventListener('click',event=>{const button=event.target.closest('[data-brush]');if(!button)return;brush=button.dataset.brush;document.querySelectorAll('[data-brush]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));canvas.style.cursor=brush==='inspect'?'crosshair':'cell';});
canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging=true;lastPainted=hit(event);canvas.setPointerCapture(event.pointerId);applyBrush(lastPainted);if(brush==='inspect'&&lastPainted>=0){endPaint();$('inspector').showModal();}});
canvas.addEventListener('pointermove',event=>{if(!dragging||brush==='inspect')return;const i=hit(event);if(i!==lastPainted){lastPainted=i;applyBrush(i);}});
function endPaint(){dragging=false;lastPainted=-1;}canvas.addEventListener('pointerup',endPaint);canvas.addEventListener('pointercancel',endPaint);
canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key))return;event.preventDefault();if(selected<0)selected=Math.floor(size*size/2);const x=selected%size,y=Math.floor(selected/size);if(event.key==='ArrowLeft')selected=y*size+Math.max(0,x-1);if(event.key==='ArrowRight')selected=y*size+Math.min(size-1,x+1);if(event.key==='ArrowUp')selected=Math.max(0,y-1)*size+x;if(event.key==='ArrowDown')selected=Math.min(size-1,y+1)*size+x;if(event.key==='Enter'||event.key===' '){applyBrush(selected);if(brush==='inspect')$('inspector').showModal();}else{updateInspector();draw();}});
$('run').addEventListener('click',()=>running?pause():start());
$('reset').addEventListener('click',()=>{pause();step=0;update();draw();status('Rewound to sunrise.');});
$('time').addEventListener('input',()=>{pause();step=Number($('time').value);update();draw();});
['scheme','cloud','shadows','hours'].forEach(id=>$(id).addEventListener('change',invalidate));
$('cloud').addEventListener('input',()=>{$('cloud-value').textContent=`${$('cloud').value}%`;});
$('speed').addEventListener('change',()=>{if(running){startStep=step;playbackStart=performance.now();}});
['surface','albedo'].forEach(mode=>$(`view-${mode}`).addEventListener('click',()=>{view=mode;$('view-surface').setAttribute('aria-pressed',String(mode==='surface'));$('view-albedo').setAttribute('aria-pressed',String(mode==='albedo'));$('albedo-legend').hidden=mode!=='albedo';draw();}));
$('export').addEventListener('click',()=>{
  if(!result)return;
  const rows=['solar_arc_deg,solar_zenith_deg,incident_Wh_m2,reflected_Wh_m2,reflected_fraction'];
  for(let i=0;i<=result.steps;i++){const angle=i/result.steps*180;rows.push([angle.toFixed(3),Math.abs(90-angle).toFixed(3),result.incident[i].toFixed(6),result.reflected[i].toFixed(6),result.incident[i]>0?(result.reflected[i]/result.incident[i]).toFixed(6):0].join(','));}
  const blob=new Blob([rows.join('\n')+'\n'],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`reflect-${$('preset').value}-${$('seed').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
new ResizeObserver(resize).observe(canvas);
generate();resize();
