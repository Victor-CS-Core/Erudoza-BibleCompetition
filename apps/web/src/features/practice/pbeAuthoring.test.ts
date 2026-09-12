import { expect, it } from 'vitest';
import { parsePbeImport } from './pbeAuthoring';
it('rejects malformed preview documents without trying to render their fields',()=>{for(const questions of [[null],[{prompt:'Invalid'}],[{parts:null}]])expect(()=>parsePbeImport(JSON.stringify({questions,targets:[]}))).toThrow(/PBE/);});
