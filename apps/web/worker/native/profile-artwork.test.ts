// @vitest-environment node
import {expect,it} from 'vitest';
import {honorImageSrc} from '../../src/features/profile/character/assets';
import {honorCatalog} from './mastery/catalog';
it('provides artwork for every actual production Honor and rejects arbitrary URLs',()=>{
 for(const honor of honorCatalog)expect(honorImageSrc(honor.key)).toMatch(/^\/(assets\/training|brand\/(practice|simulation))\/.+\.webp$/);
 for(const key of ['https://example.com/avatar.png','solo:../head','unknown:exact-recall','solo:exact-recall:extra','first-fellowship'])expect(honorImageSrc(key)).toBeUndefined();
});
