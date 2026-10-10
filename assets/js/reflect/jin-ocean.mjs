// SPDX-License-Identifier: EUPL-1.2
// Copyright SpeedyWeather contributors. JavaScript adaptation, October 2026.
// Jin et al. (2011), https://doi.org/10.1364/OE.19.026429
// Ported from SpeedyWeather gm/albedo, commit
// b5eaa01a76d1ce6b083592a1e4c94f419385c77c, JinOceanAlbedo.
// License: ../../data/reflect/SpeedyWeather-EUPL-1.2.txt
// Changes: algebraic Fresnel evaluation; separate direct/diffuse functions;
// Cox–Munk diagnosis of the roughness input from prescribed 10 m wind speed.
const N=1.34,FOAM=.55,VOLUME=.006;
const bound=x=>Math.min(1,Math.max(0,x));
export const roughness=wind=>Math.sqrt(.003+.00512*Math.max(0,wind));
export const whitecaps=wind=>bound(2.95e-6*Math.max(0,wind)**3.52);
export function fresnel(mu,n=N){
 const cosine=Math.max(1e-5,Math.min(1,mu)),transmitted=Math.sqrt(1-(1-cosine*cosine)/(n*n));
 return .5*(((cosine-n*transmitted)/(cosine+n*transmitted))**2+((n*cosine-transmitted)/(n*cosine+transmitted))**2);
}
export function correction(mu,sigma){
 return (.0152+mu*(-1.7873+mu*(6.8972-8.5778*mu))+4.071*sigma-7.6446*mu*sigma)*
  Math.exp(.1643-7.8409*mu-3.5639*mu*mu-2.3588*sigma+10.0538*mu*sigma);
}
export function directOcean(mu,wind=5){
 const foam=whitecaps(wind);
 return foam*FOAM+(1-foam)*(fresnel(mu)-correction(mu,roughness(wind))+VOLUME);
}
export function diffuseOcean(wind=5){
 const foam=whitecaps(wind),sigma=roughness(wind);
 return foam*FOAM+(1-foam)*(-.1482-.012*N+.1608*N*N-.0244*N*sigma+VOLUME);
}
// As in SpeedyWeather, clamp after direct/diffuse and ice are combined.
export function oceanAlbedo(mu,wind=5,fractionDirect=1,ice=0){
 const direct=bound(fractionDirect),concentration=bound(ice);
 return bound((1-concentration)*(direct*directOcean(mu,wind)+(1-direct)*diffuseOcean(wind))+concentration*.6);
}
