import { cellAt, clamp, TAU } from './globe-model.mjs';
const colors=[[38,106,143],[173,215,226],[53,112,84],[145,172,96],[181,148,103],[229,236,228]];
const VERTEX=`attribute vec2 position;varying vec2 uv;void main(){uv=position;gl_Position=vec4(position,0.,1.);}`;
const FRAGMENT=`precision highp float;
varying vec2 uv;uniform sampler2D map;uniform vec2 viewport;uniform float yaw,pitch,zoom,declination,subsolarLongitude,mode,projection,selectedLat,selectedLon,brushRadius,hasSelection;
const float PI=3.14159265359;
vec3 rotate(vec3 n){float c=cos(pitch),s=sin(pitch);n=vec3(n.x,c*n.y+s*n.z,-s*n.y+c*n.z);c=cos(yaw);s=sin(yaw);return vec3(c*n.x+s*n.z,n.y,-s*n.x+c*n.z);}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec2 p=uv*vec2(viewport.x/min(viewport.x,viewport.y),viewport.y/min(viewport.x,viewport.y));
 float radius=.77*zoom,r=length(p)/radius;
 vec3 background=mix(vec3(.029,.075,.093),vec3(.085,.17,.17),.55+.45*uv.y);
 float stars=step(.998,hash(floor(gl_FragCoord.xy/2.)));background+=stars*.18;
 float rim=exp(-pow((r-1.025)*26.,2.))*.12; background+=vec3(.25,.6,.7)*rim;
 if(r>1.&&projection<.5){gl_FragColor=vec4(background,1.);return;}
 vec3 cameraNormal=vec3(p/radius,sqrt(max(0.,1.-r*r))),normal=rotate(cameraNormal);
 if(projection>.5){float mapLat=uv.y*PI/2.,mapLon=uv.x*PI;normal=vec3(cos(mapLat)*sin(mapLon),sin(mapLat),cos(mapLat)*cos(mapLon));r=0.;}
 float lat=asin(clamp(normal.y,-1.,1.)),lon=atan(normal.x,normal.z);
 vec4 tex=texture2D(map,vec2((lon+PI)/(2.*PI),(lat+PI/2.)/PI));
 vec3 sun=vec3(cos(declination)*sin(subsolarLongitude),sin(declination),cos(declination)*cos(subsolarLongitude));
 float light=dot(normal,sun),shade=.18+.82*smoothstep(-.03,.65,light);
 vec3 color=tex.rgb;
 if(mode<.5){
   float kind=floor(tex.a*255./32.+.1);float detail=hash(floor(vec2(lon,lat)*1000.));
   color*=.93+.14*detail;
   if(kind<.5){float wave=sin(lon*750.+sin(lat*540.)*2.);color+=vec3(.04,.08,.09)*smoothstep(.92,1.,wave);}
   if(kind>1.5&&kind<2.5)color*=.9+.17*hash(floor(vec2(lon,lat)*2100.));
   if(kind>4.5)color+=vec3(.04)*sin(lon*300.+lat*400.);
 }
 color*=mode<.5?shade:.76+.24*sqrt(max(0.,1.-r*r));
 float parallels=abs(sin(lat*12.)),meridians=abs(sin(lon*12.));
 color=mix(color,vec3(.75,.9,.88),.12*(1.-smoothstep(.008,.025,min(parallels,meridians))));
 if(hasSelection>.5){vec3 s=vec3(cos(selectedLat)*sin(selectedLon),sin(selectedLat),cos(selectedLat)*cos(selectedLon));float distance=acos(clamp(dot(normal,s),-1.,1.));
   float ring=1.-smoothstep(.003,.008,abs(distance-brushRadius));color=mix(color,vec3(.96,.83,.51),ring*.9);}
 float atmosphere=pow(r,12.)*.14;color+=vec3(.25,.53,.64)*atmosphere;
 gl_FragColor=vec4(color,1.);
}`;
function mix(a,b,f,target){for(let j=0;j<3;j++)target[j]=a[j]+(b[j]-a[j])*f;}
export class GlobeRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.yaw=-.45;this.spin=0;this.pitch=.18;this.zoom=1;this.selection=null;this.flat=false;this.mode='surface';this.fields=null;this.grid=null;
    this.gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
    if(!this.gl){this.fallback=canvas.getContext('2d');return;}
    const gl=this.gl,shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    this.program=gl.createProgram();const vs=shader(gl.VERTEX_SHADER,VERTEX),fs=shader(gl.FRAGMENT_SHADER,FRAGMENT);gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(this.program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    this.uniforms={};for(const key of ['map','viewport','yaw','pitch','zoom','declination','subsolarLongitude','mode','projection','selectedLat','selectedLon','brushRadius','hasSelection'])this.uniforms[key]=gl.getUniformLocation(this.program,key);
    this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  }
  setGrid(grid,kinds,ice) {
    this.grid=grid;this.kinds=kinds;this.ice=ice;this.colorMode=null;this.fallbackKey=null;this.textureWidth=720;this.textureHeight=360;
    this.lookup=new Uint32Array(this.textureWidth*this.textureHeight);this.pixels=new Uint8Array(this.lookup.length*4);this.cellColors=new Uint8Array(grid.count*4);
    for(let y=0;y<this.textureHeight;y++)for(let x=0;x<this.textureWidth;x++)this.lookup[y*this.textureWidth+x]=cellAt(grid,-Math.PI/2+(y+.5)*Math.PI/this.textureHeight,-Math.PI+(x+.5)*TAU/this.textureWidth);
    if(this.gl){const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.textureWidth,this.textureHeight,0,gl.RGBA,gl.UNSIGNED_BYTE,this.pixels);}
  }
  update(fields,mode=this.mode) {
    this.fields=fields;this.mode=mode;if(!this.grid)return;
    // Surface colours change only on painting: rotation needs no texture upload.
    if(mode==='surface'&&this.colorMode===mode)return;this.colorMode=mode;
    const color=[0,0,0];
    for(let i=0;i<this.grid.count;i++){
      const j=i*8,kind=this.kinds[i];let value;
      if(mode==='surface'){if(kind<2)mix(colors[0],colors[1],this.ice?.[i]??0,color);else for(let c=0;c<3;c++)color[c]=colors[kind][c];}
      if(mode==='temperature'){value=clamp((fields[j]+35)/75);if(value<.5)mix([48,104,154],[229,231,175],value*2,color);else mix([229,231,175],[191,69,45],(value-.5)*2,color);}
      if(mode==='warming'){value=clamp(fields[j+4]/5,-1,1);mix([224,233,223],value<0?[59,129,172]:[203,84,45],Math.abs(value),color);}
      if(mode==='response'){value=clamp(fields[j+7]/2,-1,1);mix([224,233,223],value<0?[59,129,172]:[203,84,45],Math.abs(value),color);}
      if(mode==='delta-albedo'){value=clamp(fields[j+5]/.3,-1,1);mix([224,233,223],value<0?[143,74,51]:[65,119,164],Math.abs(value),color);}
      if(mode==='delta-sunlight'){value=clamp(fields[j+6]/150,-1,1);mix([224,233,223],value<0?[55,116,173]:[216,95,48],Math.abs(value),color);}
      if(mode==='albedo')mix([31,73,97],[244,238,194],fields[j+1],color);
      if(mode==='scattering')mix([31,82,105],[209,220,148],fields[j+2],color);
      if(mode==='imbalance'){value=clamp(fields[j+3]/100,-1,1);mix([224,233,223],value<0?[55,116,173]:[216,95,48],Math.abs(value),color);}
      this.cellColors[i*4]=color[0];this.cellColors[i*4+1]=color[1];this.cellColors[i*4+2]=color[2];this.cellColors[i*4+3]=kind*32;
    }
    for(let p=0;p<this.lookup.length;p++){const from=this.lookup[p]*4,to=p*4;this.pixels[to]=this.cellColors[from];this.pixels[to+1]=this.cellColors[from+1];this.pixels[to+2]=this.cellColors[from+2];this.pixels[to+3]=this.cellColors[from+3];}
    if(this.gl){const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,this.textureWidth,this.textureHeight,gl.RGBA,gl.UNSIGNED_BYTE,this.pixels);}
  }
  setKinds(kinds) {
    this.kinds.set(kinds);this.colorMode=null;
  }
  resize() {
    const {width,height}=this.canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5,Math.sqrt(1200000/(width*height)));
    this.canvas.width=Math.max(1,Math.round(width*ratio));this.canvas.height=Math.max(1,Math.round(height*ratio));
    if(this.gl)this.gl.viewport(0,0,this.canvas.width,this.canvas.height);
  }
  coordinates(event) {
    const box=this.canvas.getBoundingClientRect();
    if(this.flat)return {latitude:Math.PI/2-(event.clientY-box.top)/box.height*Math.PI,longitude:((event.clientX-box.left)/box.width-.5)*TAU};
    const min=Math.min(box.width,box.height),radius=.77*this.zoom;
    let x=(event.clientX-box.left-box.width/2)*2/min/radius,y=-(event.clientY-box.top-box.height/2)*2/min/radius;
    if(x*x+y*y>1)return null;let z=Math.sqrt(1-x*x-y*y),c=Math.cos(this.pitch),s=Math.sin(this.pitch),ny=c*y+s*z,nz=-s*y+c*z;
    c=Math.cos(this.yaw+this.spin);s=Math.sin(this.yaw+this.spin);const nx=c*x+s*nz;z=-s*x+c*nz;
    return {latitude:Math.asin(clamp(ny,-1,1)),longitude:Math.atan2(nx,z)};
  }
  draw(orbital) {
    if(!this.fields)return;
    if(!this.gl){this.drawFallback(orbital);return;}
    const gl=this.gl,u=this.uniforms;gl.useProgram(this.program);gl.uniform2f(u.viewport,this.canvas.width,this.canvas.height);
    for(const [key,value] of Object.entries({yaw:this.yaw+this.spin,pitch:this.pitch,zoom:this.zoom,declination:orbital?.declination||0,subsolarLongitude:orbital?.subsolarLongitude||0,mode:this.mode==='surface'?0:1,projection:this.flat?1:0,selectedLat:this.selection?.latitude||0,selectedLon:this.selection?.longitude||0,brushRadius:this.selection?.radius||.018,hasSelection:this.selection?1:0}))gl.uniform1f(u[key],value);
    gl.uniform1i(u.map,0);gl.drawArrays(gl.TRIANGLES,0,6);
  }
  drawFallback(orbital) {
    // Ray-cast a small reusable image; never draw disconnected cell rectangles.
    const ctx=this.fallback,w=this.canvas.width,h=this.canvas.height,scale=Math.min(1,512/w,384/h),iw=Math.max(1,Math.round(w*scale)),ih=Math.max(1,Math.round(h*scale));
    if(!this.imageCanvas){this.imageCanvas=document.createElement('canvas');this.imageContext=this.imageCanvas.getContext('2d');}
    const key=[iw,ih,this.flat,this.yaw+this.spin,this.pitch,this.zoom].join(',');
    if(this.fallbackKey!==key){
      this.fallbackKey=key;this.imageCanvas.width=iw;this.imageCanvas.height=ih;this.image=this.imageContext.createImageData(iw,ih);
      this.rays=new Int32Array(iw*ih).fill(-1);this.normals=new Float32Array(iw*ih*3);
      const minimum=Math.min(iw,ih),radius=.77*this.zoom,cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),cy=Math.cos(this.yaw+this.spin),sy=Math.sin(this.yaw+this.spin);
      for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){
        const px=(x+.5-iw/2)*2/minimum/radius,py=-(y+.5-ih/2)*2/minimum/radius,i=y*iw+x;
        let nx,ny,z;
        if(this.flat){const lat=Math.PI/2-(y+.5)/ih*Math.PI,lon=((x+.5)/iw-.5)*TAU;nx=Math.cos(lat)*Math.sin(lon);ny=Math.sin(lat);z=Math.cos(lat)*Math.cos(lon);}
        else{if(px*px+py*py>1)continue;const pz=Math.sqrt(1-px*px-py*py),nz=-sp*py+cp*pz;ny=cp*py+sp*pz;nx=cy*px+sy*nz;z=-sy*px+cy*nz;}
        this.rays[i]=cellAt(this.grid,Math.asin(clamp(ny,-1,1)),Math.atan2(nx,z));this.normals[i*3]=nx;this.normals[i*3+1]=ny;this.normals[i*3+2]=z;
      }
    }
    const pixels=this.image.data,declination=orbital?.declination||0,longitude=orbital?.subsolarLongitude||0,sun=[Math.cos(declination)*Math.sin(longitude),Math.sin(declination),Math.cos(declination)*Math.cos(longitude)];
    let selectedNormal=null;if(this.selection){const p=this.selection;selectedNormal=[Math.cos(p.latitude)*Math.sin(p.longitude),Math.sin(p.latitude),Math.cos(p.latitude)*Math.cos(p.longitude)];}
    for(let i=0;i<this.rays.length;i++){
      const index=this.rays[i],j=i*4,y=Math.floor(i/iw);
      if(index<0){pixels[j]=13;pixels[j+1]=31+8*(1-y/ih);pixels[j+2]=37+6*(1-y/ih);pixels[j+3]=255;continue;}
      const k=i*3,nx=this.normals[k],ny=this.normals[k+1],nz=this.normals[k+2],dot=nx*sun[0]+ny*sun[1]+nz*sun[2],light=this.mode==='surface'?.18+.82*clamp((dot+.03)/.68):.95;
      let ring=false;if(selectedNormal){const distance=Math.acos(clamp(nx*selectedNormal[0]+ny*selectedNormal[1]+nz*selectedNormal[2],-1,1));ring=Math.abs(distance-this.selection.radius)<.005;}
      for(let c=0;c<3;c++)pixels[j+c]=ring?[245,215,143][c]:this.cellColors[index*4+c]*light;
      pixels[j+3]=255;
    }
    this.imageContext.putImageData(this.image,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(this.imageCanvas,0,0,w,h);
  }
}
