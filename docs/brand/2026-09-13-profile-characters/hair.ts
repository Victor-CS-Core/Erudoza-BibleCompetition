import {skinTones,Skin,Eyes} from './appearance';
export type BodyType='male'|'female';
export const hairStyles={
 male:[{key:'curls',name:'Short curls'},{key:'side-part',name:'Side part'},{key:'quiff',name:'Textured quiff'},{key:'buzz',name:'Buzz cut'},{key:'waves',name:'Swept waves'},{key:'locs',name:'Short locs'}],
 female:[{key:'curly-bob',name:'Curly bob'},{key:'straight-bob',name:'Straight bob'},{key:'ponytail',name:'High ponytail'},{key:'braids',name:'Two braids'},{key:'natural-curls',name:'Natural curls'},{key:'low-bun',name:'Low bun'}],
} as const;
export const hairColors=[{key:'red',name:'Red',color:'#a94e2e',rgb:[158,66,34]},{key:'black',name:'Black',color:'#242223',rgb:[32,30,31]},{key:'brown',name:'Brown',color:'#72462f',rgb:[103,59,35]},{key:'blond',name:'Blond',color:'#d7b77a',rgb:[201,166,101]}] as const;
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
 const at=(Math.round(cy+40*unit)*512+Math.round(cx-24*unit))*4;
 const reference=[d[at],d[at+1],d[at+2]],referenceLuma=.2126*reference[0]+.7152*reference[1]+.0722*reference[2];
 const skinRgb=skinTones.find(t=>t.key===skin)!.rgb,hairRgb=hairColors.find(c=>c.key===hair)!.rgb;
 for(let i=0;i<d.length;i+=4){
  if(!d[i+3])continue;const x=i/4%512,y=Math.floor(i/4/512),r=d[i],g=d[i+1],b=d[i+2],luma=.2126*r+.7152*g+.0722*b;
  const eye=iris.find(e=>ellipse(x,y,e)<1);
  if(eye){if(eyes!=='brown'){const w=smooth(12,40,r-b)*(1-smooth(.84,1,ellipse(x,y,eye)));const color=eyes==='blue'?[luma*.65,luma*1.12,luma*1.5]:[luma*.97,luma*1.14,luma*.55];for(let k=0;k<3;k++)d[i+k]=d[i+k]*(1-w)+color[k]*w;}continue;}
  const warm=smooth(25,48,r-g)*smooth(10,25,g-b)*smooth(95,155,r);
  const skinWeight=mask[i]/255*warm;
  const hairWeight=mask[i+1]/255;
  for(let k=0;k<3;k++){
   const skinRatio=luma/referenceLuma,skinMapped=skinRgb[k]*skinRatio+.12*(d[i+k]-reference[k]*skinRatio);
   const hairMapped=hairRgb[k]*Math.pow(luma/68,.85);
   d[i+k]=d[i+k]*(1-skinWeight-hairWeight)+skinMapped*skinWeight+hairMapped*hairWeight;
  }
 }
 ctx.putImageData(pixels,0,0);return canvas;
}
export const bodySources={male:{student:'student-curls',coach:'coach-curls'},female:{student:'student-bob',coach:'coach-bob'}} as const;
export const bodyHeadRegistration:Record<string,{eyes:number[];cut:number}>={
 'student-curls':{eyes:[510,374,166],cut:540},'coach-curls':{eyes:[517,404,162],cut:590},
 'student-bob':{eyes:[508,411,152],cut:567},'coach-bob':{eyes:[509,386,150],cut:545},
};
