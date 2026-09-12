import { expect, it } from 'vitest';
import { sourceProof } from './bank';
import type { PbeSource } from './sources';
import fixtures from './rubric-fixtures.json';
import type { PbeQuestion } from './types';
it('binds coordinate-free Commentary evidence to the same Unicode source fingerprint as canonical',async()=>{
 const source:PbeSource={id:'aaaaaaaa-0000-0000-0000-000000000003',contentPackId:'aaaaaaaa-0000-0000-0000-000000000004',sourceKind:'Commentary',bookKey:'GEN',chapter:null,verse:null,ordinal:1,citation:'Genesis introduction §1',canonicalText:'Café 🌿 Alpha'};
 const question={...fixtures.cases[0].question,sourceKind:'Commentary',sourceUnitIds:[source.id],reference:source.citation,evidence:'Cafe\u0301\t🌿'} as PbeQuestion;
 expect(await sourceProof(question,new Map([[source.id,source]]))).toBe('b9c48383c543f749c2121b078c7c060e69f7195aba369f4755390de0a5d97a2b');
 await expect(sourceProof({...question,evidence:'Alpha Café'},new Map([[source.id,source]]))).rejects.toThrow();
 await expect(sourceProof({...question,reference:'Invented reference'},new Map([[source.id,source]]))).rejects.toThrow();
});
