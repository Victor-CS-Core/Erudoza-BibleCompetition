// @vitest-environment node
import { expect,it } from "vitest";
import { evaluate,score,validateQuestion } from "./scoring";
const question={id:"q",contentPackId:"p",sourceUnitId:"s",prompt:"List both",kind:"List",parts:[{acceptedAnswers:["A","B"],points:2},{acceptedAnswers:["A"],points:1}],ordered:false,evidence:"A B",reference:"John 1:1",version:1};
it("preserves .NET whitespace and simple invariant case semantics",()=>{
 const q={...question,parts:[{acceptedAnswers:["A B"],points:1}]};
 expect(evaluate(q,["A\u0085B"])).toBe(1);
 expect(evaluate(q,["\uFEFFA B"])).toBe(0);
 expect(evaluate({...q,parts:[{acceptedAnswers:["SS"],points:1}]},["ß"])).toBe(0);
});
it("uses integer hundredths and ceil seconds at score boundaries",()=>{
  expect(score(1,25,5000)).toEqual({accuracyHundredths:100,speedHundredths:20});
  expect(score(1,25,5001).speedHundredths).toBe(19);
  expect(score(1,25,25000).speedHundredths).toBe(0);
  expect(score(1,25,25001).accuracyHundredths).toBe(0);
  expect(score(1,25,5000,true).speedHundredths).toBe(0);
  expect(()=>score(1,25,-1)).toThrow();
});
it("matches overlapping answer variants once and preserves required order",()=>{
  expect(evaluate(question,["A","B"])).toBe(3);
  expect(evaluate(question,["A"])).toBe(2);
  expect(evaluate({...question,ordered:true},["A","B"])).toBe(2);
  expect(()=>validateQuestion({...question,kind:"MultipleChoice"})).toThrow();
});
it("keeps legacy practice scoring independent of the new 8-point rubric cap",()=>{
 expect(evaluate({...question,parts:[{acceptedAnswers:["A"],points:9}]},["A"])).toBe(9);
});
