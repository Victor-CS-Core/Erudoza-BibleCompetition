import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Panel, PageHeader, Badge, Notice, Select } from '../../../apps/web/src/components/ui/index';
import { Configuration, Style, Slots, styles, styleNames, honors, renderCharacter, setSlot, loadImage } from './composition';

function Character({config, label, onError}: {config: Configuration; label: string; onError: (message:string)=>void}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let active=true; setReady(false);
    const buffer=document.createElement('canvas');
    renderCharacter(buffer, config).then(()=>{if(active && ref.current){ref.current.width=buffer.width;ref.current.height=buffer.height;ref.current.getContext('2d')!.drawImage(buffer,0,0);setReady(true);}}).catch(e=>{if(active)onError(e.message);});
    return ()=>{active=false;};
  },[config.style,config.attire,config.accessory,JSON.stringify(config.slots)]);
  return <canvas ref={ref} width={1024} height={1536} className="character-canvas" role="img" aria-label={label} aria-busy={!ready} data-ready={ready}>{label}</canvas>;
}
function App(){
  const [style,setStyle]=useState<Style>('curls');
  const [attire,setAttire]=useState<Configuration['attire']>('student');
  const [accessory,setAccessory]=useState<Configuration['accessory']>('sash');
  const [slots,setSlots]=useState<Slots>([honors[0].key,null,null]);
  const [avatar,setAvatar]=useState('honor');
  const [avatarHonor,setAvatarHonor]=useState<string>(honors[0].key);
  const [error,setError]=useState('');
  const [exporting,setExporting]=useState(false);
  const [message,setMessage]=useState('');
  const config:Configuration={style,attire,accessory,slots};
  const name=`${styleNames[style]}, ${attire==='coach'?'Master Guide':'Pathfinder'} attire, ${accessory}, ${slots.filter(Boolean).length} of 3 Honors`;
  async function download(){
    setExporting(true);setError('');setMessage('');
    try{
      const character=document.createElement('canvas');await renderCharacter(character,config,null,'export');
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1600;const ctx=canvas.getContext('2d')!;
      ctx.fillStyle='#f6f4ee';ctx.fillRect(0,0,1200,1600);
      ctx.fillStyle='#102e47';ctx.font='600 48px system-ui';ctx.textAlign='center';ctx.fillText('My Pathfinder',600,96);
      ctx.drawImage(character,130,125,940,1410);
      ctx.fillStyle='#102e47';ctx.font='48px Georgia';ctx.fillText('Erudoza',600,1560);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Unable to create image.')),'image/png'));
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`erudoza-${style}-${accessory}-review.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      setMessage('Review image downloaded. Your profile has not been changed.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to download the image.');}finally{setExporting(false);}
  }
  const [portrait,setPortrait]=useState('');
  useEffect(()=>{let active=true;loadImage(`prepared/${attire}-${style}-512.webp`).then(image=>{if(!active)return;const c=document.createElement('canvas');c.width=160;c.height=160;const ctx=c.getContext('2d')!;ctx.fillStyle='#fffefa';ctx.fillRect(0,0,160,160);ctx.drawImage(image,100,12,312,285,0,0,160,160);setPortrait(c.toDataURL());}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[attire,style]);
  return <>
    <header className="review-header"><span className="brand"><img src="../../../apps/web/public/brand/erudoza-patch-96.webp" alt=""/>Erudoza</span><Badge tone="info">Character artwork review</Badge><div className="avatar" aria-label={`Profile image preview: ${avatar}`}>{avatar==='initials'?'AB':<img src={avatar==='honor'?honors.find(h=>h.key===avatarHonor)!.src:portrait} alt=""/>}</div></header>
    <main>
      <PageHeader title="Make your Pathfinder" description="Try the three styles, both accessories, and three Honor spots. These choices are samples for review."/>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="creator-layout">
        <Panel className="character-panel"><Character config={config} label={name} onError={setError}/><div className="figure-caption"><Badge>{attire==='coach'?'Master Guide attire':'Pathfinder attire'}</Badge><span>{slots.filter(Boolean).length} of 3 Honors displayed</span></div></Panel>
        <div className="editor-panels">
          <Panel><h2>Character style</h2><div className="style-options">{styles.map(key=><Button key={key} variant={style===key?'primary':'secondary'} onClick={()=>setStyle(key)} aria-pressed={style===key}><img src={`prepared/${attire}-${key}-512.webp`} alt=""/>{styleNames[key]}</Button>)}</div>
            <fieldset><legend>Attire sample</legend><div className="choice-row"><Button variant={attire==='student'?'primary':'secondary'} aria-pressed={attire==='student'} onClick={()=>setAttire('student')}>Pathfinder</Button><Button variant={attire==='coach'?'primary':'secondary'} aria-pressed={attire==='coach'} onClick={()=>setAttire('coach')}>Master Guide · coach</Button></div></fieldset>
          </Panel>
          <Panel><h2>Wear your Honors</h2><div className="choice-row"><Button variant={accessory==='sash'?'primary':'secondary'} aria-pressed={accessory==='sash'} onClick={()=>setAccessory('sash')}>Sash</Button><Button variant={accessory==='satchel'?'primary':'secondary'} aria-pressed={accessory==='satchel'} onClick={()=>setAccessory('satchel')}>Satchel</Button></div><p className="help">Switch accessories and keep the same three spots.</p>
            <div className="slot-grid">{slots.map((key,i)=><label className="slot-option" key={i}><span>Spot {i+1}</span><span className="patch-preview">{key?<img src={honors.find(h=>h.key===key)!.src} alt=""/>:<span className="empty-ring"/>}</span><Select aria-label={`Honor in spot ${i+1}`} value={key??''} onChange={e=>{try{setSlots(setSlot(slots,i,e.target.value||null));}catch(e){setError((e as Error).message);}}}><option value="">Empty · dotted</option>{honors.map(h=><option key={h.key} value={h.key} disabled={slots.some((v,j)=>j!==i&&v===h.key)}>{h.title}</option>)}</Select></label>)}</div>
            <Button variant="ghost" onClick={()=>setSlots([null,null,null])}>Clear all three spots</Button>
          </Panel>
          <Panel><h2>Profile image</h2><div className="choice-row">{[['honor','Honor'],['character','Character'],['initials','Initials']].map(([key,label])=><Button key={key} variant={avatar===key?'primary':'secondary'} aria-pressed={avatar===key} onClick={()=>setAvatar(key)}>{label}</Button>)}</div><p className="help">Your profile image is separate from the Honors you wear.</p>{avatar==='honor'&&<label className="avatar-select">Honor profile image<Select value={avatarHonor} onChange={e=>setAvatarHonor(e.target.value)}>{honors.map(h=><option key={h.key} value={h.key}>{h.title}</option>)}</Select></label>}<Button disabled={exporting} onClick={download}>{exporting?'Preparing image…':'Download review image'}</Button>{message&&<p role="status" className="help">{message}</p>}</Panel>
        </div>
      </div>
      <section className="lineup" aria-labelledby="lineup-title"><PageHeader as="div" titleId="lineup-title" title="Compare all three styles" description="Same attire, accessory, and Honor selections."/><div className="lineup-grid">{styles.map(key=><Panel key={key}><Character config={{...config,style:key}} label={`${styleNames[key]}, ${accessory}`} onError={setError}/><h3>{styleNames[key]}</h3></Panel>)}</div></section>
      <Notice>Artwork review only. The Honor selections are sample choices; nothing is saved to an account or awarded. In the product, Master Guide attire is a coach option and Honor eligibility comes from your existing profile.</Notice>
    </main>
  </>;
}
createRoot(document.getElementById('character-review')!).render(<App/>);
