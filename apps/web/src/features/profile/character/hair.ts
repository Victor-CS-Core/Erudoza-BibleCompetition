import headLandmarks from './head-landmarks.json';
import {mapSkinTone,type Skin,type Eyes} from './appearance';
export type BodyType='male'|'female';
export const hairStyles={
 male:[{key:'curls',name:'Short curls'},{key:'side-part',name:'Side part'},{key:'quiff',name:'Textured quiff'},{key:'buzz',name:'Buzz cut'},{key:'waves',name:'Swept waves'},{key:'locs',name:'Short locs'}],
 female:[{key:'curly-bob',name:'Curly bob'},{key:'straight-bob',name:'Straight bob'},{key:'ponytail',name:'High ponytail'},{key:'braids',name:'Two braids'},{key:'natural-curls',name:'Natural curls'},{key:'low-bun',name:'Low bun'}],
} as const;
export const hairColors=[{key:'red',name:'Red',color:'#944d32'},{key:'black',name:'Black',color:'#292321'},{key:'brown',name:'Brown',color:'#633d28'},{key:'blond',name:'Blond',color:'#b08a54'}] as const;
const hairPalettes={
 red:[[34,18,15],[113,52,32],[181,108,72],[224,164,124]],
 black:[[10,9,10],[34,29,28],[73,62,57],[116,102,92]],
 brown:[[19,12,9],[78,46,28],[137,93,61],[187,143,106]],
 blond:[[48,31,20],[151,112,65],[216,179,119],[242,218,172]],
};
export const headAnchors: Record<string,{neck:number[];ears:number[][]}>=headLandmarks;
export function headPlacement(name:string,body:string){
 const pose=bodyHeadRegistration[body],eyes=headEyes[name],anchor=headAnchors[name].neck;
 const scale=pose.eyeDistance/(eyes[1][0]-eyes[0][0]);
 return {x:pose.neck[0]-anchor[0]*scale,y:pose.neck[1]-anchor[1]*scale,scale};
}
function hairTone(t:number,palette:number[][]){
 const knots=[0,.48,.84,1];let index=0;while(index<2&&t>knots[index+1])index++;
 const amount=Math.max(0,Math.min(1,(t-knots[index])/(knots[index+1]-knots[index])));
 return palette[index].map((c,k)=>c+(palette[index+1][k]-c)*amount);
}
export type HairColor=typeof hairColors[number]['key'];
// Measured centers/radii of the two irises, in each 512px sprite cell.
export const headEyes: Record<string,number[][]>={
 'male-curls':[[213,301,24,27],[334,301,24,27]],
 'male-side-part':[[192,302,24,27],[313,302,24,27]],
 'male-quiff':[[176,302,24,27],[297,302,24,27]],
 'male-buzz':[[202,266,24,27],[326,265,24,27]],
 'male-waves':[[191,265,24,27],[314,265,24,27]],
 'male-locs':[[174,267,24,27],[298,267,24,27]],
 'female-curly-bob':[[207,295,23,26],[319,295,23,26]],
 'female-straight-bob':[[202,296,23,26],[315,296,23,26]],
 'female-ponytail':[[175,296,23,26],[289,296,23,26]],
 'female-braids':[[207,259,23,26],[319,259,23,26]],
 'female-natural-curls':[[198,258,23,26],[313,258,23,26]],
 'female-low-bun':[[175,260,23,26],[299,260,23,26]],
};
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const ellipse=(x:number,y:number,e:number[])=>((x-e[0])/e[2])**2+((y-e[1])/e[3])**2;
export function appearanceHead(image:HTMLImageElement,maskImage:HTMLImageElement,name:string,skin:Skin,eyes:Eyes,hair:HairColor){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0,512,512);
 const maskCanvas=document.createElement('canvas');maskCanvas.width=512;maskCanvas.height=512;const maskCtx=maskCanvas.getContext('2d')!;maskCtx.drawImage(maskImage,0,0);const mask=maskCtx.getImageData(0,0,512,512).data;
 const pixels=ctx.getImageData(0,0,512,512),d=pixels.data,iris=headEyes[name],cx=(iris[0][0]+iris[1][0])/2,cy=(iris[0][1]+iris[1][1])/2,unit=(iris[1][0]-iris[0][0])/120;
 // Median of a broad, masked forehead area avoids a single cheek sample
 // landing on blush, a nose shadow or a highlight in a different hairstyle.
 const skinSamples:number[][]=[];
 for(let y=Math.round(cy-92*unit);y<cy-55*unit;y++)for(let x=Math.round(cx-30*unit);x<cx+30*unit;x++){
  const i=(y*512+x)*4;if(mask[i]>250&&d[i+3]>250)skinSamples.push([d[i],d[i+1],d[i+2]]);
 }
 skinSamples.sort((a,b)=>(.2126*a[0]+.7152*a[1]+.0722*a[2])-(.2126*b[0]+.7152*b[1]+.0722*b[2]));
 const reference=skinSamples[Math.floor(skinSamples.length/2)]??[220,145,92];
 const shades=[];for(let i=0;i<d.length;i+=4)if(mask[i+1]>240&&d[i+3]>240)shades.push(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2]);
 shades.sort((a,b)=>a-b);const low=shades[Math.floor(shades.length*.015)]??0,high=shades[Math.floor(shades.length*.99)]??180;
 for(let i=0;i<d.length;i+=4){
  if(!d[i+3])continue;const x=i/4%512,y=Math.floor(i/4/512),r=d[i],g=d[i+1],b=d[i+2],luma=.2126*r+.7152*g+.0722*b;
  const eye=iris.find(e=>ellipse(x,y,e)<1);
  if(eye){if(eyes!=='brown'){const w=smooth(12,40,r-b)*(1-smooth(.84,1,ellipse(x,y,eye)));const color=eyes==='blue'?[luma*.65,luma*1.12,luma*1.5]:[luma*.97,luma*1.14,luma*.55];for(let k=0;k<3;k++)d[i+k]=d[i+k]*(1-w)+color[k]*w;}continue;}
  const warm=smooth(25,48,r-g)*smooth(10,25,g-b)*smooth(95,155,r);
  const skinWeight=mask[i]/255*warm;
  const skinMapped=mapSkinTone([r,g,b],reference,skin);
  const hairWeight=mask[i+1]/255;
  const hairRgb=hairTone(Math.max(0,Math.min(1,(luma-low)/Math.max(1,high-low))),hairPalettes[hair]);
  for(let k=0;k<3;k++){
   const hairMapped=hairRgb[k];
   d[i+k]=d[i+k]*(1-skinWeight-hairWeight)+skinMapped[k]*skinWeight+hairMapped*hairWeight;
  }
 }
 ctx.putImageData(pixels,0,0);return canvas;
}
export const bodySources={male:{student:'student-curls',coach:'coach-curls'},female:{student:'student-bob',coach:'coach-bob'}} as const;
export const bodyHeadRegistration:Record<string,{neck:number[];eyeDistance:number}>={
 'student-curls':{neck:[511,595],eyeDistance:166},'coach-curls':{neck:[511,650],eyeDistance:162},
 'student-bob':{neck:[507,622],eyeDistance:152},'coach-bob':{neck:[509,618],eyeDistance:150},
};
export const characterTopInset=32;
const bodyGroundY:Record<string,number>={'student-curls':1467,'student-bob':1383,'coach-curls':1463,'coach-bob':1439};
const bodyReferences:Record<string,string>={'student-curls':'student-curls','coach-curls':'student-curls','student-bob':'student-bob','coach-bob':'student-bob'};
/** Keep the same person's head scale, neckline and floor when only attire changes. */
export function bodyFrame(name:string){
 const reference=bodyReferences[name];if(!reference)throw new Error('Unknown character body');
 const source=bodyHeadRegistration[name],target=bodyHeadRegistration[reference];
 const scale=(bodyGroundY[reference]-target.neck[1])/(bodyGroundY[name]-source.neck[1]);
 return {reference,scale,x:target.neck[0]-source.neck[0]*scale,y:target.neck[1]+characterTopInset-source.neck[1]*scale,groundY:bodyGroundY[reference]+characterTopInset};
}
