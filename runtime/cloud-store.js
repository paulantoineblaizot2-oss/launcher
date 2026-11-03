// Havre: espace privé de fichiers sur le disque du serveur.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const MAX_UPLOAD_BYTES=10*1024*1024*1024;
const DEFAULT_QUOTA_BYTES=50*1024*1024*1024;
const MAX_VERSIONS=10;
const SEGMENT=/^[^\\/:*?"<>|\x00-\x1f]{1,100}$/;
const shareSecret=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

function createCloudStore(dataDir,{quotaBytes=DEFAULT_QUOTA_BYTES}={}){
  const root=path.join(dataDir,'cloud','accounts');
  const shareFile=path.join(dataDir,'cloud','shares.json');
  fs.mkdirSync(root,{recursive:true});
  const readShares=()=>{try{const value=JSON.parse(fs.readFileSync(shareFile,'utf8'));return{links:Array.isArray(value.links)?value.links:[],folders:Array.isArray(value.folders)?value.folders:[]};}catch{return{links:[],folders:[]};}};
  const writeShares=value=>{fs.mkdirSync(path.dirname(shareFile),{recursive:true});const temp=`${shareFile}.${crypto.randomBytes(8).toString('hex')}.tmp`;fs.writeFileSync(temp,JSON.stringify(value),{flag:'wx'});fs.copyFileSync(temp,shareFile);fs.rmSync(temp,{force:true});};
  const dirFor=id=>{if(!/^[0-9a-f-]{36}$/i.test(String(id)))throw Error('Compte invalide.');return path.join(root,id);};
  const blank=()=>({files:[],folders:[],updatedAt:new Date().toISOString()});
  const read=id=>{
    const dir=dirFor(id),file=path.join(dir,'index.json'),backup=path.join(dir,'index.backup.json');
    fs.mkdirSync(path.join(dir,'blobs'),{recursive:true});
    for(const candidate of [file,backup])try{const data=JSON.parse(fs.readFileSync(candidate,'utf8'));if(data&&Array.isArray(data.files)&&Array.isArray(data.folders))return data;}catch{}
    return blank();
  };
  const write=(id,data)=>{
    const dir=dirFor(id),file=path.join(dir,'index.json'),temp=path.join(dir,`index.${crypto.randomBytes(8).toString('hex')}.tmp`);
    data.updatedAt=new Date().toISOString();
    fs.writeFileSync(temp,JSON.stringify(data),{flag:'wx'});
    if(fs.existsSync(file)){
      const prev=path.join(dir,`backup.${crypto.randomBytes(6).toString('hex')}.tmp`);
      let currentIsValid=false;try{const current=JSON.parse(fs.readFileSync(file,'utf8'));currentIsValid=Boolean(current&&Array.isArray(current.files)&&Array.isArray(current.folders));}catch{}
      if(currentIsValid){fs.copyFileSync(file,prev);fs.copyFileSync(prev,path.join(dir,'index.backup.json'));fs.rmSync(prev,{force:true});}
      fs.copyFileSync(temp,file);fs.rmSync(temp,{force:true});
    }else{try{fs.renameSync(temp,file);}catch(error){if(!['EXDEV','EPERM','EACCES'].includes(error.code))throw error;fs.copyFileSync(temp,file);fs.rmSync(temp,{force:true});}}
  };
  const validFolder=value=>{
    const folder=String(value||'').replace(/^\/+|\/+$/g,'');
    if(!folder)return'';
    const parts=folder.split('/');
    if(parts.length>30||parts.some(part=>!SEGMENT.test(part)||part==='.'||part==='..'))throw Error('Dossier invalide.');
    return parts.join('/');
  };
  const validName=value=>{
    const name=String(value||'').trim();
    if(!name||name==='.'||name==='..'||name.includes('/')||name.includes('\\')||!SEGMENT.test(name)||Buffer.byteLength(name,'utf8')>240)throw Error('Nom de fichier invalide.');
    return name;
  };
  const blobPath=(id,hash)=>{
    if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Version de fichier invalide.');
    return path.join(dirFor(id),'blobs',hash);
  };
  const usedBytes=data=>{
    const hashes=new Set();let bytes=0;
    for(const file of data.files)for(const version of file.versions||[]){if(!hashes.has(version.hash)){hashes.add(version.hash);bytes+=version.size;}}
    return bytes;
  };
  const cleanup=(id,data)=>{
    const referenced=new Set(data.files.flatMap(file=>(file.versions||[]).map(version=>version.hash)));
    const blobs=path.join(dirFor(id),'blobs');
    for(const name of fs.readdirSync(blobs))if(/^[a-f0-9]{64}$/.test(name)&&!referenced.has(name))fs.rmSync(path.join(blobs,name),{force:true});
  };
  const summary=file=>({id:file.id,name:file.name,folder:file.folder,size:file.size,mime:file.mime,createdAt:file.createdAt,updatedAt:file.updatedAt,trashedAt:file.trashedAt||null,versionCount:file.versions.length,favorite:Boolean(file.favorite)});
  return {
    list(id,folder=''){
      const data=read(id),current=validFolder(folder),prefix=current?current+'/':'';
      const folders=[...new Set(data.folders.filter(item=>item.startsWith(prefix)).map(item=>item.slice(prefix.length).split('/')[0]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
      const files=data.files.filter(file=>!file.trashedAt&&file.folder===current).map(summary).sort((a,b)=>a.name.localeCompare(b.name));
      return{folder:current,folders,files,usedBytes:usedBytes(data),quotaBytes};
    },
    listAll(id){const data=read(id);return{files:data.files.filter(file=>!file.trashedAt).map(summary).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))),usedBytes:usedBytes(data),quotaBytes};},
    listShared(id){return readShares().folders.filter(item=>item.recipientId===id).map(({ownerId,ownerUsername,folder,createdAt})=>({ownerId,ownerUsername,folder,createdAt}));},
    sharedList(recipientId,ownerId,sharedRoot,subfolder=''){
      const share=readShares().folders.find(item=>item.recipientId===recipientId&&item.ownerId===ownerId&&item.folder===sharedRoot);if(!share)throw Error('Ce dossier n’est pas partagé avec ton compte.');
      const base=validFolder(sharedRoot),relative=validFolder(subfolder),current=validFolder([base,relative].filter(Boolean).join('/'));if(current!==base&&!current.startsWith(base+'/'))throw Error('Dossier en dehors du partage.');
      const data=read(ownerId),prefix=current?current+'/':'';const folders=[...new Set(data.folders.filter(item=>item.startsWith(prefix)).map(item=>item.slice(prefix.length).split('/')[0]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
      return{folder:relative,folders,files:data.files.filter(file=>!file.trashedAt&&file.folder===current).map(summary).sort((a,b)=>a.name.localeCompare(b.name)),sharedRoot:base};
    },
    sharedDownload(recipientId,ownerId,sharedRoot,fileId){
      const share=readShares().folders.find(item=>item.recipientId===recipientId&&item.ownerId===ownerId&&item.folder===sharedRoot);if(!share)return null;
      const item=this.downloadPath(ownerId,fileId);if(!item)return null;const data=read(ownerId),file=data.files.find(row=>row.id===fileId);if(!file||!(file.folder===sharedRoot||file.folder.startsWith(sharedRoot+'/')))return null;return item;
    },
    createFolderShare(ownerId,recipientId,ownerUsername,folder){
      const normalized=validFolder(folder),data=read(ownerId);if(!data.folders.includes(normalized))throw Error('Dossier introuvable.');if(ownerId===recipientId)throw Error('Tu ne peux pas partager un dossier avec ton propre compte.');
      const shares=readShares();if(shares.folders.some(item=>item.ownerId===ownerId&&item.recipientId===recipientId&&item.folder===normalized))return{ownerId,recipientId,ownerUsername,folder:normalized};
      const record={ownerId,recipientId,ownerUsername:String(ownerUsername||'').slice(0,32),folder:normalized,createdAt:new Date().toISOString()};shares.folders.push(record);writeShares(shares);return record;
    },
    removeFolderShare(ownerId,recipientId,folder){const normalized=validFolder(folder),shares=readShares(),before=shares.folders.length;shares.folders=shares.folders.filter(item=>!(item.ownerId===ownerId&&item.recipientId===recipientId&&item.folder===normalized));if(shares.folders.length!==before)writeShares(shares);return shares.folders.length!==before;},
    createFileShare(ownerId,fileId,{expiresInHours=168,password=''}={}){
      const data=read(ownerId),file=data.files.find(item=>item.id===fileId&&!item.trashedAt);if(!file)throw Error('Fichier introuvable.');
      const hours=Math.max(1,Math.min(720,Number(expiresInHours)||168)),token=crypto.randomBytes(32).toString('base64url'),salt=password?crypto.randomBytes(16).toString('hex'):'';
      const record={tokenHash:shareSecret(token),ownerId,fileId,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+hours*3600000).toISOString(),passwordSalt:salt,passwordHash:password?shareSecret(`${salt}:${password}`):''};
      const shares=readShares();shares.links=shares.links.filter(item=>Date.parse(item.expiresAt)>Date.now());shares.links.push(record);writeShares(shares);
      return{token,expiresAt:record.expiresAt,passwordProtected:Boolean(password)};
    },
    publicFile(token,password=''){
      const shares=readShares(),hash=shareSecret(token),share=shares.links.find(item=>item.tokenHash===hash&&Date.parse(item.expiresAt)>Date.now());if(!share)throw Error('Ce lien de partage a expiré ou n’existe plus.');
      if(share.passwordHash&&share.passwordHash!==shareSecret(`${share.passwordSalt}:${password}`))throw Error('Mot de passe incorrect.');
      const item=this.downloadPath(share.ownerId,share.fileId);if(!item)throw Error('Le fichier partagé n’est plus disponible.');return item;
    },
    revokeFileShare(ownerId,token){const shares=readShares(),hash=shareSecret(token),before=shares.links.length;shares.links=shares.links.filter(item=>!(item.ownerId===ownerId&&item.tokenHash===hash));if(shares.links.length!==before)writeShares(shares);return shares.links.length!==before;},
    organize(id,mode){
      if(!['type','date'].includes(mode))throw Error('Mode de rangement invalide.');const data=read(id),now=new Date();let moved=0;
      const typeFor=name=>{const ext=path.extname(name).slice(1).toLowerCase();if(/^(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(ext))return'Images';if(/^(mp4|mkv|mov|avi|webm)$/.test(ext))return'Vidéos';if(/^(mp3|wav|ogg|flac|m4a)$/.test(ext))return'Audio';if(/^(zip|rar|7z|tar|gz)$/.test(ext))return'Archives';if(/^(docx?|odt|pdf|txt|md|rtf|pptx?|xlsx?|csv)$/.test(ext))return'Documents';return'Autres';};
      const occupied=new Set(data.files.filter(file=>!file.trashedAt).map(file=>`${file.folder.toLocaleLowerCase('fr')}\0${file.name.toLocaleLowerCase('fr')}`));
      for(const file of data.files){if(file.trashedAt)continue;const date=new Date(file.updatedAt||file.createdAt||now),folder=mode==='type'?typeFor(file.name):`${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}`;if(file.folder===folder)continue;const key=`${folder.toLocaleLowerCase('fr')}\0${file.name.toLocaleLowerCase('fr')}`;if(occupied.has(key))continue;occupied.delete(`${file.folder.toLocaleLowerCase('fr')}\0${file.name.toLocaleLowerCase('fr')}`);occupied.add(key);file.folder=folder;let parent='';for(const part of folder.split('/')){parent=parent?`${parent}/${part}`:part;if(!data.folders.includes(parent))data.folders.push(parent);}file.updatedAt=now.toISOString();moved++;}
      if(moved)write(id,data);return{moved,mode};
    },
    listTrash(id){const data=read(id);return{files:data.files.filter(file=>file.trashedAt).map(summary).sort((a,b)=>String(b.trashedAt).localeCompare(String(a.trashedAt))),usedBytes:usedBytes(data),quotaBytes};},
    addFolder(id,folder){
      const normalized=validFolder(folder);if(!normalized)throw Error('Indique le nom du dossier.');
      const data=read(id);if(data.folders.includes(normalized))return this.list(id,path.posix.dirname(normalized)==='.'?'':path.posix.dirname(normalized));
      let parent='';for(const part of normalized.split('/')){parent=parent?`${parent}/${part}`:part;if(!data.folders.includes(parent))data.folders.push(parent);}
      write(id,data);return this.list(id,path.posix.dirname(normalized)==='.'?'':path.posix.dirname(normalized));
    },
    put(id,{fileId=null,name,folder='',size,mime='application/octet-stream',hash,tempPath}){
      const safeName=validName(name),safeFolder=validFolder(folder),data=read(id);
      if(!Number.isSafeInteger(size)||size<1||size>MAX_UPLOAD_BYTES)throw Error('Un fichier doit peser entre 1 octet et 10 Go.');
      const index=fileId?data.files.findIndex(file=>file.id===fileId):-1,old=index>=0?data.files[index]:null;
      if(fileId&&!old)throw Error('Fichier introuvable.');
      if(data.files.some((file,i)=>i!==index&&!file.trashedAt&&file.folder===safeFolder&&file.name.toLocaleLowerCase('fr')===safeName.toLocaleLowerCase('fr')))throw Error('Un fichier de ce nom existe déjà dans ce dossier.');
      if(!data.folders.includes(safeFolder)&&safeFolder){let parent='';for(const part of safeFolder.split('/')){parent=parent?`${parent}/${part}`:part;if(!data.folders.includes(parent))data.folders.push(parent);}}
      const priorHashes=new Set(data.files.flatMap(file=>(file.versions||[]).map(version=>version.hash)));
      const retained=old?(old.versions||[]).filter(version=>version.hash!==hash).slice(-(MAX_VERSIONS-1)):[];
      const replacingSame=old?.versions?.[0]?.hash===hash;
      const additionalBytes=priorHashes.has(hash)?0:size;
      const evicted=new Set(old?(old.versions||[]).filter(version=>!retained.some(keep=>keep.hash===version.hash)&&version.hash!==hash).map(version=>version.hash):[]);
      const freed=[...evicted].reduce((sum,key)=>{const usedElsewhere=data.files.some((file,i)=>i!==index&&(file.versions||[]).some(version=>version.hash===key));return usedElsewhere?sum:sum+(old.versions.find(version=>version.hash===key)?.size||0);},0);
      if(usedBytes(data)-freed+additionalBytes>quotaBytes)throw Error(`Ton espace Havre est plein (${formatBytes(quotaBytes)}).`);
      const destination=blobPath(id,hash);fs.mkdirSync(path.dirname(destination),{recursive:true});
      if(!fs.existsSync(destination)){
        try{fs.renameSync(tempPath,destination);}catch(error){if(!['EXDEV','EPERM','EACCES'].includes(error.code))throw error;fs.copyFileSync(tempPath,destination);}
      }
      if(fs.existsSync(tempPath))fs.rmSync(tempPath,{force:true});
      const now=new Date().toISOString(),version={id:crypto.randomUUID(),hash,size,mime:String(mime).slice(0,120),updatedAt:now};
      const versions=old?(replacingSame?old.versions:[...retained,old.versions[old.versions.length-1],version].filter(Boolean)): [version];
      const uniqueVersions=[];for(const item of versions)if(!uniqueVersions.some(seen=>seen.hash===item.hash))uniqueVersions.push(item);
      const record={id:old?.id||crypto.randomUUID(),name:safeName,folder:safeFolder,size,mime:String(mime).slice(0,120),createdAt:old?.createdAt||now,updatedAt:now,versions:uniqueVersions.slice(-MAX_VERSIONS)};
      if(old)data.files[index]=record;else data.files.push(record);
      write(id,data);cleanup(id,data);return summary(record);
    },
    downloadPath(id,fileId,versionId=null){
      const data=read(id),file=data.files.find(item=>item.id===fileId);if(!file)return null;
      const version=versionId?(file.versions||[]).find(item=>item.id===versionId):file.versions[file.versions.length-1];
      if(!version)return null;const target=blobPath(id,version.hash);return fs.existsSync(target)?{path:target,name:file.name,size:version.size,mime:version.mime,updatedAt:version.updatedAt}:null;
    },
    versions(id,fileId){const file=read(id).files.find(item=>item.id===fileId);return file?file.versions.slice().reverse().map(version=>({id:version.id,size:version.size,mime:version.mime,updatedAt:version.updatedAt,current:version===file.versions[file.versions.length-1]})):null;},
    restore(id,fileId,versionId){
      const data=read(id),file=data.files.find(item=>item.id===fileId),source=file?.versions.find(item=>item.id===versionId);if(!file||!source)throw Error('Sauvegarde introuvable.');
      const sourcePath=blobPath(id,source.hash);if(!fs.existsSync(sourcePath))throw Error('Le fichier de sauvegarde est manquant.');
      const current=file.versions[file.versions.length-1];if(current?.hash===source.hash)return summary(file);
      const next={...source,id:crypto.randomUUID(),updatedAt:new Date().toISOString()};file.versions=[...file.versions,next].slice(-MAX_VERSIONS);file.size=next.size;file.mime=next.mime;file.updatedAt=next.updatedAt;write(id,data);return summary(file);
    },
    rename(id,fileId,patch){
      const data=read(id),file=data.files.find(item=>item.id===fileId);if(!file)throw Error('Fichier introuvable.');
      const {name,folder}=patch||{};
      if(Object.hasOwn(patch||{},'favorite')){file.favorite=Boolean(patch.favorite);file.updatedAt=new Date().toISOString();write(id,data);return summary(file);}
      const safeName=validName(name??file.name),safeFolder=validFolder(folder??file.folder);
      if(data.files.some(item=>item.id!==fileId&&!item.trashedAt&&item.folder===safeFolder&&item.name.toLocaleLowerCase('fr')===safeName.toLocaleLowerCase('fr')))throw Error('Un fichier de ce nom existe déjà dans ce dossier.');
      if(safeFolder&&!data.folders.includes(safeFolder)){let parent='';for(const part of safeFolder.split('/')){parent=parent?`${parent}/${part}`:part;if(!data.folders.includes(parent))data.folders.push(parent);}}
      file.name=safeName;file.folder=safeFolder;file.updatedAt=new Date().toISOString();write(id,data);return summary(file);
    },
    remove(id,fileId){const data=read(id),file=data.files.find(item=>item.id===fileId);if(!file||file.trashedAt)return false;file.trashedAt=new Date().toISOString();write(id,data);return true;},
    restoreDeleted(id,fileId){const data=read(id),file=data.files.find(item=>item.id===fileId);if(!file?.trashedAt)return false;if(data.files.some(item=>item.id!==fileId&&!item.trashedAt&&item.folder===file.folder&&item.name.toLocaleLowerCase('fr')===file.name.toLocaleLowerCase('fr')))throw Error('Un fichier actif porte déjà ce nom. Renomme-le ou supprime-le avant de restaurer.');delete file.trashedAt;write(id,data);return true;},
    purge(id,fileId){const data=read(id),index=data.files.findIndex(file=>file.id===fileId&&file.trashedAt);if(index<0)return false;data.files.splice(index,1);write(id,data);cleanup(id,data);return true;},
    removeFolder(id,folder){const normalized=validFolder(folder);if(!normalized)return false;const data=read(id);if(!data.folders.includes(normalized))return false;if(data.files.some(file=>file.folder===normalized||file.folder.startsWith(normalized+'/'))||data.folders.some(item=>item!==normalized&&item.startsWith(normalized+'/')))throw Error('Ce dossier contient encore des éléments.');data.folders=data.folders.filter(item=>item!==normalized);write(id,data);return true;},
    stats(id){const data=read(id);return{files:data.files.length,usedBytes:usedBytes(data),quotaBytes};}
  };
}
function formatBytes(bytes){if(bytes<1024)return`${bytes} o`;const units=['Ko','Mo','Go','To'];let n=bytes/1024,index=0;while(n>=1024&&index<units.length-1){n/=1024;index++;}return`${n.toFixed(n>=10?0:1)} ${units[index]}`;}

module.exports={createCloudStore,MAX_UPLOAD_BYTES,DEFAULT_QUOTA_BYTES};
