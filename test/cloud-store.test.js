const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createCloudStore}=require('../cloud-store');

function fixture(t,options){const data=fs.mkdtempSync(path.join(os.tmpdir(),'mavie-cloud-'));t.after(()=>fs.rmSync(data,{recursive:true,force:true}));return{data,store:createCloudStore(data,options),account:'2d94e50b-cf9a-4a51-8eef-e44f79ab847a',tempDir:os.tmpdir()};}
function upload(store,account,tempDir,{fileId=null,name='notes.txt',folder='',content='hello'}){const temp=path.join(tempDir,`mavie-upload-${crypto.randomUUID()}`);fs.writeFileSync(temp,content);const bytes=Buffer.from(content);try{return store.put(account,{fileId,name,folder,size:bytes.length,mime:'text/plain',hash:crypto.createHash('sha256').update(bytes).digest('hex'),tempPath:temp});}catch(error){fs.rmSync(temp,{force:true});throw error;}}

test('Havre conserve et restaure les versions, sans exposer les autres comptes',t=>{
  const{store,account,tempDir}=fixture(t);const first=upload(store,account,tempDir,{content:'version 1'});const second=upload(store,account,tempDir,{fileId:first.id,content:'version 2'});
  assert.equal(second.id,first.id);assert.equal(store.versions(account,first.id).length,2);
  const old=store.versions(account,first.id).find(version=>!version.current);
  store.restore(account,first.id,old.id);assert.equal(fs.readFileSync(store.downloadPath(account,first.id).path,'utf8'),'version 1');
  assert.equal(store.list('1d94e50b-cf9a-4a51-8eef-e44f79ab847a').files.length,0);
});

test('Havre organise les dossiers et refuse les noms de chemin',t=>{
  const{store,account,tempDir}=fixture(t);store.addFolder(account,'Projets/Notes');
  assert.deepEqual(store.list(account,'Projets').folders,['Notes']);
  assert.throws(()=>upload(store,account,tempDir,{name:'../secret.txt'}),/Nom de fichier invalide/);
});

test('Havre applique le quota avant de remplacer un fichier',t=>{
  const{store,account,tempDir}=fixture(t,{quotaBytes:7});const first=upload(store,account,tempDir,{content:'1234'});
  assert.throws(()=>upload(store,account,tempDir,{fileId:first.id,content:'12345678'}),/plein/);
  assert.equal(fs.readFileSync(store.downloadPath(account,first.id).path,'utf8'),'1234');
});

test('la corbeille garde les fichiers et leurs versions jusqu’à suppression définitive',t=>{
  const{store,account,tempDir}=fixture(t);const file=upload(store,account,tempDir,{content:'keep'});
  assert.equal(store.remove(account,file.id),true);assert.equal(store.list(account).files.length,0);assert.equal(store.listTrash(account).files.length,1);
  assert.equal(store.restoreDeleted(account,file.id),true);assert.equal(store.list(account).files.length,1);
  store.remove(account,file.id);assert.equal(store.purge(account,file.id),true);assert.equal(store.listTrash(account).files.length,0);
});
