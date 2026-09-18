import { useState } from 'react';
import { pbeApi, type PbeIntroduction } from '../../api/practice';
import { Badge, Button, HelpTip, Input, Select, Textarea } from '../../components/ui';
type Props={org:string;season:string;books:string[];members:{id:string;displayName:string}[];introductions:PbeIntroduction[];run:(work:()=>Promise<unknown>)=>Promise<void>};
export function PbeIntroductionEditor({org,season,books,members,introductions,run}:Props){
 const [book,setBook]=useState(''),[edition,setEdition]=useState(''),[title,setTitle]=useState(''),[citation,setCitation]=useState(''),[text,setText]=useState(''),[license,setLicense]=useState('pending');
 return <section><h3>Book introductions<HelpTip label="About book introductions">Add licensed book introduction text, review it, then assign it to students in this season. To correct saved text, create a new introduction.</HelpTip></h3>
 <details className="ds-disclosure"><summary>Prepare a book introduction</summary><form className="practice-editor" onSubmit={e=>{e.preventDefault();void run(()=>pbeApi.createIntroduction(org,season,{bookKey:book,sourceEdition:edition,title,citation,licensingStatus:license,units:[{citation,canonicalText:text}]}));}}>
 <label>Introduction book<Select required value={book} onChange={e=>setBook(e.target.value)}><option value="">Choose selected book</option>{books.map(b=><option key={b}>{b}</option>)}</Select></label>
 <label>Source edition<Input required maxLength={200} value={edition} onChange={e=>setEdition(e.target.value)}/></label><label>Introduction title<Input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Introduction citation<Input required maxLength={500} value={citation} onChange={e=>setCitation(e.target.value)}/></label><label>Licensing<Select value={license} onChange={e=>setLicense(e.target.value)}>{['pending','approved','public-domain','creative-commons'].map(l=><option key={l}>{l}</option>)}</Select></label><label>Introduction text<Textarea required maxLength={10000} rows={6} value={text} onChange={e=>setText(e.target.value)}/></label><Button type="submit">Save introduction draft</Button></form></details>
 {introductions.map(intro=><Introduction key={`${intro.id}:${intro.revision}`} intro={intro} org={org} season={season} members={members} run={run}/>)}
 </section>;
}
function Introduction({intro,org,season,members,run}:Pick<Props,'org'|'season'|'members'|'run'>&{intro:PbeIntroduction}){
 const [selected,setSelected]=useState(intro.assignedStudentIds);
 return <details className="ds-disclosure"><summary>{intro.title} · {intro.reviewed?'Reviewed':'Unreviewed'}</summary><p>{intro.bookKey} book introduction · {intro.sourceEdition} · {intro.citation}</p><Badge>{intro.licensingStatus}</Badge>{intro.units.map(u=><blockquote key={u.id}>{u.canonicalText}</blockquote>)}
 <Button variant="secondary" disabled={!intro.reviewed&&intro.licensingStatus==='pending'} onClick={()=>void run(()=>pbeApi.reviewIntroduction(org,season,intro.id,intro.revision,!intro.reviewed))}>{intro.reviewed?'Withdraw source review':'Mark source reviewed'}</Button>
 <fieldset><legend>Assign this introduction to season members</legend>{!members.length&&<p>No active season members are available. Add members in Seasons first.</p>}{members.map(m=><label key={m.id}><Input type="checkbox" checked={selected.includes(m.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,m.id]:s.filter(id=>id!==m.id))}/>{m.displayName}</label>)}</fieldset><Button variant="secondary" onClick={()=>void run(()=>pbeApi.assignIntroduction(org,season,intro.id,intro.revision,selected))}>Save introduction assignments</Button><p>Review and approved licensing are required before students can use assigned text.</p></details>;
}
