import assert from 'node:assert/strict';
import test from 'node:test';
import {clipboardImageFile} from '../app/clipboard-image.ts';

test('native clipboard re-import retains the compressed payload, format and output filename', () => {
 const bytes = new Uint8Array([82,73,70,70,12,0,0,0,87,69,66,80,9,8,7,6]);
 const file = clipboardImageFile(bytes,{name:'封面-piclite.webp',type:'image/webp'});
 assert.equal(file.name,'封面-piclite.webp');assert.equal(file.type,'image/webp');assert.equal(file.size,bytes.length);
 return file.arrayBuffer().then(buffer=>assert.deepEqual(new Uint8Array(buffer),bytes));
});
test('clipboard ingress detects encoded bytes rather than inventing a PNG extension',()=>{
 const file = clipboardImageFile(new Uint8Array([255,216,255,224]),{type:'image/png'});
 assert.equal(file.type,'image/jpeg');assert.match(file.name,/\.jpg$/);
});
