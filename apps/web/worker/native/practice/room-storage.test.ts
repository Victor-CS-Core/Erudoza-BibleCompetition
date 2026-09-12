// @vitest-environment node
import {expect,it} from 'vitest';
import {encodeComponent,readComponent,parseNode,ROOM_LEAF_BYTES,contentHash} from './room-storage';
it('round-trips a component spanning UTF-8 boundaries with every leaf bounded',async()=>{
 const value={text:'a'.repeat(ROOM_LEAF_BYTES-20)+'😀é'.repeat(60000),lone:'\ud800',answers:['x'.repeat(2000)]},nodes=new Map<string,string>();const ref=await encodeComponent(value,nodes);
 expect(nodes.size).toBeGreaterThan(2);expect(await readComponent(ref,h=>nodes.get(h)??null)).toEqual(value);
 for(const [hash,data] of nodes){const node=await parseNode(hash,data);if(node.type==='leaf')expect(Buffer.byteLength(node.data)).toBeLessThanOrEqual(ROOM_LEAF_BYTES);}
});
it('fails closed on a missing or changed immutable component and a wrong original length',async()=>{
 const nodes=new Map<string,string>(),ref=await encodeComponent({text:'saved'},nodes);
 await expect(readComponent(ref,()=>null)).rejects.toThrow(/missing or corrupt/);
 await expect(readComponent(ref,()=>'{"nodeVersion":1,"type":"leaf","data":"changed"}')).rejects.toThrow(/missing or corrupt/);
 await expect(readComponent({...ref,bytes:ref.bytes+1},h=>nodes.get(h)??null)).rejects.toThrow(/missing or corrupt/);
 const unsupported=JSON.stringify({nodeVersion:2,type:'leaf',data:'{}'});await expect(parseNode(await contentHash(unsupported),unsupported)).rejects.toThrow(/missing or corrupt/);
});
