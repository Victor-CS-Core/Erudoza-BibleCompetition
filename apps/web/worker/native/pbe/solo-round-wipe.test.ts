// @vitest-environment node
import {expect,it} from 'vitest';
import {SOLO_STORAGE_WIPE_TTL_MS,soloWipeDue} from './solo-wipe';

it('defines a 24-hour post-terminal storage TTL',()=>{
  expect(SOLO_STORAGE_WIPE_TTL_MS).toBe(24*3600_000);
});

it('wipes only terminal states once the deadline passes',()=>{
  expect(soloWipeDue({status:'Settled'},1000,1000)).toBe(true);
  expect(soloWipeDue({status:'Settled'},1000,999)).toBe(false);
  expect(soloWipeDue({status:'Interrupted'},1000,5000)).toBe(true);
  expect(soloWipeDue({status:'Armed'},1000,5000)).toBe(false);
  expect(soloWipeDue({status:'Presenting'},1000,5000)).toBe(false);
  expect(soloWipeDue({status:'Settling'},1000,5000)).toBe(false);
  expect(soloWipeDue({status:'Settled'},undefined,5000)).toBe(false);
  expect(soloWipeDue(null,1000,5000)).toBe(false);
});
