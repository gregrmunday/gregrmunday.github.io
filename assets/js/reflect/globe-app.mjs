import { sphericalGrid, cellAt, clamp, YEAR, RADIUS, TAU, LAND_FIELDS, MODEL_VERSION } from './globe-model.mjs';
import { GlobeRenderer } from './globe-render.mjs';
import { PRESENT_CO2 } from './co2-baseline.mjs';
const today=new Date(),startDay=(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate())-Date.UTC(today.getUTCFullYear(),0,1))/86400000;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let flatCursor={latitude:0,longitude:0};
let displayDay=0,lastSceneDraw=0,sceneDrawRequest=0,loadedSetup=null,initialSettings=null,analysisRequest=0,analysisResult=null,inspection=null,analysisPending=false;
const $=id=>document.getElementById(id),canvas=$('planet'),renderer=new GlobeRenderer(canvas),names=['Ocean','Sea ice','High vegetation','Low vegetation','Bare soil','Snow'];
let worker=null,grid=null,fields=null,metrics=null,history=[],selected=-1,ready=false,running=false,busy=false,queuedHours=0,brush='rotate',view='surface',animation=0,lastTick=0,accumulator=0,configurationTimer=0,paintTime=0,drag=null,lastFrame=0;
let paintBusy=false,pendingPaint=null,inFlightHours=0,inFlightManual=false;
const MAX_BATCH_HOURS=192;
let landDraftIndex=-1,landDraftDirty=false;
let coordinateDraftDirty=false,landApplyIndex=-1,landDraftValues={},landDraftDisplay={};
const landFields=[['tile-high-cover',0,100,'high',2],['tile-low-cover',1,100,'low',2],['tile-high-lai',7,1,'highLai',2],['tile-low-lai',8,1,'lowLai',2],['tile-height',6,1,'height',0],['tile-snow',9,1000,'snow',1],['tile-top-moisture',2,1,'topMoisture',3],['tile-deep-moisture',4,1,'deepMoisture',3],['tile-top-temperature',3,1,'topTemperature',2],['tile-deep-temperature',5,1,'deepTemperature',2],['tile-air-temperature',10,1,'airTemperature',2]];
const paintNotes={
 'low-vegetation':'Convert high cover to low; low leaf area → 2.',
 'high-vegetation':'Convert low cover to high; high leaf area → 5.',
 'bare-ground':'Remove vegetation and leaf area; keep soil and snow.',
 'snow-cover':'Add up to 150 mm water-equivalent snow.',
 'raise-terrain':'Gaussian lift: +100 m at centre, zero at edge.',
 'lower-terrain':'Gaussian lowering: −100 m at centre, zero at edge.',
 brighten:'Prescribe a brighter albedo; bypass the learned / Jin equations.',
 darken:'Prescribe a darker albedo; bypass the learned / Jin equations.',
 scatter:'Increase atmospheric scattering over the patch.',
 clear:'Decrease atmospheric scattering over the patch.'
};
const signed=(x,digits=2)=>(Number(x.toFixed(digits))<0?'−':'+')+Math.abs(x).toFixed(digits);
function status(text){$('status').textContent=text;}
function config(){return{...initialSettings,spacing:Number($('resolution').value),seed:Number($('seed').value)||0,co2:Number($('co2').value),wind:Number($('wind').value),startDay:initialSettings?.startDay??startDay,startHour:initialSettings?.startHour??12,initialMonth:initialSettings?.initialMonth??today.getUTCMonth(),monthFraction:initialSettings?.monthFraction??(today.getUTCDate()-1)/new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,0)).getUTCDate(),boundaryDate:initialSettings?.boundaryDate??today.toISOString().slice(0,10),landKernel:$('land-kernel').value,screening:Number($('screening').value)/100,scatter:Number($('scatter').value)/100,width:Number($('width').value),eccentricity:Number($('eccentricity').value),tilt:Number($('tilt').value)};}
function setOutputs(){
 $('screening-value').textContent=`${$('screening').value}%`;$('wind-value').textContent=`${$('wind').value} m/s`;$('co2-value').textContent=`${$('co2').value} ppm`;$('scatter-value').textContent=`${$('scatter').value}%`;$('eccentricity-value').textContent=Number($('eccentricity').value).toFixed(4);$('tilt-value').textContent=Number($('tilt').value).toFixed(2)+'°';$('radius-value').textContent=$('radius').value+' km';
}
function initialize(restore=false){
 if(restore){initialSettings=null;loadedSetup=null;}
 analysisRequest++;analysisResult=null;inspection=null;analysisPending=false;$('sensitivity-chart').hidden=true;$('sensitivity-run').disabled=$('sensitivity-apply').disabled=true;
 pause();cancelAnimationFrame(sceneDrawRequest);sceneDrawRequest=0;if(worker)worker.terminate();fields=null;metrics=null;history=[];selected=-1;ready=false;busy=false;paintBusy=false;pendingPaint=null;drag=null;queuedHours=0;inFlightHours=0;inFlightManual=false;accumulator=0;displayDay=0;renderer.spin=0;renderer.selection=null;
 $('land-editor').disabled=true;$('tile-albedo').disabled=true;$('tile-scatter').disabled=true;$('restore-tile').disabled=true;
 landDraftIndex=-1;landDraftDirty=false;
 coordinateDraftDirty=false;landApplyIndex=-1;landDraftValues={};landDraftDisplay={};
 if(restore){$('land-kernel').value='cack';$('screening').value=100;$('co2').value=PRESENT_CO2.ppm;$('wind').value=5;$('scatter').value=30;$('width').value=120;$('eccentricity').value=.0167;$('tilt').value=23.44;setOutputs();}
 $('run').disabled=true;$('run').textContent='Building…';$('step').disabled=true;$('export').disabled=true;$('stage-label').textContent='BUILDING YOUR PLANET';$('save-setup').disabled=$('load-setup').disabled=true;$('undo').disabled=$('redo').disabled=true;status('Calibrating the unchanged reference orbit…');
 worker=new Worker(new URL('./globe-worker.mjs',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  if(data.type==='error'){pause();busy=false;paintBusy=false;pendingPaint=null;ready=false;status(`Simulation paused: ${data.message}. Reset to retry.`);$('stage-label').textContent='SIMULATION PAUSED';return;}
  if(data.type==='edit-error'){
   if(data.brushEdit){paintBusy=false;pendingPaint=null;}
   if(data.index===landApplyIndex){landApplyIndex=-1;if(data.index===selected){landDraftDirty=true;$('land-editor').disabled=false;$('land-editor-note').textContent=data.message;}}
   status(`Edit rejected: ${data.message}. The climate state is preserved.`);return;
  }
  if(data.type==='sensitivity-bounds'){if(data.request===analysisRequest&&data.index===selected)resetSensitivityRange(data);return;}
  if(data.type==='sensitivity-progress'){if(data.request===analysisRequest)$('sensitivity-status').textContent=`Calculating daily response · ${Math.round(data.progress*100)}%`;return;}
  if(data.type==='sensitivity-error'){if(data.request===analysisRequest){analysisPending=false;$('sensitivity-status').textContent=data.message;$('sensitivity-run').disabled=!inspection?.inputs;}return;}
  if(data.type==='sensitivity-result'){if(data.result.request===analysisRequest&&data.result.index===selected){analysisPending=false;analysisResult=data.result;$('sensitivity-run').disabled=false;$('sensitivity-status').textContent=`${data.result.cells} land cells · ${Math.round(data.result.area).toLocaleString()} km² · snapshot at ${(data.result.day/YEAR).toFixed(3)} model years`;drawSensitivity();}return;}
  if(data.type==='saved-setup'){downloadJSON(data.setup);return;}
  if(data.type==='loaded-surface'){loadedSetup=null;status('Loaded surface setup. A new CO₂-equilibrium run starts with the saved intervention applied.');start();}
  if(data.type==='loading'){status('Loading local surface maps and CACK monthly kernels…');return;}
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
   if(running&&!reducedMotion.matches&&!drag&&brush==='rotate')renderer.spin-=TAU*(data.metrics.day-displayDay)/YEAR;
   displayDay=data.metrics.day;
   fields=data.fields;metrics=data.metrics;history=data.history;updateUI();if(data.inspection)showInspection(data.inspection,false);if(data.type==='advanced'&&running)scheduleSceneDraw();else draw();
  }
  if(data.type==='export-ready')downloadHistory();
  if(data.type==='edited'){
   const edit=data.editSummary;
   if(edit){
    const landMode=['low-vegetation','high-vegetation','bare-ground','snow-cover','raise-terrain','lower-terrain','land-inputs','land-region'].includes(edit.mode);
    let action='Painted a response patch.';
    if(edit.mode==='undo'||edit.mode==='redo')action=`${edit.mode==='undo'?'Undid':'Redid'} the last surface edit.`;
    else if(edit.mode==='restore')action='Restored original surface inputs.';
    else if(landMode)action=edit.changedCells?`Updated ${edit.changedCells.toLocaleString()} land tiles (${Math.round(edit.area).toLocaleString()} km²).`:'No land inputs changed: the patch has no eligible land or already matches this setting.';
    status(`${action} Instantaneous surface-edit TOA forcing: ${signed(metrics.surfaceForcing,3)} W/m². Temperature continues from the current state.`);
   }
   if(data.brushEdit){paintBusy=false;if(pendingPaint){const edit=pendingPaint;pendingPaint=null;sendPaint(edit);}}
  }
  if(data.type==='ready'){
   ready=true;$('run').disabled=false;$('run').textContent='▶ Run climate';$('step').disabled=false;$('export').disabled=false;$('stage-label').textContent='YOUR REFERENCE PLANET';
   $('save-setup').disabled=$('load-setup').disabled=false;
   if(loadedSetup)worker.postMessage({type:'load-surface',edits:loadedSetup.edits,commit:loadedSetup.boundaryCommit});else start();
  }
  if(data.type==='advanced'){
   const remaining=Math.max(0,inFlightHours-data.completedHours);
   if(inFlightManual)queuedHours+=remaining;else if(running)accumulator=Math.min(2*MAX_BATCH_HOURS,accumulator+remaining);
   busy=false;inFlightHours=0;inFlightManual=false;
   if(queuedHours>0){const count=Math.min(MAX_BATCH_HOURS,queuedHours);queuedHours-=count;advance(count,true);status(`Integrating ${queuedHours} queued hours…`);}
   else if(!running){$('stage-label').textContent='CLIMATE PAUSED';status('Paused. Changes to the controls update radiation immediately; temperature evolves when you run.');}
  }
 };
 worker.onerror=()=>{pause();busy=false;ready=false;status('The climate worker could not start. Reload or reset to retry.');};
 worker.postMessage({type:'initialize',config:config()});
}
function configure(){invalidateAnalysis();setOutputs();clearTimeout(configurationTimer);configurationTimer=setTimeout(()=>{if(ready){worker.postMessage({type:'configure',config:config()});status(running?'Forcing updated. Temperature continues integrating from the current state.':'Forcing updated. Resume to integrate temperature.');}},90);}
function start(){if(!ready||running)return;if(analysisPending)invalidateAnalysis();running=true;lastTick=performance.now();accumulator=0;$('run').textContent='Ⅱ Pause';$('stage-label').textContent='FOLLOWING THE CLIMATE';$('live-dot').classList.add('running');status('FaIR three-layer response · hourly physics · display every 24 model hours · playback is a target; every model hour is integrated.');animation=requestAnimationFrame(tick);}
function pause(){running=false;queuedHours=0;inFlightManual=false;cancelAnimationFrame(animation);$('live-dot').classList.remove('running');if(ready){$('run').textContent='▶ Run climate';$('stage-label').textContent='CLIMATE PAUSED';worker?.postMessage({type:'snapshot'});}}
function advance(hours,manual=false){if(!ready||busy)return;busy=true;inFlightHours=hours;inFlightManual=manual;worker.postMessage({type:'advance',hours,forceOutput:manual});}
function tick(now){
 if(!running)return;accumulator=Math.min(2*MAX_BATCH_HOURS,accumulator+(now-lastTick)/1000*Number($('speed').value)*24);lastTick=now;
 if(!busy&&accumulator>=Math.min(MAX_BATCH_HOURS,Math.max(1,Number($('speed').value)*24/12))){const hours=Math.min(MAX_BATCH_HOURS,Math.floor(accumulator));accumulator-=hours;advance(hours);}
 animation=requestAnimationFrame(tick);
}
function updateUI(){
 if(!metrics)return;const m=metrics,month=Math.floor(m.orbital.day/YEAR*12),months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 $('surface-warming').firstChild.nodeValue=signed(m.surfaceWarming,4);$('surface-range').textContent=`Edited − control · scenarios ${signed(m.surfaceLower,4)} to ${signed(m.surfaceUpper,4)}°C`;$('surface-forcing').firstChild.nodeValue=m.daily?signed(m.daily.surfaceForcing,4):'—';$('surface-instant').textContent=`Instantaneous: ${signed(m.surfaceForcing,4)} W/m²`;$('surface-annual').textContent=m.annualSurfaceForcing===null?'Annual mean: after one year':`Annual mean: ${signed(m.annualSurfaceForcing,4)} W/m²`;$('undo').disabled=!m.undoCount;$('redo').disabled=!m.redoCount;
 $('warming').firstChild.nodeValue=signed(m.warming);$('imbalance').firstChild.nodeValue=signed(m.perturbation);$('temperature').firstChild.nodeValue=m.temperature.toFixed(2);
 $('absolute-range').textContent=`Scenarios: ${(m.temperature-m.warming+m.lower).toFixed(2)} to ${(m.temperature-m.warming+m.upper).toFixed(2)}°C`;
 $('temperature-range').textContent=`ECS scenarios: ${signed(m.lower)} to ${signed(m.upper)}°C`;$('co2-forcing').textContent=`CO₂ forcing: ${signed(m.forcing)} W/m²`;$('sunlight-forcing').textContent=`Sunlight forcing: ${signed(m.shortwaveForcing,3)} W/m²`;$('stored-heat').textContent=`Surface-edit heat change: ${signed(m.surfaceHeat,4)} ZJ`;
 const heat=$('heat-stores');heat.replaceChildren();for(const [i,label] of ['Surface / mixed layer','Intermediate ocean','Deep ocean'].entries()){const div=document.createElement('div');div.textContent=`${label}: ${signed(m.layerHeat[i],4)} ZJ`;heat.append(div);}
 const minutes=Math.round(m.orbital.utcHour*60)%1440,clock=`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
 $('time-label').textContent=`${(m.day/YEAR).toFixed(2)} y · ${clock} UTC`;$('season-label').textContent=`Year ${Math.floor(m.day/YEAR)+1} · ${months[month]}`;
 $('distance').textContent=`${m.orbital.distance.toFixed(4)} AU`;$('declination').textContent=`${signed(m.orbital.declination*180/Math.PI,1)}° solar latitude`;
 const flux=$('flux-period').value==='daily'?m.daily:m;
 $('flux-period-note').textContent=flux?($('flux-period').value==='daily'?`Last complete day · hours ${flux.startHour}–${flux.endHour}`:'Instantaneous endpoint'):'Awaiting first full day';
 for(const name of ['incoming','reflected','outgoing']){$(name).textContent=flux?flux[name].toFixed(1):'—';$(`${name}-bar`).style.width=`${flux?clamp(flux[name]/450)*100:0}%`;}
 $('total-net').textContent=flux?signed(flux.imbalance,2):'—';$('annual-net').textContent=m.annual===null?'After one year':signed(m.annual,2)+' W/m²';
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
 const points=history.map(p=>[p[0],p[7],p[8],p[9]]);if(!points.length||points.at(-1)[0]!==metrics.day)points.push([metrics.day,metrics.surfaceWarming,metrics.surfaceLower,metrics.surfaceUpper]);
 let min=-.0001,max=.0001;for(const p of points){min=Math.min(min,p[2]);max=Math.max(max,p[3]);}const range=max-min;min-=range*.12;max+=range*.12;
 const start=points[0][0],end=Math.max(start+30,metrics.day),x=day=>pad+(day-start)/(end-start)*(w-pad-8),y=t=>h-21-(t-min)/(max-min)*(h-33);
 ctx.strokeStyle='#c8d2be';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(pad,y(0));ctx.lineTo(w-8,y(0));ctx.stroke();ctx.setLineDash([]);
 ctx.fillStyle='#96af6850';ctx.beginPath();for(let j=0;j<points.length;j++)j?ctx.lineTo(x(points[j][0]),y(points[j][3])):ctx.moveTo(x(points[j][0]),y(points[j][3]));for(let j=points.length-1;j>=0;j--)ctx.lineTo(x(points[j][0]),y(points[j][2]));ctx.closePath();ctx.fill();
 ctx.strokeStyle='#347860';ctx.lineWidth=2;ctx.beginPath();for(let j=0;j<points.length;j++)j?ctx.lineTo(x(points[j][0]),y(points[j][1])):ctx.moveTo(x(points[j][0]),y(points[j][1]));ctx.stroke();
 ctx.fillStyle='#627361';ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillText(`${max.toFixed(max-min<.02?4:2)}°`,0,12);ctx.fillText(`${min.toFixed(max-min<.02?4:2)}°`,0,h-21);ctx.fillText(`${(start/YEAR).toFixed(1)} y`,pad,h-4);ctx.textAlign='right';ctx.fillText(`${(metrics.day/YEAR).toFixed(1)} years`,w-8,h-4);
}
function showInspection(tile,redraw=true){
 // Only an explicit selection request can change the selected tile. Older
 // snapshots can still contain the previous inspector selection.
 if(!tile||tile.index!==selected)return;
 const changedSelection=inspection?.index!==tile.index;inspection=tile;
 if(changedSelection)requestSensitivityBounds();
 $('sensitivity-run').disabled=!tile.inputs||analysisPending;$('sensitivity-apply').disabled=!tile.inputs;
 if(!coordinateDraftDirty){$('inspect-lat').value=tile.latitude.toFixed(2);$('inspect-lon').value=tile.longitude.toFixed(2);}
 if(landDraftIndex!==tile.index){landDraftIndex=tile.index;landDraftDirty=false;}
 $('inspector-summary').textContent=`${names[tile.kind]} · ${tile.latitude.toFixed(2)}° latitude, ${tile.longitude.toFixed(2)}° longitude · ${Math.round(tile.area).toLocaleString()} km²`;
 const list=$('tile-summary');list.replaceChildren();
 const rows= [['Model temperature',tile.temperature.toFixed(2)+'°C'],['Incoming light',tile.incoming.toFixed(1)+' W/m²'],['Current albedo',tile.albedo.toFixed(3)],['Diffuse fraction',(tile.diffuse*100).toFixed(1)+'%'],['Net flux',signed(tile.net)+' W/m²'],['Surface absorption change',signed(tile.surfaceShortwaveChange,3)+' W/m²'],['TOA absorption change',signed(tile.shortwaveChange,3)+' W/m²'],['Global forcing contribution',signed(tile.globalContribution,6)+' W/m²'],['Albedo change',signed(tile.albedoChange,4)],['Reflection clipped',tile.clipped?'Yes · physical bounds':'No']];
 if(tile.inputs){const p=tile.inputs;rows.push(['High / low vegetation',`${(p[0]*100).toFixed(1)} / ${(p[1]*100).toFixed(1)}%`],['High / low leaf area',`${p[7].toFixed(2)} / ${p[8].toFixed(2)} m²/m²`],['Elevation',`${p[6].toFixed(0)} m`],['Soil moisture · top / deep',`${p[2].toFixed(3)} / ${p[4].toFixed(3)} m³/m³`],['Soil temperature · top / deep',`${p[3].toFixed(2)} / ${p[5].toFixed(2)} K`],['Air temperature · learned albedo input',`${p[10].toFixed(2)} K`],['Snow · water equivalent',`${(p[9]*1000).toFixed(1)} mm`]);}
 else rows.push(['Initial sea-ice concentration',`${(tile.ice*100).toFixed(1)}%`]);
 if(tile.referenceInputs){const p=tile.referenceInputs;rows.push(['Original high / low cover',`${(p[0]*100).toFixed(1)} / ${(p[1]*100).toFixed(1)}%`]);}
 rows.push(['Coastal interpolation',tile.boundaryFlags&2?'Nearest valid source location':tile.boundaryFlags&1?'Valid neighbours only':'Bilinear source samples']);
 $('boundary-note').textContent=`SpeedyWeatherAssets climatology sampled for ${tile.boundary.date}. The reference retains these original inputs. `+(tile.inputs?'All eleven learned albedo inputs can be edited independently below. Initially, land-surface temperature supplies both soil temperatures and the air-temperature proxy. Temperature inputs affect albedo; they do not set the simulated climate temperature.':'Ocean albedo uses Jin with this prescribed fractional ice cover.');
 for(const [label,value] of rows){const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);list.append(div);}
 $('tile-albedo').disabled=false;$('tile-scatter').disabled=false;$('restore-tile').disabled=false;
 if(document.activeElement!==$('tile-albedo'))$('tile-albedo').value=tile.override===null?'':tile.override.toFixed(3);
 if(document.activeElement!==$('tile-scatter'))$('tile-scatter').value=tile.factor.toFixed(3);
 $('land-editor').disabled=!tile.inputs||landApplyIndex===tile.index;
 if(tile.inputs&&!landDraftDirty)for(const [id,index,scale,key,digits] of landFields){
  const value=id==='tile-low-cover'?Math.min(tile.inputs[index]*scale,100-Number((tile.inputs[0]*100).toFixed(2))):tile.inputs[index]*scale;
  const display=value.toFixed(digits);
  $(id).value=display;landDraftValues[key]=tile.inputs[index];landDraftDisplay[key]=display;
 }
 if(!landDraftDirty)$('land-editor-note').textContent=tile.inputs?'Inputs change independently. High and low cover must total at most 100%.':'Select a land tile to edit its learned albedo inputs.';
 if(brush==='inspect'||$('inspector').open)renderer.selection={latitude:tile.latitude*Math.PI/180,longitude:tile.longitude*Math.PI/180,radius:Number($('radius').value)*1000/RADIUS};if(redraw)draw();
}
function inspect(location,open=true){
 if(!ready||!location)return;
 invalidateAnalysis();inspection=null;$('sensitivity-run').disabled=$('sensitivity-apply').disabled=true;selected=cellAt(grid,location.latitude,location.longitude);coordinateDraftDirty=false;
 $('land-editor').disabled=true;$('tile-albedo').disabled=true;$('tile-scatter').disabled=true;$('restore-tile').disabled=true;
 $('inspector-summary').textContent='Loading selected tile…';
 worker.postMessage({type:'inspect',index:selected});if(open&&!$('inspector').open)$('inspector').show();
}
function sendPaint(edit){invalidateAnalysis();paintBusy=true;worker.postMessage({type:'edit',edit,brushEdit:true});}
function paint(location){
 if(!ready||!location)return;const edit={...location,radius:Number($('radius').value),mode:brush==='paint'?$('paint-mode').value:brush};
 if(drag)drag.lastPaint=location;
 if(paintBusy)pendingPaint=edit;else sendPaint(edit);
}
function selectBrush(next){brush=next;renderer.editing=brush!=='rotate';renderer.selection=null;draw();pendingPaint=null;document.querySelectorAll('[data-brush]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.brush===brush)));canvas.style.cursor=brush==='rotate'?'grab':'crosshair';}
function draw(){
 cancelAnimationFrame(sceneDrawRequest);sceneDrawRequest=0;
 if(metrics&&fields){renderer.update(fields,view);renderer.draw(metrics.orbital);lastSceneDraw=performance.now();}
}
function scheduleSceneDraw(){
 if(sceneDrawRequest)return;
 const render=now=>{sceneDrawRequest=0;if(now-lastSceneDraw<34){sceneDrawRequest=requestAnimationFrame(render);return;}draw();};
 sceneDrawRequest=requestAnimationFrame(render);
}
$('run').addEventListener('click',()=>{if(running){pause();status('Paused. Change a forcing or inspect a tile.');}else start();});
$('step').addEventListener('click',()=>{if(!ready)return;if(running)pause();if(analysisPending)invalidateAnalysis();queuedHours++;if(!busy){queuedHours--;advance(1,true);}});
$('generate').addEventListener('click',()=>initialize());$('reset').addEventListener('click',()=>initialize(true));
['co2','wind','scatter','screening','eccentricity','tilt'].forEach(id=>$(id).addEventListener('input',configure));$('width').addEventListener('change',configure);$('land-kernel').addEventListener('change',configure);
$('radius').addEventListener('input',()=>{if($('sensitivity-scope').value==='region')requestSensitivityBounds();setOutputs();if(renderer.selection)renderer.selection.radius=Number($('radius').value)*1000/RADIUS;draw();});
$('earth-orbit').addEventListener('click',()=>{$('eccentricity').value=.0167;$('tilt').value=23.44;configure();});
$('present-co2').addEventListener('click',()=>{$('co2').value=PRESENT_CO2.ppm;configure();});
$('co2').addEventListener('change',configure);document.querySelectorAll('[data-co2]').forEach(button=>button.addEventListener('click',()=>{$('co2').value=button.dataset.co2;configure();}));
$('brushes').addEventListener('click',event=>{const button=event.target.closest('[data-brush]');if(button)selectBrush(button.dataset.brush);});
$('paint-mode').addEventListener('change',()=>{$('paint-note').textContent=paintNotes[$('paint-mode').value];$('paint-mode').title=paintNotes[$('paint-mode').value]+' Surface edits model reflection only.';selectBrush('paint');});
$('amazon-view').addEventListener('click',()=>{renderer.yaw=-62*Math.PI/180-renderer.spin;renderer.pitch=-5*Math.PI/180;renderer.zoom=1.35;selectBrush('paint');renderer.selection=null;draw();status('Amazon in view. Choose low vegetation and draw over the forest. Sunlight forcing updates immediately; run to follow temperature.');});
$('map-view').addEventListener('change',()=>{
 view=$('map-view').value;
 const legends={surface:['Earth coastlines · Jin ocean / learned land'],temperature:['Illustrative temperature','−35°C','40°C'],warming:['Warming vs 280 ppm','−5°C','+5°C'],response:['Surface edits − control · illustrative local pattern','−2°C','+2°C'],'delta-albedo':['Surface albedo change · instantaneous','−0.3','+0.3'],'delta-sunlight':['Surface absorption change · instantaneous','−150 W/m²','+150 W/m²'],albedo:['Surface albedo · instantaneous','0','1'],scattering:['Diffuse fraction · instantaneous','0','1'],imbalance:['Net TOA flux · instantaneous','−100 W/m²','+100 W/m²']},legend=legends[view];
 $('map-legend').textContent=legend[0];$('colour-key').hidden=legend.length<3;$('colour-min').textContent=legend[1]??'';$('colour-max').textContent=legend[2]??'';
 $('colour-key').className=view==='temperature'?'temperature':view==='delta-albedo'?'albedo-change':['albedo','scattering'].includes(view)?'sequential':'diverging';
 if(fields)renderer.update(fields,view);draw();
});
$('projection').addEventListener('click',()=>{renderer.flat=!renderer.flat;$('zoom-in').disabled=$('zoom-out').disabled=renderer.flat;$('projection').setAttribute('aria-pressed',String(renderer.flat));$('projection').textContent=renderer.flat?'Globe':'Flat map';canvas.setAttribute('aria-label',renderer.flat?'Interactive global map. Arrow keys move the selection; Enter inspects it. Select Inspect or Draw surface and click the map.':'Interactive globe. Drag to rotate; arrow keys rotate and Enter inspects the centre.');draw();});
$('flux-period').addEventListener('change',updateUI);
canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!ready||drag)return;canvas.setPointerCapture(event.pointerId);drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,yaw:renderer.yaw,pitch:renderer.pitch};paintTime=performance.now();const location=renderer.coordinates(event);if(brush==='inspect')inspect(location);else if(brush!=='rotate')paint(location);});
canvas.addEventListener('pointermove',event=>{
 if(!ready||(drag&&event.pointerId!==drag.pointerId))return;const now=performance.now();
 if(brush!=='rotate'&&now-lastFrame>40){const p=renderer.coordinates(event);renderer.selection=p?{...p,radius:Number($('radius').value)*1000/RADIUS}:null;draw();lastFrame=now;}
 if(!drag)return;
 if(brush==='rotate'&&!renderer.flat){renderer.yaw=drag.yaw-(event.clientX-drag.x)*.007;renderer.pitch=clamp(drag.pitch+(event.clientY-drag.y)*.007,-1.45,1.45);draw();}
 else if(brush!=='rotate'&&brush!=='inspect'&&now-paintTime>100){paint(renderer.coordinates(event));paintTime=now;}
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
canvas.addEventListener('wheel',event=>{if(renderer.flat)return;event.preventDefault();renderer.zoom=clamp(renderer.zoom*Math.exp(-event.deltaY*.001),.65,2.5);draw();},{passive:false});
canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Enter'].includes(event.key))return;event.preventDefault();if(renderer.flat){
 if(event.key==='ArrowLeft')flatCursor.longitude-=.08;if(event.key==='ArrowRight')flatCursor.longitude+=.08;
 if(event.key==='ArrowUp')flatCursor.latitude=clamp(flatCursor.latitude+.08,-Math.PI/2,Math.PI/2);if(event.key==='ArrowDown')flatCursor.latitude=clamp(flatCursor.latitude-.08,-Math.PI/2,Math.PI/2);
 flatCursor.longitude=((flatCursor.longitude+Math.PI)%TAU+TAU)%TAU-Math.PI;
 renderer.selection={...flatCursor,radius:Number($('radius').value)*1000/RADIUS};if(event.key==='Enter')inspect(flatCursor);draw();return;
 }if(event.key==='ArrowLeft')renderer.yaw-=.08;if(event.key==='ArrowRight')renderer.yaw+=.08;if(event.key==='ArrowUp')renderer.pitch=clamp(renderer.pitch+.08,-1.45,1.45);if(event.key==='ArrowDown')renderer.pitch=clamp(renderer.pitch-.08,-1.45,1.45);if(event.key==='+'||event.key==='=')renderer.zoom=clamp(renderer.zoom*1.1,.65,2.5);if(event.key==='-')renderer.zoom=clamp(renderer.zoom/1.1,.65,2.5);if(event.key==='Enter')inspect({latitude:renderer.pitch,longitude:renderer.yaw+renderer.spin});draw();});
$('zoom-in').addEventListener('click',()=>{renderer.zoom=clamp(renderer.zoom*1.15,.65,2.5);draw();});$('zoom-out').addEventListener('click',()=>{renderer.zoom=clamp(renderer.zoom/1.15,.65,2.5);draw();});$('home-view').addEventListener('click',()=>{renderer.yaw=-.45-renderer.spin;renderer.pitch=.18;renderer.zoom=1;draw();});
$('inspector-link').addEventListener('click',()=>{if(selected<0)inspect({latitude:0,longitude:0});else{$('inspector').show();if(ready)worker.postMessage({type:'inspect',index:selected});}});$('science-link').addEventListener('click',()=>$('science').showModal());document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
for(const id of ['inspect-lat','inspect-lon'])$(id).addEventListener('input',()=>{coordinateDraftDirty=true;});
$('inspect-coordinate').addEventListener('click',()=>{if(!$('inspect-lat').reportValidity()||!$('inspect-lon').reportValidity())return;inspect({latitude:Number($('inspect-lat').value)*Math.PI/180,longitude:Number($('inspect-lon').value)*Math.PI/180},false);});
$('tile-albedo').addEventListener('change',()=>{if(selected<0)return;invalidateAnalysis();const input=$('tile-albedo');if(input.value===''){worker.postMessage({type:'edit',edit:{mode:'albedo',index:selected,value:NaN}});}else if(input.checkValidity())worker.postMessage({type:'edit',edit:{mode:'albedo',index:selected,value:input.valueAsNumber}});});
$('tile-scatter').addEventListener('change',()=>{if(selected<0||!$('tile-scatter').reportValidity()||!Number.isFinite($('tile-scatter').valueAsNumber))return;invalidateAnalysis();worker.postMessage({type:'edit',edit:{mode:'scatter',index:selected,value:$('tile-scatter').valueAsNumber}});});$('restore-tile').addEventListener('click',()=>{if(selected>=0){invalidateAnalysis();landDraftDirty=false;worker.postMessage({type:'edit',edit:{mode:'restore',index:selected}});}});
for(const [id] of landFields)$(id).addEventListener('input',()=>{landDraftDirty=true;$('land-editor-note').textContent='Unsaved inputs. Apply to update learned albedo; high and low cover must total at most 100%.';});
$('apply-land').addEventListener('click',()=>{
 if(!ready||selected<0||$('land-editor').disabled)return;
 const value={};for(const [id,,scale,key] of landFields){if(!$(id).reportValidity()||!Number.isFinite($(id).valueAsNumber))return;if($(id).valueAsNumber!==Number(landDraftDisplay[key]))value[key]=$(id).valueAsNumber/scale;}
 if(Object.keys(value).length===0){landDraftDirty=false;$('land-editor-note').textContent='No land inputs changed.';return;}
 if((value.high??landDraftValues.high)+(value.low??landDraftValues.low)>1+1e-7){$('land-editor-note').textContent='Reduce cover: high and low vegetation must total at most 100%.';return;}
 invalidateAnalysis();landApplyIndex=selected;$('land-editor').disabled=true;
 worker.postMessage({type:'edit',edit:{mode:'land-inputs',index:selected,value}});
});
$('undo').addEventListener('click',()=>{invalidateAnalysis();landDraftDirty=false;worker?.postMessage({type:'undo'});});$('redo').addEventListener('click',()=>{invalidateAnalysis();landDraftDirty=false;worker?.postMessage({type:'redo'});});
$('export').addEventListener('click',()=>{if(ready)worker.postMessage({type:'snapshot',purpose:'export'});});
function downloadHistory(){
 if(!metrics)return;const rows=['model_day,warming_c,ecs_envelope_lower_c,ecs_envelope_upper_c,imbalance_change_w_m2,total_imbalance_w_m2,stored_heat_zj,surface_edit_warming_c,surface_scenario_lower_c,surface_scenario_upper_c,instant_surface_toa_forcing_w_m2,surface_edit_heat_zj'];
 const records=history.slice();if(records.at(-1)?.[0]!==metrics.day)records.push([metrics.day,metrics.warming,metrics.lower,metrics.upper,metrics.perturbation,metrics.imbalance,metrics.heat,metrics.surfaceWarming,metrics.surfaceLower,metrics.surfaceUpper,metrics.surfaceForcing,metrics.surfaceHeat]);
 for(const row of records)rows.push(row.map(value=>Number(value).toFixed(6)).join(','));
 const url=URL.createObjectURL(new Blob([rows.join('\n')+'\n'],{type:'text/csv'})),link=document.createElement('a');link.href=url;link.download='reflectance-climate-history.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function invalidateAnalysis(){
 analysisRequest++;analysisResult=null;analysisPending=false;
 $('sensitivity-chart').hidden=true;$('sensitivity-detail').textContent='';
 $('sensitivity-status').textContent=inspection?.inputs?'Inputs changed. Recalculate to refresh the snapshot.':'Choose a land tile.';
 $('sensitivity-run').disabled=!ready||!inspection?.inputs;
 if(ready)worker?.postMessage({type:'cancel-analysis'});
}
const sensitivityLabels={high:['High vegetation cover','%',100],low:['Low vegetation cover','%',100],highLai:['High vegetation leaf area','m²/m²',1],lowLai:['Low vegetation leaf area','m²/m²',1],height:['Elevation','m',1],snow:['Snow water equivalent','mm',1000],topMoisture:['Top soil moisture','m³/m³',1],deepMoisture:['Deep soil moisture','m³/m³',1],topTemperature:['Top soil temperature','K',1],deepTemperature:['Deep soil temperature','K',1],airTemperature:['Near-surface air temperature','K',1]};
for(const [key,[label,unit]] of Object.entries(sensitivityLabels)){const option=document.createElement('option');option.value=key;option.textContent=`${label} · ${unit}`;$('sensitivity-input').append(option);}
function resetSensitivityRange(bounds=null){
 if(!inspection?.inputs)return;
 const key=$('sensitivity-input').value,[i,low,limit]=LAND_FIELDS[key],[,unit,scale]=sensitivityLabels[key],value=inspection.inputs[i];
 const high=bounds?.max??(i<2?Math.min(limit,1-inspection.inputs[1-i]):limit),span=i===3||i===5||i===10?20:i===6?500:i===9?.05:i===7||i===8?2:i===2||i===4?.1:.2;
 const minimum=Math.ceil(low*scale*1e6)/1e6,maximum=Math.floor(high*scale*1e6)/1e6;
 const display=n=>String(clamp(Number((n*scale).toFixed(6)),minimum,maximum));
 for(const id of ['sensitivity-min','sensitivity-max','sensitivity-target']){$(id).min=minimum;$(id).max=maximum;}
 $('sensitivity-min').value=display(Math.max(low,Math.min(high-span,value-span)));
 $('sensitivity-max').value=display(Math.min(high,Math.max(low+span,value+span)));
 $('sensitivity-target').value=display(Math.min(high,value));
 $('sensitivity-detail').textContent=`${unit}. Available range ${low*scale}–${(high*scale).toFixed(3)}; training ranges are unknown.`;
}
function requestSensitivityBounds(){
 invalidateAnalysis();resetSensitivityRange();
 if(ready&&inspection?.inputs&&$('sensitivity-scope').value==='region')worker.postMessage({type:'sensitivity-bounds',index:selected,key:$('sensitivity-input').value,radius:Number($('radius').value),request:analysisRequest});
}
$('sensitivity-input').addEventListener('change',requestSensitivityBounds);$('sensitivity-scope').addEventListener('change',requestSensitivityBounds);
$('sensitivity-quantity').addEventListener('change',drawSensitivity);
for(const id of ['sensitivity-min','sensitivity-max'])$(id).addEventListener('input',invalidateAnalysis);
$('sensitivity-run').addEventListener('click',()=>{
 if(!ready||!inspection?.inputs||!$('sensitivity-min').reportValidity()||!$('sensitivity-max').reportValidity())return;
 const key=$('sensitivity-input').value,scale=sensitivityLabels[key][2],min=$('sensitivity-min').valueAsNumber/scale,max=$('sensitivity-max').valueAsNumber/scale;
 if(min>=max){$('sensitivity-status').textContent='Minimum must be smaller than maximum.';return;}
 pause();invalidateAnalysis();analysisPending=true;$('sensitivity-run').disabled=true;$('sensitivity-status').textContent='Preparing daily illumination…';
 worker.postMessage({type:'sensitivity',request:analysisRequest,index:selected,key,min,max,radius:$('sensitivity-scope').value==='region'?Number($('radius').value):0});
});
$('sensitivity-apply').addEventListener('click',()=>{
 if(!ready||!inspection?.inputs||!$('sensitivity-target').reportValidity())return;
 const key=$('sensitivity-input').value,value=$('sensitivity-target').valueAsNumber/sensitivityLabels[key][2];
 invalidateAnalysis();landDraftDirty=false;worker.postMessage({type:'edit',edit:{mode:$('sensitivity-scope').value==='region'?'land-region':'land-inputs',index:selected,radius:Number($('radius').value),value:{[key]:value}}});
});
function drawSensitivity(){
 const c=$('sensitivity-chart'),ctx=c.getContext('2d'),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);if(!analysisResult){c.hidden=true;return;}c.hidden=false;
 const result=analysisResult,quantity=$('sensitivity-quantity').value,points=result.points.filter(p=>Number.isFinite(p[quantity])),scale=sensitivityLabels[result.key][2];
 if(!points.length){$('sensitivity-detail').textContent='No sunlight reaches the selected area during this model day; daily albedo is undefined.';return;}
 let min=Math.min(...points.map(p=>p[quantity])),max=Math.max(...points.map(p=>p[quantity]));const span=Math.max(1e-8,max-min);min-=span*.15;max+=span*.15;
 const pad=60,right=15,top=22,bottom=42,x=value=>pad+(value-points[0].value)/(points.at(-1).value-points[0].value)*(w-pad-right),y=value=>h-bottom-(value-min)/(max-min)*(h-top-bottom);
 ctx.strokeStyle='#d1dbcc';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad,top);ctx.lineTo(pad,h-bottom);ctx.lineTo(w-right,h-bottom);ctx.stroke();
 ctx.strokeStyle='#327b68';ctx.lineWidth=3;ctx.beginPath();for(const [j,p] of points.entries())j?ctx.lineTo(x(p.value),y(p[quantity])):ctx.moveTo(x(p.value),y(p[quantity]));ctx.stroke();
 const originalX=x(result.meanInput);if(originalX>=pad&&originalX<=w-right){ctx.strokeStyle='#98754b';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(originalX,top);ctx.lineTo(originalX,h-bottom);ctx.stroke();ctx.setLineDash([]);}
 ctx.fillStyle='#526957';ctx.font='16px system-ui';ctx.textAlign='right';ctx.fillText(max.toPrecision(3),pad-8,top+5);ctx.fillText(min.toPrecision(3),pad-8,h-bottom);ctx.textAlign='left';ctx.fillText((points[0].value*scale).toPrecision(3),pad,h-17);ctx.textAlign='right';ctx.fillText((points.at(-1).value*scale).toPrecision(3),w-right,h-17);ctx.textAlign='center';ctx.fillText(sensitivityLabels[result.key][1],w/2,h-4);
 const units={albedo:'unitless',forcing:'global W/m²',surfaceChange:'regional W/m²',equilibrium:'°C'},clipped=Math.max(...result.points.map(p=>p.clippedFraction));
 $('sensitivity-detail').textContent=`${units[quantity]}. Dashed line: current area-mean input. Current heterogeneous learned albedo: ${result.baselineAlbedo===null?'no daylight':result.baselineAlbedo.toFixed(4)}. Each curve point sets the input uniformly across the area. Maximum clipped daylight-area fraction: ${(100*clipped).toFixed(1)}%.`;
}
$('save-setup').addEventListener('click',()=>{if(ready)worker.postMessage({type:'save-setup',name:$('scenario-name').value});});
$('load-setup').addEventListener('click',()=>{if(ready)$('setup-file').click();});
function downloadJSON(setup){
 const url=URL.createObjectURL(new Blob([JSON.stringify(setup)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='reflectance-surface-setup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('setup-file').addEventListener('change',async()=>{
 const file=$('setup-file').files[0];if(!file)return;
 try{
  if(file.size>8*1024*1024)throw new Error('Choose a setup smaller than 8 MB');
  const setup=JSON.parse(await file.text()),c=setup.config;
  if(setup.format!=='reflect-surface-1'||setup.modelVersion!==MODEL_VERSION||setup.boundaryCommit!==metrics?.boundary.commit||setup.kernelSha!==metrics?.kernel||!c||!Array.isArray(setup.edits))throw new Error('This setup uses a different model or boundary-data version');
  if(![100,200,400].includes(c.spacing)||!Number.isInteger(c.seed)||c.seed<0||c.seed>999999||!Number.isInteger(c.initialMonth)||c.initialMonth<0||c.initialMonth>11||!Number.isFinite(c.monthFraction)||c.monthFraction<0||c.monthFraction>=1||!Number.isFinite(c.startDay)||c.startDay<0||c.startDay>366||c.startHour!==0)throw new Error('Invalid saved grid or starting date');
  for(const [key,min,max] of [['co2',140,1120],['scatter',0,1],['screening',0,1],['wind',0,20],['width',80,200],['eccentricity',0,.15],['tilt',0,45]])if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw new Error('Invalid saved atmosphere or orbit');
  if(!['cack','idealised'].includes(c.landKernel))throw new Error('Unsupported land forcing kernel');
  if(![80,120,160,200].includes(c.width))throw new Error('Unsupported scattering width');
  const rows=Math.round(Math.PI*RADIUS/(c.spacing*1000));let count=0;for(let r=0;r<rows;r++)count+=Math.max(4,Math.round(2*rows*Math.cos(-Math.PI/2+(r+.5)*Math.PI/rows)));
  if(setup.edits.length>count)throw new Error('Too many saved tiles');const seen=new Set();
  for(const edit of setup.edits){
   if(!Number.isInteger(edit.index)||edit.index<0||edit.index>=count||seen.has(edit.index)||!Number.isFinite(edit.scatter)||edit.scatter<0||edit.scatter>3||edit.albedo!==null&&(!Number.isFinite(edit.albedo)||edit.albedo<0||edit.albedo>1))throw new Error('Invalid saved surface edit');seen.add(edit.index);
   if(edit.inputs!==null){if(!Array.isArray(edit.inputs)||edit.inputs.length!==11)throw new Error('Invalid saved inputs');for(const [i,min,max] of Object.values(LAND_FIELDS))if(!Number.isFinite(edit.inputs[i])||edit.inputs[i]<min||edit.inputs[i]>max)throw new Error('Saved inputs exceed exploration bounds');if(edit.inputs[0]+edit.inputs[1]>1+1e-7)throw new Error('Invalid saved vegetation cover');}
  }
  const maskResponse=await fetch(new URL('../../data/reflect/boundary-land-mask.bin',import.meta.url));if(!maskResponse.ok)throw new Error('Boundary mask could not be loaded');const mask=new Uint8Array(await maskResponse.arrayBuffer()),candidateGrid=sphericalGrid(c.spacing);
  if(mask.byteLength!==720*360/8)throw new Error('Invalid boundary mask');
  for(const edit of setup.edits){const lat=candidateGrid.latitude[edit.index],lon=candidateGrid.longitude[edit.index],y=clamp(Math.floor((lat+Math.PI/2)/Math.PI*360),0,359),x=Math.floor(((lon+Math.PI)%TAU+TAU)%TAU/TAU*720),pixel=y*720+x;if(Boolean(mask[pixel>>>3]&(1<<(pixel&7)))!==Boolean(edit.inputs))throw new Error('Saved inputs do not match the land/ocean mask');}
  if(!ready)throw new Error('Wait until the current planet is ready');
  loadedSetup=setup;initialSettings={initialMonth:c.initialMonth,monthFraction:c.monthFraction,startDay:c.startDay,startHour:0,boundaryDate:String(c.boundaryDate??'Saved climatology date').slice(0,80)};for(const [id,key] of [['resolution','spacing'],['seed','seed'],['co2','co2'],['wind','wind'],['width','width'],['eccentricity','eccentricity'],['tilt','tilt']])$(id).value=c[key];$('land-kernel').value=c.landKernel;$('scatter').value=c.scatter*100;$('screening').value=c.screening*100;$('scenario-name').value=String(setup.name??'Loaded surface').slice(0,80);setOutputs();initialize();
 }catch(error){status(`Setup was not loaded: ${error.message}.`);}finally{$('setup-file').value='';}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('inspector').open)$('inspector').close();});

// Reuse the same paint controls in a dialog on compact viewports. No copies,
// extra listeners or per-frame layout work; CSS keeps the dashboard bounded.
const compactDashboard=matchMedia('(max-width:760px), (max-height:560px)');
function placePaintControls(){
 if($('paint-dialog').open)$('paint-dialog').close();
 $(compactDashboard.matches?'paint-holder':'paint-home').append($('paint-controls'));
}
compactDashboard.addEventListener('change',placePaintControls);placePaintControls();
for(const [button,dialog] of [['settings-link','settings'],['paint-link','paint-dialog'],['context-link','climate-context']]){
 $(button).addEventListener('click',()=>$(dialog).showModal());
}
$('paint-done').addEventListener('click',()=>$('paint-dialog').close());
new ResizeObserver(()=>{renderer.resize();draw();}).observe(canvas);
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();pause();ready=false;status('Graphics context lost. Reload this page to restore the globe.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running){pause();status('Paused while this page is hidden. Resume when you are ready.');}});
const co2Date=new Date(PRESENT_CO2.date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
$('co2').value=PRESENT_CO2.ppm;$('co2-source').textContent=`NOAA estimate · ${co2Date}`;$('co2-source').href=PRESENT_CO2.url;
window.addEventListener('pagehide',()=>{pause();cancelAnimationFrame(sceneDrawRequest);worker?.terminate();});setOutputs();renderer.resize();initialize();
