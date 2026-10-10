import { STRIDE, FIELDS, clamp } from './model.mjs';
const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
const chart = $('chart'), chartCtx = chart.getContext('2d');
const palette = [[65,139,162],[190,223,225],[57,106,82],[158,174,104],[186,151,106],[230,235,226]];
const names = ['Ocean','Sea ice','Forest','Grass','Bare soil','Snow'];
const brushKinds = {ocean:0,ice:1,forest:2,grass:3,soil:4,snow:5};
const fieldInfo = [
 ['High vegetation cover',0,1,.01],['Low vegetation cover',0,1,.01],['Topsoil water · m³/m³',0,.6,.01],['Topsoil temperature · K',230,330,1],['Deep-soil water · m³/m³',0,.6,.01],['Deep-soil temperature · K',230,330,1],['Elevation · m',0,3000,10],['High leaf area · m²/m²',0,10,.1],['Low leaf area · m²/m²',0,10,.1],['Snow depth · m',0,2,.01],['Near-surface air · K',230,330,1],['Sea-ice fraction',0,1,.01]
];
let size = 32, data, kinds, selected = -1, brush = 'inspect', view = 'surface', result = null;
let step = 0, running = false, preparing = false, requestId = 0, worldVersion = 0, resultVersion = -1;
let worker = null, polygons = [], dragging = false, lastPainted = -1, recomputeTimer;
let playbackStart = 0, startStep = 0, resumeWhenReady = false;
let animationHandle = 0, lastDraw = 0;
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
  selected = -1; worldVersion++; step = 0; result = null;
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
      result = event.data.result; resultVersion = version; preparing = false; $('run').disabled = false;
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
  pause(); step = 0; worldVersion++; result = null; $('export').disabled = true;
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
  const smoothStep = Math.min(180, startStep + (now-playbackStart)/duration*180);
  const next = Math.floor(smoothStep);
  if (next !== step) { step = next; update(); }
  if (now-lastDraw >= 1000/30 || step === 180) { draw(smoothStep/180); lastDraw = now; }
  if (step >= 180) {
    pause(); $('stage-label').textContent = 'A DAY WELL SPENT';
    const share = result.reflected[180]/result.incident[180]*100;
    status(`Day complete. ${share.toFixed(1)}% reflected; ${(100-share).toFixed(1)}% absorbed. Try a different landscape or equation.`);
  } else animationHandle = requestAnimationFrame(animate);
}
function update() {
  if (!running && !preparing) $('run').textContent = step >= 180 ? '↻ Run again' : '▶ Run the day';
  $('time').value = step; $('phase').textContent = `${step}° / 180°`;
  const zenith = Math.abs(90-step), period = step===0?'Sunrise':step===180?'Sunset':step===90?'Noon':step<90?'Morning':'Afternoon';
  $('sun-label').textContent = `${period} · zenith ${zenith}°`;
  const incident = result?.incident[step] || 0, reflected = result?.reflected[step] || 0;
  const fraction = incident > 0 ? reflected/incident : 0;
  $('reflected').replaceChildren(document.createTextNode((reflected/1000).toFixed(2)), unit(' kWh/m²'));
  $('incoming').replaceChildren(document.createTextNode((incident/1000).toFixed(2)), unit(' kWh/m²'));
  $('share').replaceChildren(document.createTextNode(incident>0?(fraction*100).toFixed(1):'—'),unit(' %'));
  $('total-energy').textContent = `${(reflected*size*size*.01).toLocaleString(undefined,{maximumFractionDigits:1})} MWh across the landscape`;
  $('energy-fill').style.width = `${fraction*100}%`; $('energy-progress').setAttribute('aria-valuenow',(fraction*100).toFixed(1));
  $('challenge-text').textContent = step===180 && result ? fraction>=.35 ? `Challenge complete! You returned ${(fraction*100).toFixed(1)}% of the day’s sunlight. What could push it higher?` : `You returned ${(fraction*100).toFixed(1)}%. Try adding snow or sea ice to reach the 35% challenge.` : 'Your challenge: return 35% of the day’s sunlight to the sky. Can you do it?';
  if (selected>=0) updateTileAlbedo(); drawChart();
}
function unit(text) { const span=document.createElement('span'); span.textContent=text; return span; }
function resize() {
  const box=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio || 1,2);
  canvasWidth=1000; canvasHeight=1000*box.height/Math.max(1,box.width);
  canvas.width=Math.round(box.width*dpr); canvas.height=Math.round(box.height*dpr);
  ctx.setTransform(canvas.width/canvasWidth,0,0,canvas.height/canvasHeight,0,0);
  const cb=chart.getBoundingClientRect(); chart.width=Math.round(cb.width*dpr); chart.height=Math.round(cb.height*dpr);
  chartCtx.setTransform(chart.width/1000,0,0,chart.height/180,0,0); draw(); drawChart();
}
function rgb(color,factor=1) { return `rgb(${color.map(v=>Math.round(clamp(v*factor,0,255))).join(',')})`; }
function polygon(points,color,stroke) {
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=color;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke();}
}
function draw(phase = step/180) {
  if (!data) return;
  const w=canvasWidth,h=canvasHeight,sine=Math.sin(phase*Math.PI);
  const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,rgb([17+19*sine,36+18*sine,33+20*sine]));sky.addColorStop(1,'#10271f');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
  const sunX=110+780*phase, sunY=164-100*sine;
  const glow=ctx.createRadialGradient(sunX,sunY,2,sunX,sunY,90);glow.addColorStop(0,'#fce9a14a');glow.addColorStop(1,'#fce9a100');ctx.fillStyle=glow;ctx.fillRect(sunX-90,sunY-90,180,180);
  ctx.strokeStyle='#b5cc9c20';ctx.setLineDash([3,7]);ctx.beginPath();for(let k=0;k<=180;k++){const x=110+780*k/180,y=164-100*Math.sin(k/180*Math.PI);k?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#f2dfa0';ctx.beginPath();ctx.arc(sunX,sunY,11,0,Math.PI*2);ctx.fill();
  if(!reducedMotion.matches){ctx.strokeStyle='#f2dfa060';for(let k=0;k<8;k++){const a=k*Math.PI/4;ctx.beginPath();ctx.moveTo(sunX+Math.cos(a)*17,sunY+Math.sin(a)*17);ctx.lineTo(sunX+Math.cos(a)*22,sunY+Math.sin(a)*22);ctx.stroke();}}
  const tile=Math.min(760/(size*2), (h-250)/(size+6)), ty=tile*.52, originX=w/2, originY=h*.39;
  const heightScale=Math.min(100,h*.15)/1000;
  const project=(x,y,height=0)=>[originX+(x-y)*tile,originY+(x+y)*ty-height*heightScale];
  const base=[project(0,0),project(size,0),project(size,size),project(0,size)];
  ctx.save();ctx.shadowColor='#0006';ctx.shadowBlur=35;ctx.shadowOffsetY=20;polygon(base,'#11291e');ctx.restore();
  polygons=[];
  for(let diagonal=0;diagonal<size*2-1;diagonal++) for(let y=Math.max(0,diagonal-size+1);y<=Math.min(size-1,diagonal);y++) {
    const x=diagonal-y,i=y*size+x,kind=kinds[i],height=data[i*STRIDE+6];
    const top=[project(x,y,height),project(x+1,y,height),project(x+1,y+1,height),project(x,y+1,height)];
    const shade=result?.shades[step*size*size+i] || 0;
    let color=palette[kind];
    if(view==='albedo') {
      const a=result?.albedos[step*size*size+i] ?? .3;
      color=[36+208*a,76+162*a,86+107*a];
    }
    const brightness=.53+.45*sine-(shade?.22:0);
    if(height>1){polygon([top[1],project(x+1,y),project(x+1,y+1),top[2]],rgb(color,brightness*.62));polygon([top[2],project(x+1,y+1),project(x,y+1),top[3]],rgb(color,brightness*.77));}
    polygon(top,rgb(color,brightness),'#10251f24');
    if(kind===0 && view==='surface' && (x+y)%4===0){ctx.strokeStyle='#d9f0e41b';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(top[0][0],top[0][1]+ty);ctx.lineTo(top[0][0]+tile*.5,top[0][1]+ty*.75);ctx.stroke();}
    if(kind===2 && view==='surface' && (i*17)%5===0){const c=project(x+.5,y+.5,height),th=tile*.9;ctx.fillStyle=rgb([30,74,48],brightness);ctx.fillRect(c[0]-1,c[1]-th*.2,2,th*.35);polygon([[c[0],c[1]-th],[c[0]+tile*.3,c[1]],[c[0]-tile*.3,c[1]]],rgb([56,98,58],brightness));}
    if(i===selected){ctx.beginPath();top.forEach(([px,py],k)=>k?ctx.lineTo(px,py):ctx.moveTo(px,py));ctx.closePath();ctx.strokeStyle='#f4e3a0';ctx.lineWidth=2;ctx.stroke();}
    polygons.push({i,points:top});
  }
  // Illustrative light packets: shadows suppress the incoming direct-beam trails.
  if(running && !reducedMotion.matches && sine>.08 && result) {
    for(let ray=0;ray<4;ray++) {
      const i=Math.floor((.2+ray*.19)*size*size), x=i%size, y=Math.floor(i/size);
      if(result.shades[step*size*size+i]) continue;
      const target=project(x+.5,y+.5,data[i*STRIDE+6]);
      const travel=(performance.now()/1700+ray*.23)%1;
      ctx.strokeStyle='#edda9122';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sunX,sunY+15);ctx.lineTo(...target);ctx.stroke();
      ctx.fillStyle='#ffe9a9a0';ctx.beginPath();ctx.arc(sunX+(target[0]-sunX)*travel,sunY+15+(target[1]-sunY-15)*travel,1.6,0,Math.PI*2);ctx.fill();
      const alpha=result.albedos[step*size*size+i], up=(travel+.5)%1;
      ctx.fillStyle=`rgba(198,230,157,${alpha*.8})`;ctx.beginPath();ctx.arc(target[0]+(phase<.5?65:-65)*up,target[1]-160*up,2,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.fillStyle='#c2d5be65';ctx.font='11px system-ui';ctx.textAlign='center';
  const east=project(-2,size*.55),west=project(size+2,size*.55);ctx.fillText('E',east[0]-8,east[1]);ctx.fillText('W',west[0]+8,west[1]+10);ctx.textAlign='start';
}
function drawChart() {
  chartCtx.clearRect(0,0,1000,180);
  chartCtx.strokeStyle='#dce4d5';chartCtx.lineWidth=1;
  for(let y=35;y<=150;y+=38){chartCtx.beginPath();chartCtx.moveTo(40,y);chartCtx.lineTo(980,y);chartCtx.stroke();}
  chartCtx.fillStyle='#7d8b78';chartCtx.font='13px system-ui';chartCtx.fillText('W/m²',0,18);chartCtx.fillText('Sunrise',40,175);chartCtx.fillText('Noon',484,175);chartCtx.fillText('Sunset',937,175);
  if(!result) return;
  const path=(values,color,fill=false)=>{chartCtx.beginPath();chartCtx.moveTo(40,150);for(let i=0;i<=step;i++)chartCtx.lineTo(40+i/180*940,150-values[i]/1000*125);if(fill){chartCtx.lineTo(40+step/180*940,150);chartCtx.closePath();chartCtx.fillStyle=color;chartCtx.fill();}else{chartCtx.strokeStyle=color;chartCtx.lineWidth=2;chartCtx.stroke();}};
  path(result.reflectionWatts,'#98b96a30',true);path(result.watts,'#b4bcaa');path(result.reflectionWatts,'#749758');
  chartCtx.fillStyle='#61795b';chartCtx.font='13px system-ui';chartCtx.fillText('incoming',810,16);chartCtx.fillText('reflected',905,16);
}
function hit(event) {
  const box=canvas.getBoundingClientRect(),x=(event.clientX-box.left)/box.width*canvasWidth,y=(event.clientY-box.top)/box.height*canvasHeight;
  for(let k=polygons.length-1;k>=0;k--){const {i,points}=polygons[k];let inside=false;for(let a=0,b=points.length-1;a<points.length;b=a++){const [ax,ay]=points[a],[bx,by]=points[b];if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;}if(inside)return i;}return -1;
}
function applyBrush(i) {
  if(i<0)return;selected=i;
  if(brush==='inspect'){updateInspector();draw();return;}
  if(brush==='hill'){if(kinds[i]<2)setSurface(i,4);data[i*STRIDE+6]=Math.min(3000,data[i*STRIDE+6]+100);}
  else setSurface(i,brushKinds[brush]);
  updateInspector();invalidate();
}
function updateTileAlbedo() { $('tile-albedo').textContent = result && selected>=0 ? `α ${result.albedos[step*size*size+selected].toFixed(3)}` : 'α —'; }
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
$('science-link').addEventListener('click',()=>{$('science').open=true;$('science').scrollIntoView({behavior:reducedMotion.matches?'auto':'smooth'});});
$('brushes').addEventListener('click',event=>{const button=event.target.closest('[data-brush]');if(!button)return;brush=button.dataset.brush;document.querySelectorAll('[data-brush]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));canvas.style.cursor=brush==='inspect'?'crosshair':'cell';});
canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging=true;lastPainted=hit(event);canvas.setPointerCapture(event.pointerId);applyBrush(lastPainted);});
canvas.addEventListener('pointermove',event=>{if(!dragging||brush==='inspect')return;const i=hit(event);if(i!==lastPainted){lastPainted=i;applyBrush(i);}});
function endPaint(){dragging=false;lastPainted=-1;}canvas.addEventListener('pointerup',endPaint);canvas.addEventListener('pointercancel',endPaint);
canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key))return;event.preventDefault();if(selected<0)selected=Math.floor(size*size/2);const x=selected%size,y=Math.floor(selected/size);if(event.key==='ArrowLeft')selected=y*size+Math.max(0,x-1);if(event.key==='ArrowRight')selected=y*size+Math.min(size-1,x+1);if(event.key==='ArrowUp')selected=Math.max(0,y-1)*size+x;if(event.key==='ArrowDown')selected=Math.min(size-1,y+1)*size+x;if(event.key==='Enter'||event.key===' ')applyBrush(selected);else{updateInspector();draw();}});
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
  for(let i=0;i<=180;i++)rows.push([i,Math.abs(90-i),result.incident[i].toFixed(6),result.reflected[i].toFixed(6),result.incident[i]>0?(result.reflected[i]/result.incident[i]).toFixed(6):0].join(','));
  const blob=new Blob([rows.join('\n')+'\n'],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`reflect-${$('preset').value}-${$('seed').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
new ResizeObserver(resize).observe(canvas);
generate();resize();
