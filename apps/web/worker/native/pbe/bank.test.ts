// @vitest-environment node
import { expect, it } from 'vitest';
import { filterPbeBank, sourceProof } from './bank';
import type { PbeQuestion, PbeTarget } from './types';
export const sourceA='aaaaaaaa-0000-0000-0000-000000000003', sourceB='bbbbbbbb-0000-0000-0000-000000000006';
export const target: PbeTarget={id:'00000000-0000-0000-0000-000000000004',sourceUnitIds:[sourceA,sourceB],skill:'FactualRecall',label:'Both labels'};
export const question: PbeQuestion={schemaVersion:2,id:'00000000-0000-0000-0000-000000000001',version:1,contentPackId:'00000000-0000-0000-0000-000000000002',sourceUnitId:sourceA,sourceUnitIds:[sourceA,sourceB],sourceKind:'Scripture',reference:'Fixture 1:1–2',evidence:'Alpha and Beta',kind:'ShortAnswer',prompt:'Name both labels.',ordered:false,parts:[{targetId:target.id,acceptedAnswers:['Alpha and Beta'],points:1}]};
it('cannot admit a question spanning an excluded passage',()=>{expect(filterPbeBank([question],[target],[sourceA])).toEqual({questions:[],targets:[],missingSourceUnitIds:[sourceA]});});
it('normalizes GUID case and reports coverage from eligible questions only',()=>{const result=filterPbeBank([question],[target],[sourceA.toUpperCase(),sourceB]);expect(result.questions).toHaveLength(1);expect(result.missingSourceUnitIds).toEqual([]);});
it('retains declared targets without pretending they establish question coverage',()=>{expect(filterPbeBank([], [target], [sourceA,sourceB])).toEqual({questions:[],targets:[target],missingSourceUnitIds:[sourceA,sourceB]});});
it('selects the newest version before filtering its scope',()=>{expect(filterPbeBank([{...question,sourceUnitIds:[sourceA],parts:[{...question.parts[0],targetId:'00000000-0000-0000-0000-000000000005'}]}, {...question,version:2}],[target,{...target,id:'00000000-0000-0000-0000-000000000005',sourceUnitIds:[sourceA]}],[sourceA]).questions).toEqual([]);});
it('shares NFC excerpt normalization and UTF-16 length-prefixed source fingerprints with C#',async()=>{
 const q={...question,sourceUnitIds:[sourceA],reference:'GEN 1:1',evidence:'Cafe\u0301\t🌿'};
 const source={id:sourceA,canonicalText:'Café 🌿 Alpha',citation:'GEN 1:1'};
 expect(await sourceProof(q,new Map([[sourceA,source as never]]))).toBe('b657f4d84fadbb1f26738ee662e9a76a3e6a828e6ed8126cbc13c1d08bf2b0fb');
});
