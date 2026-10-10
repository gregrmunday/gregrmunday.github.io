import assert from 'node:assert/strict';
import {brdf,learnedAlbedo,simpleAlbedo,simulate,shadows,surfaceCache,createFrame,evaluateFrame} from '../assets/js/reflect/model.mjs';
const near=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const soil=[0,0,.2,280,.18,282,0,0,0,0,281,0];
const ice=soil.slice();ice[11]=1;
near(simpleAlbedo(soil,0),.06);near(simpleAlbedo(ice,1),.6);near(simpleAlbedo(soil,4),.4);
const snow=soil.slice();snow[9]=.05;near(simpleAlbedo(snow,5),.6);near(simpleAlbedo(snow,5,true),.8);
const data=new Float32Array([...soil,...soil,...soil,...soil]);
const cfg={data,kinds:new Uint8Array([4,4,4,4]),size:2,cloud:.15,scheme:'saturating',terrainShadows:true,hours:12};
const result=simulate(cfg);const analytic=(900*.85+80+250*.15)*12*2/Math.PI;
assert.ok(Math.abs(result.incident[result.steps]-analytic)/analytic<.00002);
near(result.reflected[result.steps]/result.incident[result.steps],.4,.000001);
for(let i=1;i<=result.steps;i++){assert.ok(result.reflected[i]>=result.reflected[i-1]);assert.ok(result.incident[i]>=result.reflected[i]);}
near(simulate({...cfg,hours:24}).reflected[result.steps],result.reflected[result.steps]*2,1e-7);
data[6]=1000;assert.equal(shadows(data,2,.1)[1],1);assert.equal(shadows(data,2,.5)[1],0);assert.equal(shadows(data,2,.1,false)[1],0);
assert.ok(simulate(cfg).incident[result.steps]<simulate({...cfg,terrainShadows:false}).incident[result.steps]);
near(simulate({...cfg,cloud:1}).incident[result.steps],simulate({...cfg,cloud:1,terrainShadows:false}).incident[result.steps],1e-8);
for(const input of [soil,snow,[.8,.1,.3,290,.25,285,800,4,1,.4,288,0]]){const params=brdf(input);assert.ok(params.every(Number.isFinite));for(let a=0;a<=90;a+=5){const alb=learnedAlbedo(params,a*Math.PI/180,.8,.2);assert.ok(alb>=0&&alb<=1);}}
console.log('Reflect checks passed: albedo endpoints, analytic energy, conservation, duration scaling, terrain shadows, diffuse-only invariance, bounded C45 values.');

// Independently evaluated from the supplied equations using Julia 1.12.
const juliaInputs = [[0,0,0.2,280,0.18,282,0,0,0,0,281,0],[0,0,0.2,280,0.18,282,0,0,0,0.05,281,0],[0.8,0.1,0.3,290,0.25,285,800,4,1,0.4,288,0]];
const juliaOutputs = [[0.22759429966125036,0.06994505644558167,0.01942113705630214,0.3192612947028478,0.10555386191080633,0.036093997489925],[0.5472610005267844,0.08760149140629467,0.020947412507252013,0.4582221907640815,0.10555386191080633,0.019994910254582415],[0.3919005932382198,0.10544396100584971,0.016016856648823366,0.3815106865047556,0.13778293002999623,0.02971315666941053]];
juliaInputs.forEach((input,i)=>brdf(input).forEach((value,j)=>near(value,juliaOutputs[i][j],1e-12)));
console.log('Julia-derived C45 BRDF fixtures passed.');

// The live map is reused; finer integration stores only scalar timelines.
const cache = surfaceCache(cfg), frame = createFrame(2);
assert.equal(evaluateFrame(cfg,cache,.5,frame),frame);
assert.equal(evaluateFrame(cfg,cache,.75,frame).albedos,frame.albedos);
near(evaluateFrame(cfg,cache,0,frame).watts,0);
near(evaluateFrame(cfg,cache,1,frame).reflectionWatts,0);
assert.equal(result.steps,1440);
assert.equal(result.cache.length,4*4);
assert.equal('albedos' in result,false);
const reusedMask=new Uint8Array(4).fill(1);
assert.equal(shadows(data,2,.25,false,100,reusedMask),reusedMask);
assert.ok(reusedMask.every(x=>x===0));
for(const input of juliaInputs) {
 const config={data:new Float32Array(input),kinds:new Uint8Array([4]),size:1,cloud:.15,terrainShadows:false};
 const cache=surfaceCache(config);
 const input32=Array.from(config.data),parameters=brdf(input32);
 for(const phase of [.05,.25,.5,.75,.95]) {
  const theta=Math.acos(Math.sin(phase*Math.PI)),direct=765/882.5,diffuse=117.5/882.5;
  near(evaluateFrame(config,cache,phase).albedos[0],learnedAlbedo(parameters,theta,direct,diffuse),1e-7);
 }
}
console.log('Compact cache, reusable frames, endpoint flux and cached C45 equivalence passed.');
