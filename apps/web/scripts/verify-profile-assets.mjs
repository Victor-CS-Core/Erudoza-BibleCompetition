/* global URL, process, console */
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),manifest=JSON.parse(await readFile(new URL('public/brand/characters/v1/manifest.json',root),'utf8'));
assert.equal(manifest.files.length,63,'Only reviewed runtime character layers and backgrounds are packaged');
const deployed=process.argv.includes('--built');
for(const file of manifest.files){
 const url=new URL(`${deployed?'dist-native':'public'}/brand/characters/v1/${file.path}`,root);
 const data=await readFile(url);assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,file.path);
 assert.ok((await stat(url)).size<25*1024*1024,'Asset fits the host limit');
}
console.log(`Verified ${manifest.files.length} unchanged reviewed character assets in ${deployed?'production output':'public source'}.`);
