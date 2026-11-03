// Stockage privé des documents de Suite Horizon, séparé pour chaque compte.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = new Set(['document', 'presentation', 'spreadsheet']);
const MAX_DOC_BYTES = 25 * 1024 * 1024;
const MAX_ACCOUNT_BYTES = 100 * 1024 * 1024;
const MAX_DOCS = 500;
const MAX_HISTORY = 20;
const MIN_HISTORY_GAP_MS = 60 * 1000;
const MAX_HISTORY_BYTES = 500 * 1024 * 1024;
const OFFICE_FORMATS = new Set(['docx','pptx','xlsx']);

function normalizeCloudSource(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Lien Havre invalide.');
  const fileId=String(value.fileId||'');
  if(!/^[0-9a-f-]{36}$/i.test(fileId))throw new Error('Fichier Havre invalide.');
  const format=String(value.format||'').toLowerCase();
  if(!OFFICE_FORMATS.has(format))throw new Error('Format de fichier Havre non pris en charge.');
  const name=String(value.name||'').trim();
  if(!name||name.length>240||/[\\/\x00-\x1f]/.test(name))throw new Error('Nom du fichier Havre invalide.');
  const folder=String(value.folder||'').trim();
  if(folder.length>1200||folder.split('/').filter(Boolean).some(part=>part==='.'||part==='..'||part.length>100||/[\\:*?"<>|\x00-\x1f]/.test(part)))throw new Error('Dossier Havre invalide.');
  return {fileId,name,folder,format};
}

function createOfficeStore(dataDir) {
  const root = path.join(dataDir, 'office', 'accounts');
  const historyRoot = path.join(dataDir, 'office', 'history');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(historyRoot, { recursive: true });
  // Windows ne remplace pas toujours un fichier existant avec renameSync.
  // Restaure aussi le dernier instantané si le processus a été arrêté durant un remplacement.
  for (const name of fs.readdirSync(root).filter(file => file.endsWith('.bak'))) {
    const backup = path.join(root, name), target = backup.replace(/\.[^.]+\.bak$/, '.json');
    try { if (!fs.existsSync(target)) fs.renameSync(backup, target); else fs.rmSync(backup, { force: true }); } catch {}
  }
  const accountFile = accountId => {
    if (!/^[0-9a-f-]{36}$/i.test(String(accountId))) throw new Error('Compte invalide.');
    return path.join(root, `${accountId}.json`);
  };
  const read = accountId => {
    const file = accountFile(accountId);
    if (!fs.existsSync(file)) return [];
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(value)) throw new Error('Le dossier de documents est illisible.');
    return value;
  };
  const write = (accountId, docs) => {
    const file = accountFile(accountId);
    const serialized = JSON.stringify(docs);
    if (Buffer.byteLength(serialized) > MAX_ACCOUNT_BYTES) throw new Error('Ton espace de documents atteint sa limite de 100 Mo.');
    const suffix = crypto.randomBytes(8).toString('hex');
    const temporary = `${file}.${suffix}.tmp`;
    fs.writeFileSync(temporary, serialized, { flag: 'wx' });
    // copyFile remplace proprement la destination sous Windows, là où rename ne le fait
    // pas de façon fiable lorsqu'elle existe déjà. Le fichier temporaire est complet avant copie.
    if (fs.existsSync(file)) { fs.copyFileSync(temporary, file); fs.rmSync(temporary, { force: true }); }
    else fs.renameSync(temporary, file);
  };
  const summary = doc => ({ id: doc.id, type: doc.type, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt, ...(doc.cloudSource?{cloudSource:doc.cloudSource}:{}) });
  const historyDir = (accountId,id) => {
    accountFile(accountId);
    if(!/^[0-9a-f-]{36}$/i.test(String(id)))throw new Error('Document invalide.');
    return path.join(historyRoot,accountId,id);
  };
  const saveHistory = (accountId,doc,force=false) => {
    const dir=historyDir(accountId,doc.id);fs.mkdirSync(dir,{recursive:true});
    const snapshots=fs.readdirSync(dir).filter(name=>/^[0-9a-f-]{36}\.json$/i.test(name)).sort();
    const latest=snapshots.at(-1);
    if(!force&&latest){try{const prior=JSON.parse(fs.readFileSync(path.join(dir,latest),'utf8'));if(Date.now()-Date.parse(prior.savedAt||0)<MIN_HISTORY_GAP_MS)return;}catch{}}
    const snapshot={id:crypto.randomUUID(),title:doc.title,type:doc.type,content:doc.content,savedAt:new Date().toISOString()};
    fs.writeFileSync(path.join(dir,`${snapshot.id}.json`),JSON.stringify(snapshot),{flag:'wx'});
    const all=fs.readdirSync(dir).filter(name=>/^[0-9a-f-]{36}\.json$/i.test(name)).sort();
    for(const old of all.slice(0,Math.max(0,all.length-MAX_HISTORY)))fs.rmSync(path.join(dir,old),{force:true});
    const accountHistory=path.join(historyRoot,accountId);let total=0,entries=[];
    if(fs.existsSync(accountHistory))for(const document of fs.readdirSync(accountHistory)){const folder=path.join(accountHistory,document);try{for(const name of fs.readdirSync(folder).filter(file=>/^[0-9a-f-]{36}\.json$/i.test(file))){const file=path.join(folder,name),stat=fs.statSync(file);total+=stat.size;entries.push({file,time:stat.mtimeMs,size:stat.size});}}catch{}}
    entries.sort((a,b)=>a.time-b.time);for(const entry of entries){if(total<=MAX_HISTORY_BYTES)break;fs.rmSync(entry.file,{force:true});total-=entry.size;}
  };
  return {
    list(accountId) { return read(accountId).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    get(accountId, id) { return read(accountId).find(doc => doc.id === id) || null; },
    history(accountId,id) {
      const dir=historyDir(accountId,id);if(!fs.existsSync(dir))return[];
      return fs.readdirSync(dir).filter(name=>/^[0-9a-f-]{36}\.json$/i.test(name)).map(name=>{
        try{const item=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));return{id:item.id,title:item.title,type:item.type,savedAt:item.savedAt};}catch{return null;}
      }).filter(Boolean).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
    },
    restore(accountId,id,versionId) {
      const dir=historyDir(accountId,id);
      if(!/^[0-9a-f-]{36}$/i.test(String(versionId)))throw new Error('Sauvegarde invalide.');
      const file=path.join(dir,`${versionId}.json`);let version;try{version=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Sauvegarde introuvable.');}
      const current=this.get(accountId,id);if(!current)throw new Error('Document introuvable.');
      return this.save(accountId,{id,type:version.type,title:version.title,content:version.content},{forceHistory:true});
    },
    save(accountId, input, {forceHistory=false}={}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Document invalide.');
      const id = input.id && /^[0-9a-f-]{36}$/i.test(String(input.id)) ? input.id : crypto.randomUUID();
      if (!TYPES.has(input.type)) throw new Error('Type de document inconnu.');
      const title = String(input.title || '').trim().slice(0, 120) || 'Sans titre';
      const content = input.content;
      if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Le contenu du document est invalide.');
      const serializedContent = JSON.stringify(content);
      if (Buffer.byteLength(serializedContent) > MAX_DOC_BYTES) throw new Error('Ce document dépasse la limite de 25 Mo.');
      const docs = read(accountId), index = docs.findIndex(doc => doc.id === id), old = index >= 0 ? docs[index] : null;
      if (!old && docs.length >= MAX_DOCS) throw new Error('La limite de 500 documents est atteinte.');
      if(old&&(old.title!==title||JSON.stringify(old.content)!==serializedContent))saveHistory(accountId,old,forceHistory);
      const now = new Date().toISOString();
      const cloudSource=Object.hasOwn(input,'cloudSource')?normalizeCloudSource(input.cloudSource):old?.cloudSource||null;
      const doc = { id, type: input.type, title, content, ...(cloudSource?{cloudSource}:{}), createdAt: old?.createdAt || now, updatedAt: now };
      if (old) docs[index] = doc; else docs.push(doc);
      write(accountId, docs);
      return doc;
    },
    remove(accountId, id) {
      const docs = read(accountId), index = docs.findIndex(doc => doc.id === id);
      if (index < 0) return false;
      docs.splice(index, 1); write(accountId, docs); return true;
    }
  };
}

module.exports = { createOfficeStore, MAX_DOC_BYTES, MAX_ACCOUNT_BYTES, MAX_DOCS };
