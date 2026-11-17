import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutomaticResultCopier } from '../desktop/automatic-result-copy.ts';

test('disabled switch and failed compression do not overwrite the clipboard', async () => {
 const copied=[]; let enabled=false;
 const copy=createAutomaticResultCopier(async path=>copied.push(path),()=>enabled,()=>assert.fail('unexpected failure'));
 await copy([{status:'done',output:'/final.webp'}]);
 enabled=true;
 await copy([{status:'working',output:'/source.png'},{status:'error',output:'/failed.png'}]);
 assert.deepEqual(copied,[]);
});
test('a batch copies only the last successful final output, not the source or preview', async () => {
 const copied=[];
 const copy=createAutomaticResultCopier(async path=>copied.push(path),()=>true,()=>assert.fail('unexpected failure'));
 await copy([{status:'done',source:'/source1.png',output:'/compressed1.webp',preview:'blob:1'}, {status:'done',source:'/source2.png',output:'/compressed2.webp'}, {status:'error',output:'/failed.png'}]);
 assert.deepEqual(copied,['/compressed2.webp']);
});
test('writes are serialised, failure does not poison subsequent results', async () => {
 let release; const calls=[],errors=[];
 const copy=createAutomaticResultCopier(async path=>{
   calls.push(path);
   if(path==='/first.webp') await new Promise(resolve=>{release=resolve;});
   if(path==='/fail.webp') throw new Error('clipboard busy');
 },()=>true,error=>errors.push(error.message));
 const first=copy([{status:'done',output:'/first.webp'}]);
 const second=copy([{status:'done',output:'/fail.webp'}]);
 const third=copy([{status:'done',output:'/last.webp'}]);
 await Promise.resolve(); assert.deepEqual(calls,['/first.webp']);
 release(); await Promise.all([first,second,third]);
 assert.deepEqual(calls,['/first.webp','/fail.webp','/last.webp']);
 assert.deepEqual(errors,['clipboard busy']);
});
test('turning off the switch cancels queued clipboard writes', async () => {
 let enabled=true;
 const copied=[];
 const copy=createAutomaticResultCopier(async path=>copied.push(path),()=>enabled,()=>{});
 const pending=copy([{status:'done',output:'/final.webp'}]);
 enabled=false; await pending; assert.deepEqual(copied,[]);
});
