import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {CharacterAppearance} from '../../../../shared/profileCharacter';
import {renderCharacter,renderPortrait,type Configuration} from './composition';
import {hairStyles} from './hair';

const portraits=new Map<string,Promise<string>>();
function portraitKey(c:CharacterAppearance){return JSON.stringify({bodyType:c.bodyType,style:c.style,hairColor:c.hairColor,skin:c.skin,eyes:c.eyes});}
function portrait(c:CharacterAppearance){
 const key=portraitKey(c);let task=portraits.get(key);
 if(!task){
  task=renderPortrait(document.createElement('canvas'),c).then(canvas=>canvas.toDataURL('image/png'));
  portraits.set(key,task);
  void task.catch(()=>{if(portraits.get(key)===task)portraits.delete(key);});
  if(portraits.size>96)portraits.delete(portraits.keys().next().value!);
 }
 return task;
}
function useIdleMotion(enabled:boolean){
 const [active,setActive]=useState(false);
 useEffect(()=>{
  if(!enabled){setActive(false);return;}
  const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)'),coarse=window.matchMedia?.('(pointer: coarse)');let focused=true;
  const allowed=()=>!reduce?.matches&&!coarse?.matches&&document.visibilityState==='visible'&&focused;
  const sync=()=>setActive(allowed());
  const blur=()=>{focused=false;sync();},focus=()=>{focused=true;sync();};
  sync();reduce?.addEventListener('change',sync);coarse?.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);window.addEventListener('blur',blur);window.addEventListener('focus',focus);
  return()=>{reduce?.removeEventListener('change',sync);coarse?.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);setActive(false);};
 },[enabled]);
 return active;
}
export function CharacterPortrait({appearance,className='',onError,fallback=null}:{appearance:CharacterAppearance;className?:string;onError?:(message:string)=>void;fallback?:ReactNode}){
 const key=portraitKey(appearance),[result,setResult]=useState<{key:string;src:string}|null>(null);
 const error=useRef(onError);error.current=onError;
 useEffect(()=>{let active=true;void portrait(JSON.parse(key) as CharacterAppearance).then(src=>{if(active)setResult({key,src});},()=>{if(active)error.current?.('Unable to load your portrait. Please try again.');});return()=>{active=false;};},[key]);
 const src=result?.key===key?result.src:null;
 return <span className={`character-portrait ${className}`} aria-busy={!src}>{src?<img src={src} alt="" data-character-portrait="true"/>:fallback}</span>;
}
export function CharacterPreview({config,animated=false,onError}:{config:Configuration;animated?:boolean;onError?:(message:string)=>void}){
 const ref=useRef<HTMLCanvasElement>(null),[readyKey,setReadyKey]=useState(''),key=JSON.stringify(config);
 const motionActive=useIdleMotion(animated);
 const error=useRef(onError);error.current=onError;
 useEffect(()=>{let active=true;void renderCharacter(document.createElement('canvas'),JSON.parse(key) as Configuration).then(buffer=>{
  if(active&&ref.current){ref.current.width=buffer.width;ref.current.height=buffer.height;ref.current.getContext('2d')!.drawImage(buffer,0,0);setReadyKey(key);}
 },()=>{if(active)error.current?.('Unable to load your character. Please try again.');});return()=>{active=false;};},[key]);
 const hairstyle=hairStyles[config.bodyType].find(h=>h.key===config.style)?.name;
 const label=`${config.bodyType} body, ${config.hairColor} hair, ${hairstyle}, ${config.attire==='coach'?'Master Guide':'Pathfinder'}, ${config.skin} skin, ${config.eyes} eyes, sash with ${config.slots.filter(Boolean).length} of 3 Honors`;
 return <span className="character-preview-stage" data-testid="character-preview-stage" data-idle-motion={motionActive?'active':undefined}><canvas ref={ref} width={1536} height={1536} className="character-canvas" role="img" aria-label={label} aria-busy={readyKey!==key} data-ready={readyKey===key}>{label}</canvas></span>;
}
