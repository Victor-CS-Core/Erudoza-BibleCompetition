import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {CharacterAppearance} from '../../../../shared/profileCharacter';
import {playPortraitAnimation} from './animate';

function portraitKey(a:CharacterAppearance){return JSON.stringify({bodyType:a.bodyType,style:a.style,hairColor:a.hairColor,skin:a.skin,eyes:a.eyes});}

/** Animated profile avatar: the character head bobs, tilts, blinks, and
 *  glances side to side while staying planted in place. Static PNG exports
 *  and share cards keep using the still CharacterPortrait. */
export function AnimatedPortrait({appearance,fallback=null}:{appearance:CharacterAppearance;fallback?:ReactNode}){
 const ref=useRef<HTMLCanvasElement|null>(null);
 const [failed,setFailed]=useState(false);
 const key=portraitKey(appearance);
 useEffect(()=>{
  let active=true;let stop:(()=>void)|undefined;
  const canvas=ref.current;
  if(canvas){
   void playPortraitAnimation(canvas,JSON.parse(key) as CharacterAppearance,{
    onError:()=>{if(active)setFailed(true);},
   }).then(next=>{if(active)stop=next;else next();});
  }
  return ()=>{active=false;stop?.();};
 },[key]);
 if(failed)return <>{fallback}</>;
 return <canvas ref={ref} width={320} height={320} className="character-portrait-canvas" data-character-portrait="animated"/>;
}
