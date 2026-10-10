// Focused surface-edit regressions. No climate timestepping or offline drift run.
// Run with: node scripts/test_reflect_surface.mjs
import assert from 'node:assert/strict';
import { Planet, cellAt } from '../assets/js/reflect/globe-model.mjs';

const sourceInputs=[.9,.1,.30123,290.123,.31234,288.456,123.45,4.1234,1.2345,.00001234,291.234];
const boundary={source:'regression fixture',commit:'fixture',flags:0,isLand:()=>true,
  landInputs:(latitude,longitude,month,fraction,target)=>target.set(sourceInputs)};
const planet=new Planet({spacing:400,co2:280,startHour:12,boundary});
planet.diagnose();
const index=cellAt(planet.grid,-5*Math.PI/180,-62*Math.PI/180),offset=planet.landSlots[index]*11;
const original=planet.landInputs.slice(offset,offset+11),reference=planet.referenceCoefficients.slice();
const thermal=planet.responses.map(response=>response.temperature.slice());
const climate={elapsed:planet.elapsed,heat:planet.heat,history:planet.history.slice()};

planet.edit({mode:'albedo',index,value:.5});
const beforeNoop=planet.metrics.shortwaveForcing;
planet.edit({mode:'land-inputs',index,value:{}});
assert.deepEqual(planet.landInputs.slice(offset,offset+11),original);
assert.equal(planet.override[index],.5,'no-op Apply preserves an existing override');
assert.equal(planet.metrics.shortwaveForcing,beforeNoop);

planet.edit({mode:'land-inputs',index,value:{lowLai:2}});
for(let field=0;field<11;field++)if(field!==8)assert.equal(planet.landInputs[offset+field],original[field],'partial edit preserves exact untouched inputs');
assert.equal(planet.landInputs[offset+8],2);
assert.ok(Number.isNaN(planet.override[index]),'explicit physical edit enables C45');
assert.deepEqual(planet.referenceCoefficients,reference,'edited surface never rewrites reference BRDF');
assert.deepEqual(planet.baseLandInputs.slice(offset,offset+11),original);

planet.edit({mode:'low-vegetation',index});
assert.equal(planet.landInputs[offset],0);
assert.ok(Math.abs(planet.landInputs[offset+1]-original[0]-original[1])<1e-7,'conversion preserves vegetation cover');
assert.equal(planet.kinds[index],3);
assert.ok(Math.abs(planet.inspect(index).shortwaveChange)>1e-6,'learned inputs change reflected sunlight');
const absorbedChange=planet.absorbed.reduce((sum,value,i)=>sum+(value-planet.referenceAbsorbed[i])*planet.grid.area[i]/(4*Math.PI),0);
assert.ok(Math.abs(planet.metrics.shortwaveForcing-absorbedChange)<1e-10,'forcing matches area-weighted radiation change');

const beforeRejected=planet.landInputs.slice();
assert.throws(()=>planet.edit({mode:'scatter',index,value:NaN}),/Scattering/);
assert.throws(()=>planet.edit({mode:'scatter',index,value:Infinity}),/Scattering/);
assert.throws(()=>planet.edit({mode:'land-inputs',index,value:{high:1,low:1}}),/100%/);
assert.throws(()=>planet.edit({mode:'land-inputs',index,value:{height:NaN}}),/Invalid/);
assert.throws(()=>planet.edit({mode:'land-inputs',index,value:{unknown:1}}),/Invalid/);
assert.deepEqual(planet.landInputs,beforeRejected,'validation happens before mutation');
assert.ok(planet.scatterFactor.every(Number.isFinite));
assert.ok(Number.isFinite(planet.metrics.temperature));

planet.edit({mode:'restore',index});
assert.deepEqual(planet.landInputs.slice(offset,offset+11),original);
assert.deepEqual(planet.coefficients,reference,'restoration reproduces original BRDF exactly');
assert.equal(planet.inspect(index).shortwaveChange,0);
assert.ok(Math.abs(planet.metrics.shortwaveForcing)<1e-10);
assert.deepEqual(planet.responses.map(response=>response.temperature),thermal);
assert.deepEqual({elapsed:planet.elapsed,heat:planet.heat,history:planet.history},climate,'edits preserve climate state and history');

const latitude=-7.2*Math.PI/180,longitude=-63.6363636364*Math.PI/180;
planet.edit({mode:'low-vegetation',latitude,longitude,radius:150});
assert.equal(planet.lastEdit.changedCells,0,'a too-small coarse-grid brush can miss all centres');
planet.edit({mode:'low-vegetation',latitude,longitude,radius:300});
assert.ok(planet.lastEdit.changedCells>0,'the UI minimum radius covers coarse-grid corners');
planet.edit({mode:'scatter',latitude,longitude,radius:300});
assert.ok(planet.scatterFactor.every(Number.isFinite),'incremental scattering brush needs no scalar value');

console.log('Surface-edit regressions passed: precise inputs, immutable reference, validation, restoration, forcing and coarse-grid brushes.');
