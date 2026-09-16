import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {CharacterAppearance} from '../../../../shared/profileCharacter';
import {backgrounds,type Background} from './appearance';
import {renderCharacter,renderPortrait,type Configuration} from './composition';
import {hairStyles} from './hair';

/** Blurred scene backdrop behind the character preview canvas (letterbox
 *  style). When the square canvas is letterboxed inside the wider card, the
 *  side space shows a blurred, dimmed copy of the selected scene instead of
 *  blank card; the sharp canvas stays centered on top. Purely decorative. */
export function CharacterStage({background,children}:{background:Background;children:ReactNode}){
 const src=backgrounds.find(b=>b.key===background)?.src;
 return <div className="character-stage-wrap">{src?<img className="character-stage-fill" src={src} alt="" aria-hidden="true" draggable={false}/>:null}{children}</div>;
}

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
export function CharacterPortrait({appearance,className='',onError,fallback=null}:{appearance:CharacterAppearance;className?:string;onError?:(message:string)=>void;fallback?:ReactNode}){
 const key=portraitKey(appearance),[result,setResult]=useState<{key:string;src:string}|null>(null);
 const error=useRef(onError);error.current=onError;
 useEffect(()=>{let active=true;void portrait(JSON.parse(key) as CharacterAppearance).then(src=>{if(active)setResult({key,src});},()=>{if(active)error.current?.('Unable to load your portrait. Please try again.');});return()=>{active=false;};},[key]);
 const src=result?.key===key?result.src:null;
 return <span className={`character-portrait ${className}`} aria-busy={!src}>{src?<img src={src} alt="" data-character-portrait="true"/>:fallback}</span>;
}
export function CharacterPreview({config,onError}:{config:Configuration;onError?:(message:string)=>void}){
 const ref=useRef<HTMLCanvasElement>(null),[readyKey,setReadyKey]=useState(''),key=JSON.stringify(config);
 const error=useRef(onError);error.current=onError;
 useEffect(()=>{let active=true;void renderCharacter(document.createElement('canvas'),JSON.parse(key) as Configuration).then(buffer=>{
  if(active&&ref.current){ref.current.width=buffer.width;ref.current.height=buffer.height;ref.current.getContext('2d')!.drawImage(buffer,0,0);setReadyKey(key);}
 },()=>{if(active)error.current?.('Unable to load your character. Please try again.');});return()=>{active=false;};},[key]);
 const hairstyle=hairStyles[config.bodyType].find(h=>h.key===config.style)?.name;
 const label=`${config.bodyType} body, ${config.hairColor} hair, ${hairstyle}, ${config.attire==='coach'?'Master Guide':'Pathfinder'}, ${config.skin} skin, ${config.eyes} eyes, sash with ${config.slots.filter(Boolean).length} of 3 Honors`;
 return <CharacterStage background={config.background}><canvas ref={ref} width={1536} height={1536} className="character-canvas" role="img" aria-label={label} aria-busy={readyKey!==key} data-ready={readyKey===key}>{label}</canvas></CharacterStage>;
}
