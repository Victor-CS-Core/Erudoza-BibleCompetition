import {useCallback, useEffect, useRef, useState} from 'react';
import type {Configuration} from './composition';
import {CharacterStage} from './CharacterPreview';
import {playCharacterAnimation} from './animate';
import {useStageParallax} from './stageParallax';
import {hairStyles} from './hair';

export function AnimatedCharacterView({config,onError,onActivate}:{config:Configuration;onError?:(message:string)=>void;onActivate?:()=>void}){
 const ref=useRef<HTMLCanvasElement>(null),[ready,setReady]=useState(false);
 const key=JSON.stringify(config);
 const parallax=useStageParallax();
 const setCanvas=useCallback((el:HTMLCanvasElement|null)=>{ref.current=el;parallax.canvasRef(el);},[parallax]);
 const error=useRef(onError);error.current=onError;
 useEffect(()=>{
  let active=true;let stop:(()=>void)|undefined;setReady(false);
  const canvas=ref.current;
  if(canvas){
   void playCharacterAnimation(canvas,JSON.parse(key) as Configuration,{onError:(message)=>{if(active)error.current?.(message);}})
    .then(next=>{if(active){stop=next;setReady(true);}else{next();}});
  }
  return ()=>{active=false;stop?.();};
 },[key]);
 const hairstyle=hairStyles[config.bodyType].find(h=>h.key===config.style)?.name;
 const label=`Animated preview of your ${config.bodyType} Pathfinder: ${config.hairColor} hair, ${hairstyle}, ${config.skin} skin, ${config.eyes} eyes, sash with ${config.slots.filter(Boolean).length} of 3 Honors`;
 return <CharacterStage background={config.background} wrapRef={parallax.wrapRef} fillRef={parallax.fillRef} onActivate={onActivate}><canvas ref={setCanvas} width={1536} height={1536} className="character-canvas" role="img" aria-label={label} aria-busy={!ready} data-ready={ready}>{label}</canvas></CharacterStage>;
}
