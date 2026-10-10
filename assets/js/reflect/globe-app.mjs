import { sphericalGrid, cellAt, clamp, YEAR, RADIUS, TAU } from './globe-model.mjs';
import { GlobeRenderer } from './globe-render.mjs';
import { PRESENT_CO2 } from './co2-baseline.mjs';
const today=new Date(),startDay=(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate())-Date.UTC(today.getUTCFullYear(),0,1))/86400000;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let displayDay=0,lastDraw=0;
const $=id=>document.getElementById(id),canvas=$('planet'),renderer=new GlobeRenderer(canvas),names=['Ocean','Sea ice','High vegetation','Low vegetation','Bare soil','Snow'];
let worker=null,grid=null,fields=null,metrics=null,history=[],selected=-1,ready=false,running=false,busy=false,queuedDays=0,brush='rotate',view='surface',animation=0,lastTick=0,accumulator=0,configurationTimer=0,paintTime=0,drag=null,lastFrame=0;
let paintBusy=false,pendingPaint=null;
let landDraftIndex=-1,landDraftDirty=false;
let coordinateDraftDirty=false,landApplyIndex=-1,landDraftValues={},landDraftDisplay={};
const landFields=[['tile-high-cover',0,100,'high'],['tile-low-cover',1,100,'low'],['tile-high-lai',7,1,'highLai'],['tile-low-lai',8,1,'lowLai'],['tile-height',6,1,'height'],['tile-snow',9,1000,'snow']];
const paintNotes={
 'low-vegetation':'Convert high cover to low; low leaf area → 2.',
 'high-vegetation':'Convert low cover to high; high leaf area → 5.',
 'bare-ground':'Remove vegetation and leaf area; keep soil and snow.',
 'snow-cover':'Add up to 150 mm water-equivalent snow.',
 'raise-terrain':'Gaussian lift: +100 m at centre, zero at edge.',
 'lower-terrain':'Gaussian lowering: −100 m at centre, zero at edge.',
 brighten:'Prescribe a brighter albedo; bypass C45 / Jin.',
 darken:'Prescribe a darker albedo; bypass C45 / Jin.',
 scatter:'Increase atmospheric scattering over the patch.',
 clear:'Decrease atmospheric scattering over the patch.'
};
const signed=(x,digits=2)=>(Number(x.toFixed(digits))<0?'−':'+')+Math.abs(x).toFixed(digits);
function status(text){$('status').textContent=text;}
function config(){return{spacing:Number($('resolution').value),seed:Number($('seed').value)||0,co2:Number($('co2').value),wind:Number($('wind').value),startDay,initialMonth:today.getUTCMonth(),monthFraction:(today.getUTCDate()-1)/new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,0)).getUTCDate(),boundaryDate:today.toISOString().slice(0,10),scatter:Number($('scatter').value)/100,width:Number($('width').value),eccentricity:Number($('eccentricity').value),tilt:Number($('tilt').value)};}
function setOutputs(){
 $('wind-value').textContent=`${$('wind').value} m/s`;$('co2-value').textContent=`${$('co2').value} ppm`;$('scatter-value').textContent=`${$('scatter').value}%`;$('eccentricity-value').textContent=Number($('eccentricity').value).toFixed(4);$('tilt-value').textContent=Number($('tilt').value).toFixed(2)+'°';$('radius-value').textContent=$('radius').value+' km';
}
function initialize(restore=false){
 pause();if(worker)worker.terminate();fields=null;metrics=null;history=[];selected=-1;ready=false;busy=false;paintBusy=false;pendingPaint=null;drag=null;queuedDays=0;accumulator=0;displayDay=0;renderer.spin=0;renderer.selection=null;
 $('land-editor').disabled=true;$('tile-albedo').disabled=true;$('tile-scatter').disabled=true;$('restore-tile').disabled=true;
 landDraftIndex=-1;landDraftDirty=false;
 coordinateDraftDirty=false;landApplyIndex=-1;landDraftValues={};landDraftDisplay={};
 if(restore){$('co2').value=PRESENT_CO2.ppm;$('wind').value=5;$('scatter').value=30;$('width').value=120;$('eccentricity').value=.0167;$('tilt').value=23.44;setOutputs();}
 $('run').disabled=true;$('run').textContent='Building…';$('step').disabled=true;$('export').disabled=true;$('stage-label').textContent='BUILDING YOUR PLANET';status('Calibrating the unchanged reference orbit…');
 worker=new Worker(new URL('./globe-worker.mjs',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  if(data.type==='error'){pause();busy=false;paintBusy=false;pendingPaint=null;ready=false;status(`Simulation paused: ${data.message}. Reset to retry.`);$('stage-label').textContent='SIMULATION PAUSED';return;}
  if(data.type==='edit-error'){
   if(data.brushEdit){paintBusy=false;pendingPaint=null;}
   if(data.index===landApplyIndex){landApplyIndex=-1;if(data.index===selected){landDraftDirty=true;$('land-editor').disabled=false;$('land-editor-note').textContent=data.message;}}
   status(`Edit rejected: ${data.message}. The climate state is preserved.`);return;
  }
  if(data.type==='loading'){status('Loading local SpeedyWeatherAssets surface maps…');return;}
  if(data.type==='progress'){status(`Preparing reference climate · ${Math.round(data.progress*100)}%`);return;}
  if(data.type==='grid'){
   grid=sphericalGrid(data.spacing);renderer.setGrid(grid,data.kinds,data.ice);
   // A radius smaller than the centre-to-corner distance can miss every cell
   // on the coarse grid, even when the cursor is over visible land.
   $('radius').min=Math.max(150,Math.ceil(data.spacing*.75/50)*50);$('radius').value=Math.max(Number($('radius').min),Number($('radius').value));setOutputs();
   $('tile-hint').textContent=`${data.count.toLocaleString()} cells · ~${data.spacing} km · asset inputs`;return;
  }
  if(data.type==='inspection'){showInspection(data.inspection);return;}
  if(data.type==='edited'&&data.editSummary?.mode==='land-inputs'&&data.inspection?.index===landApplyIndex){if(landApplyIndex===selected)landDraftDirty=false;landApplyIndex=-1;}
  if(data.kinds)renderer.setKinds(data.kinds);
  if(data.fields){
   if(fields)worker.postMessage({type:'recycle',buffer:fields.buffer},[fields.buffer]);
   fields=data.fields;metrics=data.metrics;history=data.history;renderer.update(fields,view);renderer.draw(metrics.orbital);updateUI();if(data.inspection)showInspection(data.inspection);
  }
  if(data.type==='edited'){
   const edit=data.editSummary;
   if(edit){
    const landMode=['low-vegetation','high-vegetation','bare-ground','snow-cover','raise-terrain','lower-terrain','land-inputs'].includes(edit.mode);
    let action='Painted a response patch.';
    if(edit.mode==='restore')action='Restored original surface inputs.';
    else if(landMode)action=edit.changedCells?`Updated ${edit.changedCells.toLocaleString()} land tiles (${Math.round(edit.area).toLocaleString()} km²).`:'No land inputs changed: the patch has no eligible land or already matches this setting.';
    status(`${action} Global sunlight forcing: ${signed(metrics.shortwaveForcing,3)} W/m². Temperature continues from the current state.`);
   }
   if(data.brushEdit){paintBusy=false;if(pendingPaint){const edit=pendingPaint;pendingPaint=null;sendPaint(edit);}}
  }
  if(data.type==='ready'){
   ready=true;$('run').disabled=false;$('run').textContent='▶ Run climate';$('step').disabled=false;$('export').disabled=false;$('stage-label').textContent='YOUR REFERENCE PLANET';
   start();
  }
  if(data.type==='advanced'){
   busy=false;
   if(queuedDays>0){const count=Math.min(8,queuedDays);queuedDays-=count;advance(count);status(`Integrating ${queuedDays} queued days…`);}
   else if(!running){$('stage-label').textContent='CLIMATE PAUSED';status('Paused. Changes to the controls update radiation immediately; temperature evolves when you run.');}
  }
 };
 worker.onerror=()=>{pause();busy=false;ready=false;status('The climate worker could not start. Reload or reset to retry.');};
 worker.postMessage({type:'initialize',config:config()});
}
function configure(){setOutputs();clearTimeout(configurationTimer);configurationTimer=setTimeout(()=>{if(ready){worker.postMessage({type:'configure',config:config()});status(running?'Forcing updated. Temperature continues integrating from the current state.':'Forcing updated. Resume to integrate temperature.');}},90);}
function start(){if(!ready||running)return;running=true;lastTick=performance.now();accumulator=0;$('run').textContent='Ⅱ Pause';$('stage-label').textContent='FOLLOWING THE CLIMATE';$('live-dot').classList.add('running');status('FaIR three-layer response · equilibrium start at dated recent CO₂ · daily physics · one display turn per model year.');animation=requestAnimationFrame(tick);}
function pause(){running=false;queuedDays=0;cancelAnimationFrame(animation);$('live-dot').classList.remove('running');if(ready){$('run').textContent='▶ Run climate';$('stage-label').textContent='CLIMATE PAUSED';}}
function advance(days){if(!ready||busy)return;busy=true;worker.postMessage({type:'advance',days});}
function tick(now){
 if(!running)return;accumulator=Math.min(16,accumulator+(now-lastTick)/1000*Number($('speed').value));lastTick=now;
 if(!busy&&accumulator>=Math.max(1,Number($('speed').value)/12)){const days=Math.min(8,Math.floor(accumulator));accumulator-=days;advance(days);}
 if(metrics&&!reducedMotion.matches&&now-lastDraw>33){
  const previous=displayDay;displayDay+=(metrics.day-displayDay)*Math.min(1,(now-lastDraw)/90);
  if(!drag&&brush==='rotate'){renderer.spin-=TAU*(displayDay-previous)/YEAR;renderer.draw(metrics.orbital);}lastDraw=now;
 }
 animation=requestAnimationFrame(tick);
}
function updateUI(){
 if(!metrics)return;const m=metrics,month=Math.floor(m.orbital.day/YEAR*12),months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 $('warming').firstChild.nodeValue=signed(m.warming);$('imbalance').firstChild.nodeValue=signed(m.perturbation);$('temperature').firstChild.nodeValue=m.temperature.toFixed(2);
 $('absolute-range').textContent=`Scenarios: ${(m.temperature-m.warming+m.lower).toFixed(2)} to ${(m.temperature-m.warming+m.upper).toFixed(2)}°C`;
 $('temperature-range').textContent=`ECS scenarios: ${signed(m.lower)} to ${signed(m.upper)}°C`;$('co2-forcing').textContent=`CO₂ forcing: ${signed(m.forcing)} W/m²`;$('sunlight-forcing').textContent=`Sunlight forcing: ${signed(m.shortwaveForcing,3)} W/m²`;$('stored-heat').textContent=`Heat change: ${signed(m.heat)} ZJ`;
 $('time-label').textContent=`${(m.day/YEAR).toFixed(2)} model years`;$('season-label').textContent=`Year ${Math.floor(m.day/YEAR)+1} · ${months[month]}`;
 $('distance').textContent=`${m.orbital.distance.toFixed(4)} AU`;$('declination').textContent=`${signed(m.orbital.declination*180/Math.PI,1)}° solar latitude`;
 for(const name of ['incoming','reflected','outgoing']){$(name).textContent=m[name].toFixed(1);$(`${name}-bar`).style.width=`${clamp(m[name]/450)*100}%`;}
 $('total-net').textContent=signed(m.imbalance,2);$('annual-net').textContent=m.annual===null?'After one year':signed(m.annual,2)+' W/m²';
 drawOrbit();drawHistory();
}
function drawOrbit(){
 const c=$('orbit'),ctx=c.getContext('2d'),w=c.width,h=c.height,e=Number($('eccentricity').value),a=w*.38,b=a*Math.sqrt(1-e*e),cx=w/2,cy=h/2;
 ctx.clearRect(0,0,w,h);ctx.strokeStyle='#a6b698';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(cx,cy,a,b,0,0,TAU);ctx.stroke();
 const sunX=cx-a*e;ctx.fillStyle='#bdad5a';ctx.beginPath();ctx.arc(sunX,cy,6,0,TAU);ctx.fill();
 const E=metrics.orbital.anomaly,x=cx+a*Math.cos(E),y=cy-b*Math.sin(E);
 ctx.strokeStyle='#b6bf9366';ctx.beginPath();ctx.moveTo(sunX,cy);ctx.lineTo(x,y);ctx.stroke();ctx.fillStyle='#327b68';ctx.beginPath();ctx.arc(x,y,5,0,TAU);ctx.fill();
 ctx.fillStyle='#6c806d';ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText('1 AU semi-major axis',cx,h-5);
}
function drawHistory(){
 const canvas=$('history'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,pad=27;ctx.clearRect(0,0,w,h);if(!metrics)return;
 const points=history.slice();if(!points.length||points.at(-1)[0]!==metrics.day)points.push([metrics.day,metrics.warming,metrics.lower,metrics.upper]);
 let min=-.1,max=.1;for(const p of points){min=Math.min(min,p[2]);max=Math.max(max,p[3]);}const range=max-min;min-=range*.12;max+=range*.12;
 const start=points[0][0],end=Math.max(start+30,metrics.day),x=day=>pad+(day-start)/(end-start)*(w-pad-8),y=t=>h-21-(t-min)/(max-min)*(h-33);
 ctx.strokeStyle='#c8d2be';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(pad,y(0));ctx.lineTo(w-8,y(0));ctx.stroke();ctx.setLineDash([]);
 ctx.fillStyle='#96af6850';ctx.beginPath();for(let j=0;j<points.length;j++)j?ctx.lineTo(x(points[j][0]),y(points[j][3])):ctx.moveTo(x(points[j][0]),y(points[j][3]));for(let j=points.length-1;j>=0;j--)ctx.lineTo(x(points[j][0]),y(points[j][2]));ctx.closePath();ctx.fill();
 ctx.strokeStyle='#347860';ctx.lineWidth=2;ctx.beginPath();for(let j=0;j<points.length;j++)j?ctx.lineTo(x(points[j][0]),y(points[j][1])):ctx.moveTo(x(points[j][0]),y(points[j][1]));ctx.stroke();
 ctx.fillStyle='#627361';ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillText(`${max.toFixed(1)}°`,0,12);ctx.fillText(`${min.toFixed(1)}°`,0,h-21);ctx.fillText(`${(start/YEAR).toFixed(1)} y`,pad,h-4);ctx.textAlign='right';ctx.fillText(`${(metrics.day/YEAR).toFixed(1)} years`,w-8,h-4);
}
function showInspection(tile){
 // Only an explicit selection request can change the selected tile. Older
 // snapshots can still contain the previous inspector selection.
 if(!tile||tile.index!==selected)return;
 if(!coordinateDraftDirty){$('inspect-lat').value=tile.latitude.toFixed(2);$('inspect-lon').value=tile.longitude.toFixed(2);}
 if(landDraftIndex!==tile.index){landDraftIndex=tile.index;landDraftDirty=false;}
 $('inspector-summary').textContent=`${names[tile.kind]} · ${tile.latitude.toFixed(2)}° latitude, ${tile.longitude.toFixed(2)}° longitude · ${Math.round(tile.area).toLocaleString()} km²`;
 const list=$('tile-summary');list.replaceChildren();
 const rows= [['Model temperature',tile.temperature.toFixed(2)+'°C'],['Incoming light',tile.incoming.toFixed(1)+' W/m²'],['Current albedo',tile.albedo.toFixed(3)],['Diffuse fraction',(tile.diffuse*100).toFixed(1)+'%'],['Net flux',signed(tile.net)+' W/m²'],['Absorbed sunlight change',signed(tile.shortwaveChange,3)+' W/m²']];
 if(tile.inputs){const p=tile.inputs;rows.push(['High / low vegetation',`${(p[0]*100).toFixed(1)} / ${(p[1]*100).toFixed(1)}%`],['High / low leaf area',`${p[7].toFixed(2)} / ${p[8].toFixed(2)} m²/m²`],['Elevation',`${p[6].toFixed(0)} m`],['Soil moisture · layers 1 / 2',`${p[2].toFixed(3)} / ${p[4].toFixed(3)} m³/m³`],['Temperature input · proxy',`${p[3].toFixed(2)} K`],['Snow · water equivalent',`${(p[9]*1000).toFixed(1)} mm`]);}
 else rows.push(['Initial sea-ice concentration',`${(tile.ice*100).toFixed(1)}%`]);
 if(tile.referenceInputs){const p=tile.referenceInputs;rows.push(['Original high / low cover',`${(p[0]*100).toFixed(1)} / ${(p[1]*100).toFixed(1)}%`]);}
 rows.push(['Coastal interpolation',tile.boundaryFlags&2?'Nearest valid source location':tile.boundaryFlags&1?'Valid neighbours only':'Bilinear source samples']);
 $('boundary-note').textContent=`SpeedyWeatherAssets climatology sampled for ${tile.boundary.date}. The reference retains these original inputs. `+(tile.inputs?'Painted cover, leaf area, elevation and snow update C45. Soil moisture and temperature stay prescribed; land-surface temperature supplies both soil-temperature inputs and the air-temperature proxy.':'Ocean albedo uses Jin with this prescribed fractional ice cover.');
 for(const [label,value] of rows){const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);list.append(div);}
 $('tile-albedo').disabled=false;$('tile-scatter').disabled=false;$('restore-tile').disabled=false;
 if(document.activeElement!==$('tile-albedo'))$('tile-albedo').value=tile.override===null?'':tile.override.toFixed(3);
 if(document.activeElement!==$('tile-scatter'))$('tile-scatter').value=tile.factor.toFixed(3);
 $('land-editor').disabled=!tile.inputs||landApplyIndex===tile.index;
 if(tile.inputs&&!landDraftDirty)for(const [id,index,scale,key] of landFields){
  const value=id==='tile-low-cover'?Math.min(tile.inputs[index]*scale,100-Number((tile.inputs[0]*100).toFixed(2))):tile.inputs[index]*scale;
  const display=value.toFixed(id==='tile-height'?0:id==='tile-snow'?1:2);
  $(id).value=display;landDraftValues[key]=tile.inputs[index];landDraftDisplay[key]=display;
 }
 if(!landDraftDirty)$('land-editor-note').textContent=tile.inputs?'High and low cover must total at most 100%. Soil inputs stay prescribed.':'Select a land tile to edit vegetation, elevation and snow.';
 if(brush==='inspect'||$('inspector').open)renderer.selection={latitude:tile.latitude*Math.PI/180,longitude:tile.longitude*Math.PI/180,radius:Number($('radius').value)*1000/RADIUS};renderer.draw(metrics?.orbital);
}
function inspect(location,open=true){
 if(!ready||!location)return;
 selected=cellAt(grid,location.latitude,location.longitude);coordinateDraftDirty=false;
 $('land-editor').disabled=true;$('tile-albedo').disabled=true;$('tile-scatter').disabled=true;$('restore-tile').disabled=true;
 $('inspector-summary').textContent='Loading selected tile…';
 worker.postMessage({type:'inspect',index:selected});if(open&&!$('inspector').open)$('inspector').showModal();
}
function sendPaint(edit){paintBusy=true;worker.postMessage({type:'edit',edit,brushEdit:true});}
function paint(location){
 if(!ready||!location)return;const edit={...location,radius:Number($('radius').value),mode:brush==='paint'?$('paint-mode').value:brush};
 if(drag)drag.lastPaint=location;
 if(paintBusy)pendingPaint=edit;else sendPaint(edit);
}
function selectBrush(next){brush=next;pendingPaint=null;document.querySelectorAll('[data-brush]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.brush===brush)));canvas.style.cursor=brush==='rotate'?'grab':'crosshair';}
function draw(){if(metrics)renderer.draw(metrics.orbital);}
$('run').addEventListener('click',()=>{if(running){pause();status('Paused. Change a forcing or inspect a tile.');}else start();});
$('step').addEventListener('click',()=>{if(!ready)return;pause();queuedDays+=30;const days=Math.min(8,queuedDays);if(!busy){queuedDays-=days;advance(days);}});
$('generate').addEventListener('click',()=>initialize());$('reset').addEventListener('click',()=>initialize(true));
['co2','wind','scatter','eccentricity','tilt'].forEach(id=>$(id).addEventListener('input',configure));$('width').addEventListener('change',configure);
$('radius').addEventListener('input',()=>{setOutputs();if(renderer.selection)renderer.selection.radius=Number($('radius').value)*1000/RADIUS;draw();});
$('earth-orbit').addEventListener('click',()=>{$('eccentricity').value=.0167;$('tilt').value=23.44;configure();});
$('present-co2').addEventListener('click',()=>{$('co2').value=PRESENT_CO2.ppm;configure();});
$('co2').addEventListener('change',configure);document.querySelectorAll('[data-co2]').forEach(button=>button.addEventListener('click',()=>{$('co2').value=button.dataset.co2;configure();}));
$('brushes').addEventListener('click',event=>{const button=event.target.closest('[data-brush]');if(button)selectBrush(button.dataset.brush);});
$('paint-mode').addEventListener('change',()=>{$('paint-note').textContent=paintNotes[$('paint-mode').value];$('paint-mode').title=paintNotes[$('paint-mode').value]+' Surface edits model reflection only.';selectBrush('paint');});
$('amazon-view').addEventListener('click',()=>{renderer.yaw=-62*Math.PI/180-renderer.spin;renderer.pitch=-5*Math.PI/180;renderer.zoom=1.35;selectBrush('paint');renderer.selection=null;draw();status('Amazon in view. Choose low vegetation and draw over the forest. Sunlight forcing updates immediately; run to follow temperature.');});
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$('map-legend').textContent={surface:'Earth coastlines · Jin ocean / C45 land',temperature:'Temperature · blue −35 / cream 2.5 / red 40°C',warming:'Warming vs reference · blue cooling / red warming (±5°C)',albedo:'Albedo · dark 0 / bright 1',scattering:'Diffuse fraction · dark 0 / bright 1',imbalance:'Net flux · blue cooling / red warming (±100 W/m²)'}[view];if(fields)renderer.update(fields,view);draw();});
canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!ready||drag)return;canvas.setPointerCapture(event.pointerId);drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,yaw:renderer.yaw,pitch:renderer.pitch};paintTime=performance.now();const location=renderer.coordinates(event);if(brush==='inspect')inspect(location);else if(brush!=='rotate')paint(location);});
canvas.addEventListener('pointermove',event=>{
 if(!ready||(drag&&event.pointerId!==drag.pointerId))return;const now=performance.now();
 if(brush!=='rotate'&&now-lastFrame>40){const p=renderer.coordinates(event);renderer.selection=p?{...p,radius:Number($('radius').value)*1000/RADIUS}:null;draw();lastFrame=now;}
 if(!drag)return;
 if(brush==='rotate'){renderer.yaw=drag.yaw-(event.clientX-drag.x)*.007;renderer.pitch=clamp(drag.pitch+(event.clientY-drag.y)*.007,-1.45,1.45);draw();}
 else if(brush!=='inspect'&&now-paintTime>100){paint(renderer.coordinates(event));paintTime=now;}
});
function endDrag(event){
 if(!drag||event.pointerId!==drag.pointerId)return;
 if(event.type==='pointerup'&&brush!=='rotate'&&brush!=='inspect'){
  const point=renderer.coordinates(event),last=drag.lastPaint;
  if(point&&(!last||Math.abs(point.latitude-last.latitude)>1e-8||Math.abs(Math.atan2(Math.sin(point.longitude-last.longitude),Math.cos(point.longitude-last.longitude)))>1e-8))paint(point);
 }else if(event.type==='pointercancel')pendingPaint=null;
 drag=null;
}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);canvas.addEventListener('pointerleave',()=>{if(!drag){renderer.selection=null;draw();}});
canvas.addEventListener('wheel',event=>{event.preventDefault();renderer.zoom=clamp(renderer.zoom*Math.exp(-event.deltaY*.001),.65,2.5);draw();},{passive:false});
canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Enter'].includes(event.key))return;event.preventDefault();if(event.key==='ArrowLeft')renderer.yaw-=.08;if(event.key==='ArrowRight')renderer.yaw+=.08;if(event.key==='ArrowUp')renderer.pitch=clamp(renderer.pitch+.08,-1.45,1.45);if(event.key==='ArrowDown')renderer.pitch=clamp(renderer.pitch-.08,-1.45,1.45);if(event.key==='+'||event.key==='=')renderer.zoom=clamp(renderer.zoom*1.1,.65,2.5);if(event.key==='-')renderer.zoom=clamp(renderer.zoom/1.1,.65,2.5);if(event.key==='Enter')inspect({latitude:renderer.pitch,longitude:renderer.yaw+renderer.spin});draw();});
$('zoom-in').addEventListener('click',()=>{renderer.zoom=clamp(renderer.zoom*1.15,.65,2.5);draw();});$('zoom-out').addEventListener('click',()=>{renderer.zoom=clamp(renderer.zoom/1.15,.65,2.5);draw();});$('home-view').addEventListener('click',()=>{renderer.yaw=-.45-renderer.spin;renderer.pitch=.18;renderer.zoom=1;draw();});
$('inspector-link').addEventListener('click',()=>{if(selected<0)inspect({latitude:0,longitude:0});else $('inspector').showModal();});$('science-link').addEventListener('click',()=>$('science').showModal());document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
for(const id of ['inspect-lat','inspect-lon'])$(id).addEventListener('input',()=>{coordinateDraftDirty=true;});
$('inspect-coordinate').addEventListener('click',()=>{if(!$('inspect-lat').reportValidity()||!$('inspect-lon').reportValidity())return;inspect({latitude:Number($('inspect-lat').value)*Math.PI/180,longitude:Number($('inspect-lon').value)*Math.PI/180},false);});
$('tile-albedo').addEventListener('change',()=>{if(selected<0)return;const input=$('tile-albedo');if(input.value===''){worker.postMessage({type:'edit',edit:{mode:'albedo',index:selected,value:NaN}});}else if(input.checkValidity())worker.postMessage({type:'edit',edit:{mode:'albedo',index:selected,value:input.valueAsNumber}});});
$('tile-scatter').addEventListener('change',()=>{if(selected<0||!$('tile-scatter').reportValidity()||!Number.isFinite($('tile-scatter').valueAsNumber))return;worker.postMessage({type:'edit',edit:{mode:'scatter',index:selected,value:$('tile-scatter').valueAsNumber}});});$('restore-tile').addEventListener('click',()=>{if(selected>=0){landDraftDirty=false;worker.postMessage({type:'edit',edit:{mode:'restore',index:selected}});}});
for(const [id] of landFields)$(id).addEventListener('input',()=>{landDraftDirty=true;$('land-editor-note').textContent='Unsaved inputs. Apply to update C45; high and low cover must total at most 100%.';});
$('apply-land').addEventListener('click',()=>{
 if(!ready||selected<0||$('land-editor').disabled)return;
 const value={};for(const [id,,scale,key] of landFields){if(!$(id).reportValidity()||!Number.isFinite($(id).valueAsNumber))return;if($(id).valueAsNumber!==Number(landDraftDisplay[key]))value[key]=$(id).valueAsNumber/scale;}
 if(Object.keys(value).length===0){landDraftDirty=false;$('land-editor-note').textContent='No land inputs changed.';return;}
 if((value.high??landDraftValues.high)+(value.low??landDraftValues.low)>1+1e-7){$('land-editor-note').textContent='Reduce cover: high and low vegetation must total at most 100%.';return;}
 landApplyIndex=selected;$('land-editor').disabled=true;
 worker.postMessage({type:'edit',edit:{mode:'land-inputs',index:selected,value}});
});
$('export').addEventListener('click',()=>{
 if(!metrics)return;const rows=['model_day,warming_c,ecs_envelope_lower_c,ecs_envelope_upper_c,imbalance_change_w_m2,total_imbalance_w_m2,stored_heat_zj'];
 const records=history.slice();if(records.at(-1)?.[0]!==metrics.day)records.push([metrics.day,metrics.warming,metrics.lower,metrics.upper,metrics.perturbation,metrics.imbalance,metrics.heat]);
 for(const row of records)rows.push(row.map(value=>Number(value).toFixed(6)).join(','));
 const url=URL.createObjectURL(new Blob([rows.join('\n')+'\n'],{type:'text/csv'})),link=document.createElement('a');link.href=url;link.download='reflect-climate-history.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
new ResizeObserver(()=>{renderer.resize();draw();}).observe(canvas);
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();pause();ready=false;status('Graphics context lost. Reload this page to restore the globe.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running){pause();status('Paused while this page is hidden. Resume when you are ready.');}});
const co2Date=new Date(PRESENT_CO2.date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
$('co2').value=PRESENT_CO2.ppm;$('co2-source').textContent=`NOAA estimate · ${co2Date}`;$('co2-source').href=PRESENT_CO2.url;
window.addEventListener('pagehide',()=>{pause();worker?.terminate();});setOutputs();renderer.resize();initialize();
