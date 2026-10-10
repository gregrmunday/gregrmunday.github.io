// Idealised, energy-conserving two-stream atmosphere. These optical properties
// are illustrative, not fitted CERES data or an observed radiative kernel.
// Downward/upward transmission = 1 - .25 s; reflection = .20 s;
// absorption = .05 s. s=0 recovers the unscreened experiment.
export function reflectedFlux(direct,diffuse,black,white,screening,out) {
 const transmission=1-.25*screening,reflection=.2*screening,incoming=direct+diffuse;
 const raw=incoming>0?(direct*black+diffuse*white)/incoming:white;
 const albedo=Math.max(0,Math.min(1,raw)),diffuseAlbedo=Math.max(0,Math.min(1,white));
 const first=albedo*incoming,returned=reflection*first/(1-reflection*diffuseAlbedo);
 const reflected=first+diffuseAlbedo*returned;
 out[0]=incoming+returned;out[1]=reflected;out[2]=out[0]-reflected;out[3]=transmission*reflected;
 out[4]=raw<0||raw>1||(screening>0&&(white<0||white>1))?1:0;
 out[5]=albedo;
 return out;
}
