// Deterministic preview color controls. Source artwork remains unchanged.
export const skinTones = [
  {key:'light',name:'Light',color:'#edb38b',rgb:[237,179,139]},
  {key:'medium',name:'Medium',color:'#bd794c',rgb:[189,121,76]},
  {key:'deep',name:'Deep',color:'#794832',rgb:[121,72,50]},
] as const;
export const eyeColors = [
  {key:'brown',name:'Brown',color:'#805020'},
  {key:'hazel',name:'Hazel',color:'#7c863e'},
  {key:'blue',name:'Blue',color:'#4c88ab'},
] as const;
export const backgrounds = [
  {key:'studio',name:'Warm studio',color:'#eee4d5'},
  {key:'sage',name:'Soft sage',color:'#d5e2d5'},
  {key:'sky',name:'Morning sky',color:'#d5e5f0'},
] as const;
export type Skin = typeof skinTones[number]['key'];
export type Eyes = typeof eyeColors[number]['key'];
export type Background = typeof backgrounds[number]['key'];
// Coordinates use the common 512 × 768 artwork frame. Iris bounds avoid
// sclera, eyelashes, pupils and catchlights; skin excludes both eye regions.
const anatomy: Record<string,{eyes:number[][]; face:number[]; neck:number[]; armY:number; cheek:number[]}> = {
 'student-curls':{eyes:[[213,187,17,19],[296,185,17,20]],face:[255,191,119,84],neck:[252,273,34,25],armY:366,cheek:[240,211]},
 'student-sweep':{eyes:[[212,197,16,18],[294,193,16,18]],face:[254,192,114,86],neck:[252,278,31,22],armY:370,cheek:[240,219]},
 'student-bob':{eyes:[[216,207,15,17],[292,205,15,17]],face:[254,204,106,80],neck:[253,285,30,23],armY:382,cheek:[242,226]},
 'coach-curls':{eyes:[[218,203,16,18],[299,201,16,18]],face:[256,204,120,83],neck:[252,293,32,26],armY:397,cheek:[240,219]},
 'coach-sweep':{eyes:[[218,189,16,18],[291,184,16,18]],face:[253,186,111,88],neck:[250,276,30,23],armY:374,cheek:[240,211]},
 'coach-bob':{eyes:[[217,193,16,18],[292,193,16,18]],face:[253,193,108,84],neck:[254,281,30,23],armY:380,cheek:[239,218]},
};
const faceOutlines: Record<string,number[][]> = {
 'student-curls':[[129,215],[163,176],[164,126],[199,102],[254,80],[300,101],[347,145],[348,180],[381,174],[384,246],[320,275],[190,280]],
 'student-sweep':[[131,190],[163,172],[178,139],[206,128],[236,117],[257,96],[289,105],[324,139],[337,183],[371,179],[373,239],[314,280],[181,280],[131,240]],
 'student-bob':[[143,214],[173,194],[176,153],[211,150],[235,133],[250,107],[288,114],[317,141],[336,184],[365,202],[357,251],[306,284],[192,284]],
 'coach-curls':[[130,213],[163,173],[173,128],[216,103],[260,96],[310,116],[343,157],[348,192],[382,190],[384,256],[320,294],[184,293]],
 'coach-sweep':[[138,193],[172,165],[180,122],[208,111],[238,98],[274,90],[308,104],[328,145],[339,177],[369,173],[367,231],[317,275],[190,279]],
 'coach-bob':[[141,211],[174,177],[181,139],[214,132],[238,107],[262,99],[295,113],[320,141],[337,180],[365,192],[360,244],[307,279],[190,284]],
};
function inside(x:number,y:number,points:number[][]){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));if(Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<16)return true;if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
const ellipse=(x:number,y:number,e:number[])=>((x-e[0])/e[2])**2+((y-e[1])/e[3])**2;
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export function applyAppearance(image: HTMLImageElement,name:string,skin:Skin,eyes:Eyes){
 const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;
 const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);
 const pixels=ctx.getImageData(0,0,c.width,c.height),d=pixels.data,a=anatomy[name],scale=c.width/512;
 const ci=(Math.round(a.cheek[1]*scale)*c.width+Math.round(a.cheek[0]*scale))*4;
 const reference=[d[ci],d[ci+1],d[ci+2]];
 const target=skinTones.find(t=>t.key===skin)!.rgb;
 for(let i=0;i<d.length;i+=4){
  if(!d[i+3])continue;
  const x=(i/4%c.width)/scale,y=Math.floor(i/4/c.width)/scale;
  const r=d[i],g=d[i+1],b=d[i+2];
  const iris=a.eyes.find(e=>ellipse(x,y,e)<1);
  if(iris){
   if(eyes!=='brown'){
    const strength=smooth(12,42,r-b)*(1-smooth(.84,1,ellipse(x,y,iris)));
    const light=.2126*r+.7152*g+.0722*b;
    const rgb=eyes==='blue'?[light*.65,light*1.12,light*1.5]:[light*.97,light*1.14,light*.55];
    for(let k=0;k<3;k++)d[i+k]=d[i+k]*(1-strength)+rgb[k]*strength;
   }continue;
  }
  const region=inside(x,y,faceOutlines[name])||ellipse(x,y,a.neck)<1||(y>a.armY&&y<545&&(x<190||x>321));
  if(!region)continue;
  // Warm skin chroma rejects neutral clothes; the value ramp preserves dark
  // eyebrows/beard. Source-specific regions keep hair and uniform isolated.
  const armWeight=smooth(30,55,r-g)*smooth(12,27,g-b)*smooth(65,110,r);
  for(let k=0;k<3;k++){
   const original=d[i+k];
   const luminance=.2126*r+.7152*g+.0722*b;
   const referenceLuminance=.2126*reference[0]+.7152*reference[1]+.0722*reference[2];
   const ratio=luminance/referenceLuminance;
   const mapped=target[k]*ratio+.12*(original-reference[k]*ratio);
   d[i+k]=original*(1-armWeight)+mapped*armWeight;
  }
 }
 ctx.putImageData(pixels,0,0);return c;
}
export function paintBackground(ctx:CanvasRenderingContext2D,key:Background,w:number,h:number){
 const color=backgrounds.find(b=>b.key===key)!.color;
 const gradient=ctx.createRadialGradient(w*.5,h*.38,0,w*.5,h*.4,w*.9);
 gradient.addColorStop(0,'#fffefa');gradient.addColorStop(1,color);
 ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
 ctx.save();ctx.translate(w*.5,h*.94);ctx.scale(1,.13);
 const radius=w*.35,shadow=ctx.createRadialGradient(0,0,0,0,0,radius);
 shadow.addColorStop(0,'#102e4720');shadow.addColorStop(1,'#102e4700');
 ctx.fillStyle=shadow;ctx.fillRect(-radius,-radius,radius*2,radius*2);ctx.restore();
}
