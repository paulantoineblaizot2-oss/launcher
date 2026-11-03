// Serveur de modpacks Build Boat : aucune dépendance, juste Node.js 18+.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Transform}=require('stream'),{pipeline}=require('stream/promises');
const {createAuth}=require('./auth');
const {createSiteContent}=require('./site-content');
const {createOfficeStore,MAX_DOC_BYTES}=require('./office-store');
const {createCloudStore,MAX_UPLOAD_BYTES}=require('./cloud-store');
const {exportOffice,importOffice}=require('./office-formats');
const minecraftBuilder=require('./minecraft-server-builder');
const {createManagedMinecraftServers}=require('./managed-minecraft-servers');
const {readUpdateZip}=require('./zip-update-package');
const ID=/^[a-z0-9][a-z0-9-]{1,39}$/,JAR=/^[\w.+() \-\[\]]{1,100}\.jar$/,LOADERS=['vanilla','forge','neoforge','fabric','quilt'];
const MAX_FILE=300*1024*1024,MAX_FILES=600,MAX_TOTAL=3*1024*1024*1024;
const MAX_SITE_FILE=10*1024*1024*1024,MAX_UPDATE_FILE=1024*1024*1024;
async function readBody(req,limit){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>limit)throw Object.assign(new Error('Requête trop volumineuse.'),{statusCode:413});}return raw||'{}';}
const sha256=f=>new Promise((res,rej)=>{const h=crypto.createHash('sha256');fs.createReadStream(f).on('data',d=>h.update(d)).on('end',()=>res(h.digest('hex'))).on('error',rej);});
const sha512File=f=>new Promise((res,rej)=>{const h=crypto.createHash('sha512');fs.createReadStream(f).on('data',d=>h.update(d)).on('end',()=>res(h.digest('base64'))).on('error',rej);});
const slug=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
const packDir=(dataDir,id)=>{if(!ID.test(id))throw new Error('Identifiant invalide');return path.join(dataDir,'packs',id);};
function readManifest(dataDir,id){try{return JSON.parse(fs.readFileSync(path.join(packDir(dataDir,id),'manifest.json'),'utf8'));}catch{return null;}}
function listManifests(dataDir){
  const d=path.join(dataDir,'packs');if(!fs.existsSync(d))return[];
  return fs.readdirSync(d).filter(x=>ID.test(x)).map(x=>readManifest(dataDir,x)).filter(Boolean);
}
function archiveLauncherUpdate(dataDir,stage,version){
  const name=String(version);if(!/^\d+\.\d+\.\d+$/.test(name))throw new Error('Version d’archive invalide.');
  const source=path.join(dataDir,'launcher-update-archives',name);fs.mkdirSync(source,{recursive:true});
  for(const file of fs.readdirSync(stage)){const from=path.join(stage,file);if(fs.statSync(from).isFile())fs.copyFileSync(from,path.join(source,file));}
  return source;
}
const summary=m=>({id:m.id,name:m.name,description:m.description,mc:m.mc,loader:m.loader,loaderVersion:m.loaderVersion,version:m.version,modCount:m.files.length,totalSize:m.files.reduce((n,f)=>n+f.size,0),updated:m.updated});
/** Publie (ou met à jour) un modpack : copie les .jar, calcule les sommes de contrôle, écrit le manifeste. */
async function publish(dataDir,{id,name,description='',mc,loader,loaderVersion=null,modsDir}){
  id=id||slug(name);if(!ID.test(id))throw new Error('Identifiant invalide (lettres, chiffres, tirets)');
  if(!LOADERS.includes(loader))throw new Error('Chargeur inconnu');
  if(!/^[\w.-]{1,20}$/.test(String(mc)))throw new Error('Version de Minecraft invalide');
  const jars=fs.readdirSync(modsDir).filter(f=>JAR.test(f)&&fs.statSync(path.join(modsDir,f)).isFile());
  if(!jars.length)throw new Error('Aucun fichier .jar à publier');if(jars.length>MAX_FILES)throw new Error('Trop de mods');
  const dir=packDir(dataDir,id),tmp=path.join(dataDir,'.uploads','local-'+crypto.randomBytes(12).toString('hex'));fs.mkdirSync(path.join(tmp,'files'),{recursive:true});
  const files=[];
  for(const j of jars){const src=path.join(modsDir,j),st=fs.statSync(src);if(st.size>MAX_FILE)throw new Error(`${j} est trop gros`);
    fs.copyFileSync(src,path.join(tmp,'files',j));files.push({name:j,size:st.size,sha256:await sha256(src)});}
  const old=readManifest(dataDir,id),version=(old?.version||0)+1,m={id,name:String(name).slice(0,48),description:String(description).slice(0,500),mc:String(mc),loader,loaderVersion,
    version,storageVersion:version,updated:new Date().toISOString(),files};
  const release=path.join(dir,'versions',String(version));fs.rmSync(release,{recursive:true,force:true});fs.mkdirSync(release,{recursive:true});fs.renameSync(path.join(tmp,'files'),path.join(release,'files'));
  fs.writeFileSync(path.join(release,'manifest.json'),JSON.stringify(m,null,2));const next=path.join(dir,`manifest.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(next,JSON.stringify(m,null,2));fs.renameSync(next,path.join(dir,'manifest.json'));fs.rmSync(tmp,{recursive:true,force:true});return m;
}
function unpublish(dataDir,id){fs.rmSync(packDir(dataDir,id),{recursive:true,force:true});}
/** Serveur HTTP en lecture seule. Le code d'accès (facultatif) est lu dans l'en-tête x-access-code. */
function launcherSurfacePath(pathname){return pathname==='/api/ping'||pathname==='/api/publish'||pathname.startsWith('/api/publish/')||pathname==='/api/packs'||pathname.startsWith('/api/packs/')||pathname.startsWith('/updates/');}
function surfaceAllowsRequest(surface,pathname){return surface==='all'||(surface==='launcher'?launcherSurfacePath(pathname):!launcherSurfacePath(pathname));}
function createServer({dataDir,accessCode='',updateDir=path.join(dataDir,'updates'),trustProxy=false,tlsOptions=null,surface='all',log=()=>{},restartSite=()=>{}}){
  const hits=new Map();
  const publishStarts=new Map();
  const limited=ip=>{const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<60000);a.push(n);hits.set(ip,a);return a.length>2500;};
  setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(!v.some(t=>n-t<60000))hits.delete(k);},60000).unref();
  const send=(res,code,obj)=>{const b=Buffer.from(JSON.stringify(obj));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(b);};
  const siteDir=path.join(__dirname,'site');
  const siteSurface=surface!=='launcher';
  const handleAuth=siteSurface?createAuth({dataDir,trustProxy,log}):null;
  const siteContent=siteSurface?createSiteContent(dataDir):null;
  const officeStore=siteSurface?createOfficeStore(dataDir):null;
  const cloudStore=siteSurface?createCloudStore(dataDir):null;
  const minecraftServers=siteSurface?createManagedMinecraftServers(dataDir):null;
  const siteFiles={'/':'index.html','/site.css':'site.css','/site.js':'site.js','/minecraft-servers.js':'minecraft-servers.js','/portal-app.css':'portal-app.css','/assets/mavie-avatar.png':'assets/mavie-avatar.png','/office':'office/index.html','/office/':'office/index.html','/office/app.css':'office/app.css','/office/sheet-engine.js':'office/sheet-engine.js','/office/app.js':'office/app.js','/cloud':'cloud/index.html','/cloud/':'cloud/index.html','/cloud/app.css':'cloud/app.css','/cloud/app.js':'cloud/app.js'};
  const handler=async(req,res)=>{
    try{
      const peer=req.socket.remoteAddress||'';const localProxy=peer==='127.0.0.1'||peer==='::1'||peer==='::ffff:127.0.0.1';if(req.socket.encrypted||(trustProxy&&localProxy&&req.headers['x-forwarded-proto']==='https'))res.setHeader('Strict-Transport-Security','max-age=31536000');
      const ip=req.socket.remoteAddress||'?';if(limited(ip))return send(res,429,{error:'Trop de requêtes'});
      if(req.url.length>500)return send(res,414,{error:'URL trop longue'});
      const u=new URL(req.url,'http://x'),p=u.pathname;
      if(!surfaceAllowsRequest(surface,p))return send(res,404,{error:surface==='launcher'?'Cette adresse appartient au serveur du site.':'Cette adresse appartient au serveur Harbor Launcher.'});
      if(p.startsWith('/api/admin/minecraft/')){
        if(!handleAuth.isAdmin(req))return send(res,403,{error:'Connecte-toi avec un compte administrateur.'});
        if(!handleAuth.isSecure(req))return send(res,403,{code:'HTTPS_REQUIRED',error:'La création de serveurs nécessite HTTPS.'});
        if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée.'});
        if(req.method==='GET'&&p==='/api/admin/minecraft/versions'){try{return send(res,200,await minecraftBuilder.versions(u.searchParams.get('minecraft')||''));}catch(error){return send(res,502,{error:error.message||'Catalogue de versions indisponible.'});}}
        if(req.method==='GET'&&p==='/api/admin/minecraft/servers')return send(res,200,{servers:minecraftServers.list()});
        if(req.method==='GET'&&p==='/api/admin/minecraft/mods/search'){try{return send(res,200,{mods:await minecraftServers.searchMods(u.searchParams.get('server')||'',u.searchParams.get('q')||'')});}catch(error){return send(res,400,{error:error.message||'Recherche Modrinth impossible.'});}}
        const serverAction=/^\/api\/admin\/minecraft\/servers\/([a-z0-9][a-z0-9-]{1,39})(?:\/(start|stop|logs|command|modrinth|mods(?:\/[^/]+)?))?$/.exec(p);
        if(serverAction){const id=serverAction[1],action=serverAction[2]||'';try{
          if(req.method==='POST'&&action==='start')return send(res,200,minecraftServers.start(id));
          if(req.method==='POST'&&action==='stop')return send(res,200,await minecraftServers.stop(id));
          if(req.method==='GET'&&action==='logs')return send(res,200,{logs:minecraftServers.logs(id)});
          if(req.method==='POST'&&action==='command'){const input=JSON.parse(await readBody(req,4096));return send(res,200,minecraftServers.sendCommand(id,input.command));}
          if(req.method==='POST'&&action==='modrinth'){const input=JSON.parse(await readBody(req,4096));return send(res,200,await minecraftServers.installMod(id,input.project));}
          if(req.method==='POST'&&action==='mods'){return send(res,201,await minecraftServers.uploadMod(id,u.searchParams.get('name')||'',req));}
          if(req.method==='DELETE'&&action.startsWith('mods/'))return send(res,200,minecraftServers.removeMod(id,decodeURIComponent(action.slice(5))));
          if(req.method==='DELETE'&&!action)return send(res,200,await minecraftServers.remove(id));
        }catch(error){return send(res,error.statusCode||400,{error:error.message||'Opération serveur impossible.'});}return send(res,405,{error:'Opération serveur non autorisée.'});}
        if(req.method==='POST'&&p==='/api/admin/minecraft/servers'){
          if(!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée.'});let input;try{input=JSON.parse(await readBody(req,16384));}catch{return send(res,400,{error:'Paramètres de serveur invalides.'});}
          try{return send(res,201,await minecraftServers.create(input));}catch(error){return send(res,400,{error:error.message||'Création du serveur impossible.'});}
        }
        if(req.method==='POST'&&p==='/api/admin/minecraft/build'){
          let input;try{input=JSON.parse(await readBody(req,16384));}catch(error){return send(res,error.statusCode||400,{error:'Paramètres de serveur invalides.'});}
          try{const result=await minecraftBuilder.create(input);res.writeHead(200,{'Content-Type':'application/zip','Content-Length':result.buffer.length,'Content-Disposition':'attachment; filename="'+result.filename+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(result.buffer);}catch(error){return send(res,400,{error:error.message||'Création du serveur impossible.'});}
        }
        return send(res,404,{error:'Route de création Minecraft introuvable.'});
      }
      if(p.startsWith('/api/auth/'))return await handleAuth(req,res,u);
      const publicShare=/^\/api\/public\/share\/([A-Za-z0-9_-]{40,50})(?:\/download)?$/.exec(p);
      if(publicShare){
        if(p.endsWith('/download')&&req.method==='POST'){
          let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(res,413,{error:'Requête trop volumineuse.'});}
          let password='';try{password=new URLSearchParams(raw).get('password')||'';}catch{}
          try{const file=cloudStore.publicFile(publicShare[1],password),name=String(file.name).replace(/[\r\n"\\]/g,'_');res.writeHead(200,{'Content-Type':file.mime||'application/octet-stream','Content-Length':file.size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return fs.createReadStream(file.path).on('error',()=>res.destroy()).pipe(res);}catch(error){return send(res,403,{error:error.message||'Lien de partage invalide.'});}
        }
        return send(res,405,{error:'Méthode refusée'});
      }
      const publicSharePage=/^\/s\/([A-Za-z0-9_-]{40,50})\/?$/.exec(p);
      if(publicSharePage&&req.method==='GET'){
        if(!handleAuth.isSecure(req))return send(res,403,{error:'Ouvre ce lien en HTTPS.'});
        const token=publicSharePage[1],page=`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fichier partagé · Havre</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080d19;color:#f4f0e7;font:16px Arial}.card{width:min(460px,calc(100% - 40px));padding:32px;border:1px solid #293a57;border-radius:18px;background:#101b2d}h1{color:#e7bd61}p{color:#aab6c9;line-height:1.6}input,button{box-sizing:border-box;width:100%;margin-top:12px;padding:13px;border-radius:8px}input{border:1px solid #354969;background:#080d19;color:white}button{border:0;background:#e7bd61;font-weight:bold;cursor:pointer}small{display:block;margin-top:14px;color:#8795ad}</style><main class="card"><small>HAVRE · PARTAGE DE FICHIER</small><h1>Un fichier a été partagé avec toi</h1><p>Ce lien peut expirer. Saisis le mot de passe si le propriétaire en a défini un.</p><form method="post" action="/api/public/share/${token}/download"><label>Mot de passe (facultatif)<input name="password" type="password" autocomplete="current-password"></label><button type="submit">Télécharger le fichier</button></form><small>Le fichier est servi directement par le serveur du propriétaire.</small></main></html>`;
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(page),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});return res.end(page);
      }
      if(p.startsWith('/api/cloud/')){
        if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(req.method))return send(res,405,{error:'Méthode refusée'});
        if(req.method!=='GET'&&req.method!=='HEAD'&&!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});
        if(!handleAuth.isSecure(req))return send(res,403,{code:'HTTPS_REQUIRED',error:'Havre nécessite une connexion HTTPS.'});
        const account=handleAuth.getAccount(req);if(!account)return send(res,401,{error:'Connecte-toi pour utiliser Havre.'});
        const folder=u.searchParams.get('folder')||'';
        if(req.method==='GET'&&p==='/api/cloud/trash')return send(res,200,cloudStore.listTrash(account.id));
        if(req.method==='GET'&&p==='/api/cloud/list')return send(res,200,u.searchParams.get('all')==='1'?cloudStore.listAll(account.id):cloudStore.list(account.id,folder));
        if(req.method==='GET'&&p==='/api/cloud/shared')return send(res,200,{folders:cloudStore.listShared(account.id)});
        if(req.method==='POST'&&p==='/api/cloud/shared'){
          let input;try{input=JSON.parse(await readBody(req,8192));}catch{return send(res,400,{error:'Partage invalide.'});}
          const recipient=handleAuth.findAccount(input.username);if(!recipient)return send(res,404,{error:'Aucun compte ne correspond à ce pseudo.'});
          try{return send(res,201,cloudStore.createFolderShare(account.id,recipient.id,account.username,input.folder));}catch(error){return send(res,400,{error:error.message});}
        }
        if(req.method==='DELETE'&&p==='/api/cloud/shared'){
          let input;try{input=JSON.parse(await readBody(req,8192));}catch{return send(res,400,{error:'Partage invalide.'});}
          const recipient=handleAuth.findAccount(input.username);if(!recipient)return send(res,404,{error:'Aucun compte ne correspond à ce pseudo.'});
          return cloudStore.removeFolderShare(account.id,recipient.id,input.folder)?send(res,200,{ok:true}):send(res,404,{error:'Partage introuvable.'});
        }
        const sharedFiles=/^\/api\/cloud\/shared\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})$/i.exec(p);
        if(sharedFiles&&req.method==='GET'){const rootFolder=u.searchParams.get('root')||'',file=cloudStore.sharedDownload(account.id,sharedFiles[1],rootFolder,sharedFiles[2]);if(!file)return send(res,404,{error:'Fichier partagé introuvable.'});res.writeHead(200,{'Content-Type':file.mime||'application/octet-stream','Content-Length':file.size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return fs.createReadStream(file.path).on('error',()=>res.destroy()).pipe(res);}
        const sharedFolder=/^\/api\/cloud\/shared\/([0-9a-f-]{36})$/i.exec(p);
        if(sharedFolder&&req.method==='GET'){try{return send(res,200,cloudStore.sharedList(account.id,sharedFolder[1],u.searchParams.get('root')||'',u.searchParams.get('folder')||''));}catch(error){return send(res,403,{error:error.message});}}
        if(req.method==='POST'&&p==='/api/cloud/organize'){
          let input;try{input=JSON.parse(await readBody(req,8192));}catch{return send(res,400,{error:'Choix de rangement invalide.'});}
          try{return send(res,200,cloudStore.organize(account.id,input.mode));}catch(error){return send(res,400,{error:error.message});}
        }
        const createShare=/^\/api\/cloud\/files\/([0-9a-f-]{36})\/share$/i.exec(p);
        if(createShare&&req.method==='POST'){
          let input;try{input=JSON.parse(await readBody(req,8192));}catch{return send(res,400,{error:'Options de partage invalides.'});}
          const password=String(input.password||'');if(password.length>128)return send(res,400,{error:'Le mot de passe du lien est trop long.'});
          try{return send(res,201,cloudStore.createFileShare(account.id,createShare[1],{expiresInHours:input.expiresInHours,password}));}catch(error){return send(res,400,{error:error.message});}
        }
        const revokeShare=/^\/api\/cloud\/share\/([A-Za-z0-9_-]{40,50})$/.exec(p);
        if(revokeShare&&req.method==='DELETE')return cloudStore.revokeFileShare(account.id,revokeShare[1])?send(res,200,{ok:true}):send(res,404,{error:'Lien de partage introuvable.'});
        if(req.method==='POST'&&p==='/api/cloud/folders'){
          let input;try{input=JSON.parse(await readBody(req,8192));}catch(error){return send(res,error.statusCode||400,{error:error.message||'Dossier invalide.'});}
          try{return send(res,201,cloudStore.addFolder(account.id,[input.parent,input.name].filter(Boolean).join('/')));}catch(error){return send(res,400,{error:error.message});}
        }
        if(req.method==='DELETE'&&p==='/api/cloud/folders'){
          try{return cloudStore.removeFolder(account.id,folder)?send(res,200,{ok:true}):send(res,404,{error:'Dossier introuvable.'});}catch(error){return send(res,409,{error:error.message});}
        }
        if((req.method==='POST'||req.method==='PUT')&&p==='/api/cloud/upload'){
          let name='',uploadFolder='';try{name=decodeURIComponent(String(req.headers['x-file-name']||''));uploadFolder=decodeURIComponent(String(req.headers['x-cloud-folder']||''));}catch{return send(res,400,{error:'Nom de fichier incorrect.'});}const targetId=String(req.headers['x-file-id']||'')||null;
          const declared=Number(req.headers['content-length']||0);if(declared>MAX_UPLOAD_BYTES)return send(res,413,{error:'La limite est de 10 Go par fichier.'});
          const accountDir=path.join(dataDir,'cloud','accounts',account.id);fs.mkdirSync(accountDir,{recursive:true});
          const temp=path.join(accountDir,`.${crypto.randomBytes(16).toString('hex')}.upload`),hash=crypto.createHash('sha256');let size=0;
          try{
            await pipeline(req,new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>MAX_UPLOAD_BYTES)return cb(Object.assign(new Error('La limite est de 10 Go par fichier.'),{statusCode:413}));hash.update(chunk);cb(null,chunk);}}),fs.createWriteStream(temp,{flags:'wx'}));
            if(!size)throw Object.assign(new Error('Le fichier est vide.'),{statusCode:400});
            const item=cloudStore.put(account.id,{fileId:targetId,name,folder:uploadFolder,size,mime:req.headers['content-type']||'application/octet-stream',hash:hash.digest('hex'),tempPath:temp});return send(res,targetId?200:201,item);
          }catch(error){try{fs.rmSync(temp,{force:true});}catch{}return send(res,error.statusCode||400,{error:error.message||'Envoi impossible.'});}
        }
        const fileMatch=/^\/api\/cloud\/files\/([0-9a-f-]{36})(?:\/(versions|restore|untrash|purge))?$/i.exec(p);
        if(fileMatch){const [,id,action]=fileMatch;
          if(req.method==='GET'&&action==='versions'){const versions=cloudStore.versions(account.id,id);return versions?send(res,200,{versions}):send(res,404,{error:'Fichier introuvable.'});}
          if(req.method==='POST'&&action==='restore'){
            let input;try{input=JSON.parse(await readBody(req,8192));}catch{return send(res,400,{error:'Version invalide.'});}
            try{return send(res,200,cloudStore.restore(account.id,id,String(input.versionId||'')));}catch(error){return send(res,400,{error:error.message});}
          }
          if(req.method==='POST'&&action==='untrash'){try{return cloudStore.restoreDeleted(account.id,id)?send(res,200,{ok:true}):send(res,404,{error:'Fichier absent de la corbeille.'});}catch(error){return send(res,409,{error:error.message});}}
          if(req.method==='DELETE'&&action==='purge')return cloudStore.purge(account.id,id)?send(res,200,{ok:true}):send(res,404,{error:'Fichier absent de la corbeille.'});
          if(req.method==='GET'&&!action){const item=cloudStore.downloadPath(account.id,id,u.searchParams.get('version'));if(!item)return send(res,404,{error:'Fichier ou version introuvable.'});res.writeHead(200,{'Content-Type':item.mime||'application/octet-stream','Content-Length':item.size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return fs.createReadStream(item.path).on('error',()=>res.destroy()).pipe(res);}
          if(req.method==='PATCH'&&!action){let input;try{input=JSON.parse(await readBody(req,8192));}catch{return send(res,400,{error:'Modification invalide.'});}try{return send(res,200,cloudStore.rename(account.id,id,input));}catch(error){return send(res,400,{error:error.message});}}
          if(req.method==='DELETE'&&!action)return cloudStore.remove(account.id,id)?send(res,200,{ok:true}):send(res,404,{error:'Fichier introuvable.'});
        }
        return send(res,404,{error:'Route Havre introuvable.'});
      }
      if(p==='/api/site/content'&&req.method==='GET')return send(res,200,siteContent.view());
      const officeHistory=/^\/api\/office\/docs\/([0-9a-f-]{36})\/history(?:\/restore)?$/i.exec(p);
      if(officeHistory){const account=handleAuth.getAccount(req);if(!account)return send(res,401,{error:'Connecte-toi pour accéder à tes documents.'});const id=officeHistory[1];
        if(req.method==='GET'&&p.endsWith('/history')){if(!officeStore.get(account.id,id))return send(res,404,{error:'Document introuvable.'});return send(res,200,{versions:officeStore.history(account.id,id)});}
        if(req.method==='POST'&&p.endsWith('/history/restore')){if(!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});let input;try{input=JSON.parse(await readBody(req,8192));}catch{return send(res,400,{error:'Version invalide.'});}try{return send(res,200,officeStore.restore(account.id,id,String(input.versionId||'')));}catch(error){return send(res,400,{error:error.message});}}
        return send(res,405,{error:'Méthode refusée'});
      }
      if((p==='/api/office/export'||p==='/api/office/import')&&req.method==='POST'){
        if(!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});
        if(!handleAuth.getAccount(req))return send(res,401,{error:'Connecte-toi pour utiliser les formats Word, PowerPoint et Excel.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>MAX_DOC_BYTES*2+32768)return send(res,413,{error:'Le fichier dépasse la limite de 25 Mo.'});}
        let input;try{input=JSON.parse(raw||'{}');}catch{return send(res,400,{error:'Fichier ou document invalide.'});}
        if(p==='/api/office/export'){
          try{const result=exportOffice(input.document,u.searchParams.get('format'));const filename=String(result.filename).replace(/[\r\n"\\]/g,'_');res.writeHead(200,{'Content-Type':result.contentType,'Content-Length':result.buffer.length,'Content-Disposition':`attachment; filename="document.${u.searchParams.get('format')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(result.buffer);}catch(error){return send(res,400,{error:error.message||'Export impossible.'});}
        }
        try{if(typeof input.file!=='string'||input.file.length>MAX_DOC_BYTES*2)return send(res,413,{error:'Le fichier dépasse la limite de 25 Mo.'});const buffer=Buffer.from(input.file,'base64');if(!buffer.length||buffer.length>MAX_DOC_BYTES)return send(res,413,{error:'Le fichier Office doit faire 25 Mo maximum.'});const title=String(input.name||'Document importé').replace(/\.[^.]+$/,'').slice(0,120);return send(res,200,importOffice(buffer,u.searchParams.get('format'),title));}catch(error){return send(res,400,{error:error.message||'Import impossible.'});}
      }
      if(p==='/api/office/docs'||/^\/api\/office\/docs\/[0-9a-f-]{36}$/i.test(p)){
        if(!['GET','POST','PUT','DELETE'].includes(req.method))return send(res,405,{error:'Méthode refusée'});
        if(req.method!=='GET'&&!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});
        const account=handleAuth.getAccount(req);if(!account)return send(res,401,{error:'Connecte-toi pour accéder à tes documents.'});
        if(req.method==='GET'&&p==='/api/office/docs')return send(res,200,{documents:officeStore.list(account.id)});
        if(req.method==='POST'&&p==='/api/office/docs'||req.method==='PUT'&&/^\/api\/office\/docs\/[0-9a-f-]{36}$/i.test(p)){
          let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>MAX_DOC_BYTES+16384)return send(res,413,{error:'Ce document dépasse la limite de 25 Mo.'});}
          let input;try{input=JSON.parse(raw||'{}');}catch{return send(res,400,{error:'Document invalide.'});}
          if(req.method==='PUT')input.id=p.slice('/api/office/docs/'.length);
          try{return send(res,req.method==='POST'?201:200,officeStore.save(account.id,input));}catch(error){return send(res,400,{error:error.message||'Enregistrement impossible.'});}
        }
        const id=p.slice('/api/office/docs/'.length);
        if(req.method==='GET'){const doc=officeStore.get(account.id,id);return doc?send(res,200,doc):send(res,404,{error:'Document introuvable.'});}
        if(req.method==='DELETE')return officeStore.remove(account.id,id)?send(res,200,{ok:true}):send(res,404,{error:'Document introuvable.'});
      }
      if(p==='/api/admin/site-files'&&(req.method==='POST'||req.method==='DELETE')){
        if(!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});
        if(!handleAuth.isAdmin(req))return send(res,403,{error:'Connecte-toi avec un compte administrateur.'});
        let name=u.searchParams.get('name')||'';
        name=path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim();
        if(!name||name.length>150||name==='.'||name==='..')return send(res,400,{error:'Nom de fichier invalide'});
        const length=Number(req.headers['content-length']||0);if(length>MAX_SITE_FILE)return send(res,413,{error:'Le fichier dépasse la limite de 10 Go.'});
        const root=path.join(dataDir,'site-downloads');fs.mkdirSync(root,{recursive:true});
        const target=path.join(root,name),temp=target+'.'+crypto.randomBytes(8).toString('hex')+'.upload';let size=0;
        if(req.method==='DELETE'){if(!fs.existsSync(target)||!fs.statSync(target).isFile())return send(res,404,{error:'Fichier introuvable'});fs.unlinkSync(target);return send(res,200,{ok:true});}
        try{await pipeline(req,new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>MAX_SITE_FILE)cb(Object.assign(new Error('Le fichier dépasse la limite de 10 Go.'),{statusCode:413}));else cb(null,chunk);}}),fs.createWriteStream(temp,{flags:'wx'}));if(!size)throw Object.assign(new Error('Le fichier est vide.'),{statusCode:400});fs.renameSync(temp,target);return send(res,201,{name,url:'/site-downloads/'+encodeURIComponent(name),size});}
        catch(error){try{fs.rmSync(temp,{force:true});}catch{}if(!res.headersSent)return send(res,error.statusCode||400,{error:error.message||'Envoi du fichier impossible.'});return res.destroy();}
      }
      if((req.method==='GET'||req.method==='HEAD')&&p.startsWith('/site-downloads/')){
        let name;try{name=decodeURIComponent(p.slice('/site-downloads/'.length));}catch{return send(res,400,{error:'Nom invalide'});}
        if(!name||path.basename(name)!==name)return send(res,404,{error:'Fichier introuvable'});
        const root=path.resolve(dataDir,'site-downloads'),fp=path.resolve(root,name);if(!fp.startsWith(root+path.sep)||!fs.existsSync(fp)||!fs.statSync(fp).isFile())return send(res,404,{error:'Fichier introuvable'});
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':fs.statSync(fp).size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')return res.end();return fs.createReadStream(fp).on('error',()=>res.destroy()).pipe(res);
      }
      if(p.startsWith('/api/admin/launcher-update')){
        if(req.method!=='GET'&&!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});
        if(!handleAuth.isAdmin(req))return send(res,403,{error:'Connecte-toi avec un compte administrateur.'});
        const stage=path.join(dataDir,'.launcher-update-stage');
        if(req.method==='GET'&&p==='/api/admin/launcher-update/status'){let version=null;try{version=JSON.parse(fs.readFileSync(path.join(updateDir,'release.json'),'utf8')).payload.version;}catch{}let archives=[];try{archives=fs.readdirSync(path.join(dataDir,'launcher-update-archives')).filter(x=>/^\d+\.\d+\.\d+$/.test(x)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));}catch{}return send(res,200,{version,archives});}
        if(req.method==='POST'&&p==='/api/admin/launcher-update/upload'){
          const name=u.searchParams.get('name')||'';
          if(!/^(Harbor Launcher Update \d+\.\d+\.\d+\.zip|release\.json|latest\.yml|Harbor Launcher Setup \d+\.\d+\.\d+\.exe(?:\.blockmap)?)$/.test(name))return send(res,400,{error:'Fichier de mise à jour non reconnu.'});
          if(Number(req.headers['content-length']||0)>MAX_UPDATE_FILE)return send(res,413,{error:'Le fichier de mise à jour dépasse 1 Go.'});
          fs.mkdirSync(stage,{recursive:true});const temp=path.join(stage,name+'.'+crypto.randomBytes(8).toString('hex')+'.upload');let size=0;
          try{await pipeline(req,new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>MAX_UPDATE_FILE)cb(Object.assign(new Error('Le fichier de mise à jour dépasse 1 Go.'),{statusCode:413}));else cb(null,chunk);}}),fs.createWriteStream(temp,{flags:'wx'}));if(!size)throw Object.assign(new Error('Le fichier est vide.'),{statusCode:400});fs.renameSync(temp,path.join(stage,name));return send(res,201,{name,size});}
          catch(error){try{fs.rmSync(temp,{force:true});}catch{}if(!res.headersSent)return send(res,error.statusCode||400,{error:error.message||'Envoi du fichier impossible.'});return res.destroy();}
        }
        if(req.method==='POST'&&p==='/api/admin/launcher-update/publish'){
          try{
            const bundlePattern=/^Harbor Launcher Update \d+\.\d+\.\d+\.zip$/;
            const stagedBundles=fs.readdirSync(stage).filter(name=>bundlePattern.test(name));
            const requestedBundle=u.searchParams.get('name')||'';
            if(requestedBundle&&!bundlePattern.test(requestedBundle))throw new Error('Nom de paquet de mise à jour invalide.');
            const versionParts=name=>name.match(/(\d+)\.(\d+)\.(\d+)\.zip$/)?.slice(1).map(Number)||[0,0,0];
            const bundle=requestedBundle
              ? stagedBundles.includes(requestedBundle)?requestedBundle:null
              : stagedBundles.sort((a,b)=>{const av=versionParts(a),bv=versionParts(b);for(let i=0;i<3;i++)if(av[i]!==bv[i])return bv[i]-av[i];return 0;})[0];
            if(requestedBundle&&!bundle)throw new Error(`Le paquet ${requestedBundle} n’a pas été reçu par le serveur.`);
            if(bundle){
              const entries=readUpdateZip(path.join(stage,bundle)),releaseBytes=entries.get('release.json');if(!releaseBytes)throw new Error('Le paquet ne contient pas release.json.');
              const payloadDoc=JSON.parse(releaseBytes.toString('utf8')),payload=payloadDoc.payload;
              const publicKey='-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEANpC1r7qSzCt+KGhMfScn4pJPidJDU7E6Z2dNr1e275Q=\n-----END PUBLIC KEY-----\n';
              const validHash=value=>typeof value==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(value),validSize=value=>Number.isSafeInteger(value)&&value>0;
              const manifests={win32:'latest.yml',linux:'latest-linux.yml'};
              if(!payload||!/^\d+\.\d+\.\d+$/.test(payload.version)||bundle!==`Harbor Launcher Update ${payload.version}.zip`||payload.fileName!==`Harbor Launcher Setup ${payload.version}.exe`||!validSize(payload.size)||payload.size<1000000||!validHash(payload.sha512)||!payload.platforms||typeof payloadDoc.signature!=='string')throw new Error('Le manifeste multiplateforme est incomplet ou invalide.');
              if(!crypto.verify(null,Buffer.from(JSON.stringify(payload)),publicKey,Buffer.from(payloadDoc.signature,'base64')))throw new Error('La signature est invalide : la mise à jour n’a pas été créée par Harbor Launcher.');
              const expectedPlatforms=Object.keys(manifests);if(expectedPlatforms.some(platform=>!payload.platforms[platform])||Object.keys(payload.platforms).some(platform=>!manifests[platform]&&platform!=='darwin'))throw new Error('Le paquet doit contenir Windows et Linux.');
              const pausedMac=payload.platforms.darwin;if(pausedMac&&(pausedMac.available!==false||pausedMac.manifest!=='latest-mac.yml'||pausedMac.size!==1||!Array.isArray(pausedMac.artifacts)||pausedMac.artifacts.length!==1||pausedMac.artifacts[0].fileName!==`Harbor-Launcher-${payload.version}-mac.zip`||pausedMac.artifacts[0].size!==1||!validHash(pausedMac.artifacts[0].sha512)))throw new Error('La déclaration macOS en pause est invalide.');
              const used=new Set(['release.json','INSTALLATION.txt']),publishFiles=new Map();
              for(const [platform,manifestName]of Object.entries(manifests)){
                const release=payload.platforms[platform];if(release.manifest!==manifestName||!Array.isArray(release.artifacts)||!release.artifacts.length||!validSize(release.size))throw new Error(`Configuration ${platform} invalide dans release.json.`);
                const manifest=entries.get(manifestName);if(!manifest)throw new Error(`Le paquet ne contient pas ${manifestName}.`);used.add(manifestName);
                const text=manifest.toString('utf8');if(!text.includes(`version: ${payload.version}`))throw new Error(`${manifestName} ne correspond pas à la version ${payload.version}.`);
                let selectedSize=null;
                for(const artifact of release.artifacts){
                  const name=artifact.fileName;if(typeof name!=='string'||path.basename(name)!==name||/[\\/\0]/.test(name)||!validSize(artifact.size)||!validHash(artifact.sha512)||publishFiles.has(name))throw new Error(`Référence de fichier invalide dans ${manifestName}.`);
                  const allowed=platform==='win32'?new RegExp(`^Harbor Launcher Setup ${payload.version.replace(/\./g,'\\.')}\\.exe(?:\\.blockmap)?$`):new RegExp(`^Harbor-Launcher-${payload.version.replace(/\./g,'\\.')}\\.(?:deb|AppImage)(?:\\.blockmap)?$`);
                  if(!allowed.test(name))throw new Error(`Fichier inattendu dans ${manifestName} : ${name}`);
                  const data=entries.get(name);if(!data||data.length!==artifact.size||crypto.createHash('sha512').update(data).digest('base64')!==artifact.sha512)throw new Error(`Fichier manquant ou empreinte SHA-512 incorrecte : ${name}`);
                  if(!name.endsWith('.blockmap')){if(!text.includes(name)||!text.includes(artifact.sha512)||!text.includes(`size: ${artifact.size}`))throw new Error(`${manifestName} ne référence pas correctement ${name}.`);if(platform==='win32'&&name===payload.fileName){if(artifact.size!==payload.size||artifact.sha512!==payload.sha512)throw new Error('Les informations Windows ne correspondent pas au manifeste signé.');selectedSize=artifact.size;}if(platform==='linux'&&/\.(?:deb|AppImage)$/.test(name))selectedSize=artifact.size;}
                  used.add(name);publishFiles.set(name,data);
                }
                if(selectedSize!==release.size)throw new Error(`Taille du téléchargement ${platform} incorrecte dans release.json.`);
                publishFiles.set(manifestName,manifest);
              }
              for(const name of entries.keys())if(!used.has(name))throw new Error(`Fichier non référencé dans le paquet : ${name}`);
              fs.mkdirSync(updateDir,{recursive:true});
              for(const [name,data]of publishFiles)if(!name.startsWith('latest'))fs.writeFileSync(path.join(updateDir,name),data);
              for(const name of Object.values(manifests))fs.writeFileSync(path.join(updateDir,name),publishFiles.get(name));
              fs.writeFileSync(path.join(updateDir,'release.json'),releaseBytes);
              // Keep any older macOS downloads available while Windows/Linux releases continue.
              for(const name of fs.readdirSync(updateDir))if(/^(?:Harbor Launcher Setup \d+\.\d+\.\d+\.exe(?:\.blockmap)?|Harbor-Launcher-\d+\.\d+\.\d+\.(?:deb|AppImage)(?:\.blockmap)?)$/.test(name)&&!publishFiles.has(name))fs.rmSync(path.join(updateDir,name),{force:true});
              archiveLauncherUpdate(dataDir,stage,payload.version);fs.rmSync(stage,{recursive:true,force:true});return send(res,200,{ok:true,version:payload.version,platforms:['Windows','Linux'],archived:true});
            }
            const payloadDoc=JSON.parse(fs.readFileSync(path.join(stage,'release.json'),'utf8')),payload=payloadDoc.payload;
            const publicKey='-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEANpC1r7qSzCt+KGhMfScn4pJPidJDU7E6Z2dNr1e275Q=\n-----END PUBLIC KEY-----\n';
            if(!payload||!/^(\d+)\.(\d+)\.(\d+)$/.test(payload.version)||payload.fileName!==`Harbor Launcher Setup ${payload.version}.exe`||!Number.isSafeInteger(payload.size)||payload.size<1000000||! /^[A-Za-z0-9+/]{86}==$/.test(payload.sha512)||typeof payloadDoc.signature!=='string')throw new Error('Le release.json est incomplet ou invalide.');
            if(!crypto.verify(null,Buffer.from(JSON.stringify(payload)),publicKey,Buffer.from(payloadDoc.signature,'base64')))throw new Error('La signature est invalide : la mise à jour n’a pas été créée par Harbor Launcher.');
            const installer=path.join(stage,payload.fileName),latestPath=path.join(stage,'latest.yml');if(!fs.existsSync(installer)||!fs.existsSync(latestPath))throw new Error('Sélectionne aussi le fichier .exe et latest.yml avec release.json.');
            const st=fs.statSync(installer);if(st.size!==payload.size||await sha512File(installer)!==payload.sha512)throw new Error('L’installateur ne correspond pas à la signature de release.json.');
            const latest=fs.readFileSync(latestPath,'utf8');if(!latest.includes(`version: ${payload.version}`)||!latest.includes(`url: ${payload.fileName}`)||!latest.includes(`sha512: ${payload.sha512}`)||!latest.includes(`size: ${payload.size}`))throw new Error('latest.yml ne correspond pas à cette version de l’installateur.');
            fs.mkdirSync(updateDir,{recursive:true});for(const name of [payload.fileName,payload.fileName+'.blockmap','latest.yml'])if(fs.existsSync(path.join(stage,name)))fs.copyFileSync(path.join(stage,name),path.join(updateDir,name));
            fs.copyFileSync(path.join(stage,'release.json'),path.join(updateDir,'release.json'));
            for(const name of fs.readdirSync(updateDir))if(/^Harbor Launcher Setup \d+\.\d+\.\d+\.exe(?:\.blockmap)?$/.test(name)&&name!==payload.fileName&&name!==payload.fileName+'.blockmap')fs.rmSync(path.join(updateDir,name),{force:true});
            archiveLauncherUpdate(dataDir,stage,payload.version);fs.rmSync(stage,{recursive:true,force:true});return send(res,200,{ok:true,version:payload.version,fileName:payload.fileName,archived:true});
          }catch(error){return send(res,400,{error:error.message||'Publication de la mise à jour impossible.'});}
        }
        return send(res,404,{error:'Route de mise à jour introuvable.'});
      }
      if(p.startsWith('/api/admin/site-update')){
        if(req.method!=='GET'&&!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});
        if(!handleAuth.isAdmin(req))return send(res,403,{error:'Connecte-toi avec un compte administrateur.'});
        const stage=path.join(dataDir,'.site-update-stage'),archives=path.join(dataDir,'site-update-archives');
        if(req.method==='GET'&&p==='/api/admin/site-update/status'){let releases=[];try{releases=fs.readdirSync(archives).filter(x=>/^\d+\.\d+\.\d+$/.test(x)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));}catch{}return send(res,200,{releases});}
        if(req.method==='POST'&&p==='/api/admin/site-update/upload'){
          const name=u.searchParams.get('name')||'';if(!/^Harbor Site Update \d+\.\d+\.\d+\.zip$/.test(name))return send(res,400,{error:'Choisis un paquet Harbor Site Update x.y.z.zip.'});
          if(Number(req.headers['content-length']||0)>MAX_UPDATE_FILE)return send(res,413,{error:'Le fichier dépasse 1 Go.'});
          fs.mkdirSync(stage,{recursive:true});const temp=path.join(stage,name+'.'+crypto.randomBytes(8).toString('hex')+'.upload');let size=0;
          try{await pipeline(req,new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>MAX_UPDATE_FILE)cb(Object.assign(new Error('Le fichier dépasse 1 Go.'),{statusCode:413}));else cb(null,chunk);}}),fs.createWriteStream(temp,{flags:'wx'}));if(!size)throw Object.assign(new Error('Le fichier est vide.'),{statusCode:400});fs.renameSync(temp,path.join(stage,name));return send(res,201,{name,size});}
          catch(error){try{fs.rmSync(temp,{force:true});}catch{}if(!res.headersSent)return send(res,error.statusCode||400,{error:error.message||'Envoi impossible.'});return res.destroy();}
        }
        if(req.method==='POST'&&p==='/api/admin/site-update/publish'){
          try{
            const name=fs.readdirSync(stage).find(x=>/^Harbor Site Update \d+\.\d+\.\d+\.zip$/.test(x));if(!name)throw new Error('Dépose d’abord un paquet de mise à jour du site.');
            const version=/^Harbor Site Update (\d+\.\d+\.\d+)\.zip$/.exec(name)[1],entries=readUpdateZip(path.join(stage,name),{maxCompressed:MAX_UPDATE_FILE,maxExpanded:512*1024*1024,maxEntries:80});
            if(entries.size<1)throw new Error('Le paquet ne contient aucun fichier.');
            const allowed=new Set(['.html','.css','.js','.png','.svg','.ico','.webp','.woff2','.json']),destinations=[];let total=0;
            for(const [entry,data]of entries){if(!/^site__[A-Za-z0-9_.-]+(?:__[A-Za-z0-9_.-]+)*$/.test(entry))throw new Error(`Nom de fichier invalide : ${entry}`);const relative=entry.slice(6).split('__').join(path.sep);if(relative.split(/[\\/]/).some(part=>!part||part.startsWith('.'))||!allowed.has(path.extname(relative).toLowerCase()))throw new Error(`Fichier du site non autorisé : ${relative}`);if(data.length>25*1024*1024)throw new Error(`Fichier trop volumineux : ${relative}`);total+=data.length;if(total>512*1024*1024)throw new Error('Le contenu du paquet dépasse 512 Mo.');const target=path.resolve(siteDir,relative);if(!target.startsWith(path.resolve(siteDir)+path.sep))throw new Error('Chemin de destination invalide.');destinations.push({entry,relative,target,data});}
            const backup=path.join(dataDir,'site-update-backups',`${version}-${Date.now()}`);fs.mkdirSync(backup,{recursive:true});
            for(const file of destinations){fs.mkdirSync(path.dirname(file.target),{recursive:true});if(fs.existsSync(file.target)){const saved=path.join(backup,file.relative);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(file.target,saved);}const temp=file.target+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';fs.writeFileSync(temp,file.data);try{fs.renameSync(temp,file.target);}catch(error){if(process.platform!=='win32')throw error;fs.rmSync(file.target,{force:true});fs.renameSync(temp,file.target);}}
            fs.mkdirSync(path.join(archives,version),{recursive:true});fs.copyFileSync(path.join(stage,name),path.join(archives,version,name));fs.rmSync(stage,{recursive:true,force:true});send(res,200,{ok:true,version,files:destinations.length,restartScheduled:true});setTimeout(()=>restartSite(),500).unref();return;
          }catch(error){return send(res,400,{error:error.message||'Mise à jour du site impossible.'});}
        }
        return send(res,404,{error:'Route de mise à jour du site introuvable.'});
      }
      if(p.startsWith('/api/admin/site-content')){
        if(req.method!=='GET'&&!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});
        if(!handleAuth.isAdmin(req))return send(res,403,{error:'Connecte-toi avec un compte administrateur.'});
        if(req.method==='PUT'&&p==='/api/admin/site-content'){
          let input='';for await(const chunk of req){input+=chunk;if(input.length>128*1024)return send(res,413,{error:'Contenu trop volumineux'});}
          let value;try{value=JSON.parse(input||'{}');}catch{return send(res,400,{error:'Contenu invalide'});}
          return send(res,200,siteContent.updateCopy(value.copy));
        }
        if(req.method==='PUT'&&p==='/api/admin/site-content/blocks/order'){
          let input='';for await(const chunk of req){input+=chunk;if(input.length>8192)return send(res,413,{error:'Ordre trop volumineux'});}
          let value;try{value=JSON.parse(input||'{}');}catch{return send(res,400,{error:'Ordre invalide'});}
          try{return send(res,200,siteContent.reorderBlocks(value.ids));}catch(error){return send(res,400,{error:error.message});}
        }
        if(req.method==='PUT'&&p==='/api/admin/site-content/layout'){
          let input='';for await(const chunk of req){input+=chunk;if(input.length>8192)return send(res,413,{error:'Disposition trop volumineuse'});}
          let value;try{value=JSON.parse(input||'{}');}catch{return send(res,400,{error:'Disposition invalide'});}
          try{return send(res,200,siteContent.updateLayout(value.page,value.layout));}catch(error){return send(res,400,{error:error.message});}
        }
        if(req.method==='POST'&&p==='/api/admin/site-content/blocks'){
          let input='';for await(const chunk of req){input+=chunk;if(input.length>8192)return send(res,413,{error:'Bloc trop volumineux'});}
          let value;try{value=JSON.parse(input||'{}');}catch{return send(res,400,{error:'Bloc invalide'});}
          try{siteContent.addBlock(value);return send(res,201,siteContent.view());}catch(error){return send(res,400,{error:error.message});}
        }
        const blockMatch=/^\/api\/admin\/site-content\/blocks\/([0-9a-f-]{36})$/.exec(p);
        if(req.method==='PATCH'&&blockMatch){
          let input='';for await(const chunk of req){input+=chunk;if(input.length>8192)return send(res,413,{error:'Bloc trop volumineux'});}
          let value;try{value=JSON.parse(input||'{}');}catch{return send(res,400,{error:'Bloc invalide'});}
          try{siteContent.updateBlock(blockMatch[1],value);return send(res,200,siteContent.view());}catch(error){return send(res,400,{error:error.message});}
        }
        if(req.method==='DELETE'&&blockMatch){try{siteContent.removeBlock(blockMatch[1]);return send(res,200,siteContent.view());}catch(error){return send(res,404,{error:error.message});}}
        return send(res,404,{error:'Route d’administration introuvable'});
      }
      if(req.method==='GET'||req.method==='HEAD'){
        if(p==='/api/site/info'){
      let release=null;try{const r=JSON.parse(fs.readFileSync(path.join(updateDir,'release.json'),'utf8'));const v=r.payload;if(v&&/^\d+\.\d+\.\d+$/.test(v.version)&&/^Harbor Launcher Setup [0-9.]+\.exe$/.test(v.fileName)){const downloads={windows:'/updates/'+encodeURIComponent(v.fileName)};for(const [platform,info]of Object.entries(v.platforms||{})){if(info.available===false)continue;const file=info.artifacts?.find(a=>platform==='darwin'?a.fileName.endsWith('.dmg'):platform==='linux'?/\.(?:deb|AppImage)$/.test(a.fileName):false);if(platform==='darwin'&&file)downloads.macos='/updates/'+encodeURIComponent(file.fileName);if(platform==='linux'&&file)downloads.linux='/updates/'+encodeURIComponent(file.fileName);}release={version:v.version,downloadUrl:downloads.windows,downloads};}}catch{}
          const packs=listManifests(dataDir).map(summary).sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
          return send(res,200,{name:'Harbor Launcher',release,packs});
        }
        if(Object.hasOwn(siteFiles,p)){
          const file=siteFiles[p],fp=path.join(siteDir,file);if(!fs.existsSync(fp))return send(res,404,{error:'Page introuvable'});
          const ext=path.extname(file).toLowerCase(),type=ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':ext==='.png'?'image/png':ext==='.svg'?'image/svg+xml':ext==='.webp'?'image/webp':ext==='.ico'?'image/x-icon':ext==='.woff2'?'font/woff2':ext==='.json'?'application/json; charset=utf-8':'text/javascript; charset=utf-8';
          res.writeHead(200,{'Content-Type':type,'Content-Length':fs.statSync(fp).size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
          if(req.method==='HEAD')return res.end();return fs.createReadStream(fp).on('error',()=>res.destroy()).pipe(res);
        }
      }
      if((req.method==='GET'||req.method==='HEAD')&&p.startsWith('/updates/')){
        let name;try{name=decodeURIComponent(p.slice('/updates/'.length));}catch{return send(res,400,{error:'Nom invalide'});}
        if(!/^(release\.json|latest(?:-(?:linux|mac))?\.yml|Harbor Launcher Setup [0-9.]+\.exe(?:\.blockmap)?|Harbor-Launcher-[0-9.]+(?:-mac)?\.(?:deb|AppImage|dmg|zip)(?:\.blockmap)?)$/.test(name))return send(res,404,{error:'Fichier introuvable'});
        const root=path.resolve(updateDir),fp=path.resolve(root,name);if(!fp.startsWith(root+path.sep)||!fs.existsSync(fp)||!fs.statSync(fp).isFile())return send(res,404,{error:'Fichier introuvable'});
        const type=name.endsWith('.json')?'application/json; charset=utf-8':name.endsWith('.yml')?'text/yaml; charset=utf-8':'application/octet-stream';
        res.writeHead(200,{'Content-Type':type,'Content-Length':fs.statSync(fp).size,'Cache-Control':name==='release.json'||name.startsWith('latest')?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
        if(req.method==='HEAD')return res.end();return fs.createReadStream(fp).on('error',()=>res.destroy()).pipe(res);
      }
      if(p==='/api/ping')return send(res,200,{name:'Build Boat Modpacks',protected:!!accessCode});
      if(req.method==='POST'&&p==='/api/publish'){
        const recent=(publishStarts.get(ip)||[]).filter(t=>Date.now()-t<60*60*1000);if(recent.length>=10)return send(res,429,{error:'Trop de publications depuis cette connexion. Réessaie dans une heure.'});recent.push(Date.now());publishStarts.set(ip,recent);
        let body='';for await(const c of req){body+=c;if(body.length>256*1024){send(res,413,{error:'Manifeste trop gros'});return;}}
        let meta;try{meta=JSON.parse(body);}catch{return send(res,400,{error:'Manifeste invalide'});}
        if(typeof meta.name!=='string'||!meta.name.trim()||meta.name.length>48||typeof meta.description!=='string'||meta.description.length>500||!LOADERS.includes(meta.loader)||!/^[\w.-]{1,20}$/.test(String(meta.mc))||!Array.isArray(meta.files)||!meta.files.length||meta.files.length>MAX_FILES)return send(res,400,{error:'Informations du modpack invalides'});
        const seen=new Set();let total=0;for(const f of meta.files){if(!f||!JAR.test(f.name)||!Number.isInteger(f.size)||f.size<1||f.size>MAX_FILE||!/^[a-f0-9]{64}$/.test(f.sha256)||seen.has(f.name))return send(res,400,{error:'Fichier invalide'});seen.add(f.name);total+=f.size;if(total>1024*1024*1024)return send(res,413,{error:'Modpack trop volumineux (maximum 1 Go)'});}
        const uploadRoot=path.join(dataDir,'.uploads');fs.mkdirSync(uploadRoot,{recursive:true});
        for(const old of fs.readdirSync(uploadRoot)){const fp=path.join(uploadRoot,old);try{if(Date.now()-fs.statSync(fp).mtimeMs>24*60*60*1000)fs.rmSync(fp,{recursive:true,force:true});}catch{}}
        if(fs.readdirSync(uploadRoot).length>=5)return send(res,429,{error:'Trop de publications en cours'});
        const token=crypto.randomBytes(18).toString('hex'),id=slug(meta.name);if(!ID.test(id))return send(res,400,{error:'Nom de modpack invalide'});
        const dir=path.join(dataDir,'.uploads',token);fs.mkdirSync(path.join(dir,'files'),{recursive:true});
        fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({...meta,id,token}));
        return send(res,201,{id,token});
      }
      let up=/^\/api\/publish\/([a-f0-9]{36})\/(files\/(.+)|commit|cancel)$/.exec(p);
      if(up&&(req.method==='PUT'||req.method==='POST'||req.method==='DELETE')){
        const dir=path.join(dataDir,'.uploads',up[1]);let meta;try{meta=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8'));}catch{return send(res,404,{error:'Session de publication expirée'});}
        if(up[2]==='cancel'){if(req.method!=='DELETE')return send(res,405,{error:'Méthode refusée'});fs.rmSync(dir,{recursive:true,force:true});return send(res,200,{ok:true});}
        if(up[2]==='commit'){
          if(req.method!=='POST')return send(res,405,{error:'Méthode refusée'});
          for(const f of meta.files){const fp=path.join(dir,'files',f.name);if(!fs.existsSync(fp)||fs.statSync(fp).size!==f.size||await sha256(fp)!==f.sha256)return send(res,400,{error:`Fichier manquant ou invalide : ${f.name}`});}
          const old=readManifest(dataDir,meta.id),version=(old?.version||0)+1,manifest={id:meta.id,name:meta.name,description:meta.description,mc:String(meta.mc),loader:meta.loader,loaderVersion:meta.loaderVersion||null,version,storageVersion:version,updated:new Date().toISOString(),files:meta.files};
          const finalDir=packDir(dataDir,meta.id),release=path.join(finalDir,'versions',String(version));fs.mkdirSync(path.dirname(release),{recursive:true});fs.rmSync(release,{recursive:true,force:true});fs.mkdirSync(release,{recursive:true});
          fs.renameSync(path.join(dir,'files'),path.join(release,'files'));fs.writeFileSync(path.join(release,'manifest.json'),JSON.stringify(manifest,null,2));
          const next=path.join(finalDir,`manifest.${crypto.randomBytes(6).toString('hex')}.tmp`);fs.writeFileSync(next,JSON.stringify(manifest,null,2));fs.renameSync(next,path.join(finalDir,'manifest.json'));fs.rmSync(dir,{recursive:true,force:true});
          log(`${ip} publie ${meta.id} (${meta.files.length} fichiers)`);return send(res,200,{id:meta.id,version:manifest.version});
        }
        if(req.method!=='PUT')return send(res,405,{error:'Méthode refusée'});
        let name;try{name=decodeURIComponent(up[3]);}catch{return send(res,400,{error:'Nom invalide'});}
        const f=meta.files.find(x=>x.name===name);if(!f)return send(res,404,{error:'Fichier absent du manifeste'});
        if(Number(req.headers['content-length'])!==f.size)return send(res,400,{error:'Taille du fichier incorrecte'});
        const fp=path.join(dir,'files',name),h=crypto.createHash('sha256');let n=0;const out=fs.createWriteStream(fp,{flags:'wx'});
        try{await pipeline(req,new Transform({transform(c,e,cb){n+=c.length;if(n>f.size)return cb(new Error('Fichier trop gros'));h.update(c);cb(null,c);}}),out);}
        catch(e){out.destroy();fs.rmSync(fp,{force:true});throw e;}
        if(n!==f.size||h.digest('hex')!==f.sha256){fs.rmSync(fp,{force:true});return send(res,400,{error:'Somme de contrôle incorrecte'});}
        return send(res,200,{ok:true});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Méthode refusée'});
      const given=String(req.headers['x-access-code']||'');
      if(accessCode&&!(given.length===accessCode.length&&crypto.timingSafeEqual(Buffer.from(given),Buffer.from(accessCode))))return send(res,401,{error:'Code d\'accès incorrect'});
      if(p==='/api/packs')return send(res,200,listManifests(dataDir).map(summary));
      let m=/^\/api\/packs\/([a-z0-9-]+)$/.exec(p);
      if(m){const mf=readManifest(dataDir,m[1]);return mf?send(res,200,mf):send(res,404,{error:'Modpack introuvable'});}
      m=/^\/api\/packs\/([a-z0-9-]+)\/files\/([^/]+)$/.exec(p);
      if(m){let name;try{name=decodeURIComponent(m[2]);}catch{return send(res,400,{error:'Nom invalide'});}
        let mf=ID.test(m[1])&&readManifest(dataDir,m[1]);
        const requestedVersion=u.searchParams.get('v');if(requestedVersion&&/^\d{1,9}$/.test(requestedVersion)){
          const releaseManifest=path.join(packDir(dataDir,m[1]),'versions',requestedVersion,'manifest.json');try{const v=JSON.parse(fs.readFileSync(releaseManifest,'utf8'));if(v.id===m[1]&&String(v.version)===requestedVersion)mf=v;else mf=null;}catch{if(mf&&String(mf.version)===requestedVersion&&!mf.storageVersion){}else mf=null;}
        }
        const f=mf&&mf.files.find(x=>x.name===name);   // seuls les fichiers du manifeste sont servis
        if(!f||!JAR.test(name))return send(res,404,{error:'Fichier introuvable'});
        const fp=mf.storageVersion?path.join(packDir(dataDir,m[1]),'versions',String(mf.storageVersion),'files',name):path.join(packDir(dataDir,m[1]),'files',name);if(!fs.existsSync(fp))return send(res,404,{error:'Fichier introuvable'});
        res.writeHead(200,{'Content-Type':'application/java-archive','Content-Length':f.size,'X-Content-Type-Options':'nosniff'});
        if(req.method==='HEAD')return res.end();
        log(`${ip} télécharge ${m[1]}/${name}`);return fs.createReadStream(fp).on('error',()=>res.destroy()).pipe(res);}
      return send(res,404,{error:'Introuvable'});
    }catch(e){log('Erreur : '+e.message);try{send(res,500,{error:'Erreur interne'});}catch{}}
  };
  const server=tlsOptions?require('https').createServer(tlsOptions,handler):http.createServer(handler);
  // Les gros fichiers peuvent prendre bien plus que le délai HTTP par défaut de Node.
  // L’envoi de fichiers du site requiert déjà une session administrateur valide.
  server.requestTimeout=6*60*60*1000;
  return server;
}
module.exports={createServer,publish,unpublish,listManifests,readManifest,slug,summary,launcherSurfacePath,surfaceAllowsRequest};
