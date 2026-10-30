import test from 'node:test';
import assert from 'node:assert/strict';
import { moveBefore, normalizeLibraryFolders, chooseFolderForWrite } from '../app/library-organization.ts';

test('drag reorders without losing or duplicating tools; stale target leaves order intact', () => {
  assert.deepEqual(moveBefore(['a','b','c'], 'c', 'a'), ['c','a','b']);
  assert.deepEqual(moveBefore(['a','b','c'], 'a', 'c'), ['b','a','c']);
  assert.deepEqual(moveBefore(['a','b'], 'b', 'missing'), ['a','b']);
});
test('folder state rejects corrupt data and stale automatic destinations', () => {
  assert.deepEqual(normalizeLibraryFolders({folders:[{id:'one', name:' Work '},{id:'one',name:'Duplicate'},{id:'',name:'Bad'}],defaultFolderId:'deleted'}), {folders:[{id:'one',name:'Work'}],defaultFolderId:''});
  assert.deepEqual(normalizeLibraryFolders(null),{folders:[],defaultFolderId:''});
});
test('automatic classification applies only to new results; existing uncategorized images remain so', () => {
  assert.equal(chooseFolderForWrite(undefined,undefined,'work'),'work');
  assert.equal(chooseFolderForWrite('',{folderId:'work'},'other'),'');
  assert.equal(chooseFolderForWrite(undefined,{},'work'),'');
  assert.equal(chooseFolderForWrite(undefined,{folderId:'work'},'other'),'work');
});
