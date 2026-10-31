import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_INTERFACE_TYPOGRAPHY,normalizeInterfaceTypography,interfaceFontStack} from '../app/interface-typography.ts';
import {importInterfaceFont} from '../app/interface-fonts.ts';
test('typography validates numeric bounds, control characters and imported identities',()=>{
 for(const interfaceFontScale of [NaN,Infinity,null,'120',0,89,151])assert.equal(normalizeInterfaceTypography({interfaceFontScale}).interfaceFontScale,110);
 for(const interfaceFontScale of [90,100,110,125,150])assert.equal(normalizeInterfaceTypography({interfaceFontScale}).interfaceFontScale,interfaceFontScale);
 assert.deepEqual(normalizeInterfaceTypography(),DEFAULT_INTERFACE_TYPOGRAPHY);
 assert.equal(normalizeInterfaceTypography({interfaceFontFamily:'bad\u0000font'}).interfaceFontFamily,'');
 assert.equal(normalizeInterfaceTypography({interfaceFontFamily:'  Noto Sans SC  '}).interfaceFontFamily,'Noto Sans SC');
 assert.equal(normalizeInterfaceTypography({interfaceFontId:'../../font.ttf'}).interfaceFontId,'');
 assert.ok(interfaceFontStack('Name "with quotes"').startsWith(JSON.stringify('Name "with quotes"') + ', '));
});
test('font import rejects invalid extensions, empty and oversized files before storage',async()=>{
 await assert.rejects(importInterfaceFont(new File(['valid?'],'bad.exe')),/TTF/);
 await assert.rejects(importInterfaceFont(new File([],'empty.ttf')),/32 MB/);
 await assert.rejects(importInterfaceFont({name:'large.ttf',size:32*1024*1024+1}),/32 MB/);
});
test('font validation failures never save or change the selected font',async()=>{
 const previous=globalThis.FontFace;let saves=0;
 globalThis.FontFace=class { async load(){throw Error('invalid font');} };
 try{await assert.rejects(importInterfaceFont(new File(['broken font'],'broken.ttf'),{saveImportedFont:async()=>saves++}),/invalid font/);assert.equal(saves,0);}finally{if(previous===undefined)delete globalThis.FontFace;else globalThis.FontFace=previous;}
});
