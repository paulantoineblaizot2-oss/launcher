// Serveur de modpacks Build Boat : aucune dépendance, juste Node.js 18+.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Transform}=require('stream'),{pipeline}=require('stream/promises');
const {createAuth}=require('./auth');
const {createSiteContent}=require('./site-content');
const ID=/^[a-z0-9][a-z0-9-]{1,39}$/,JAR=/^[\w.+() \-\[\]]{1,100}\.jar$/,LOADERS=['vanilla','forge','neoforge','fabric','quilt'];
const MAX_FILE=300*1024*1024,MAX_FILES=600,MAX_TOTAL=3*1024*1024*1024;
const MAX_SITE_FILE=100*1024*1024,MAX_UPDATE_FILE=500*1024*1024;
const sha256=f=>new Promise((res,rej)=>{const h=crypto.createHash('sha256');fs.createReadStream(f).on('data',d=>h.update(d)).on('end',()=>res(h.digest('hex'))).on('error',rej);});
const sha512File=f=>new Promise((res,rej)=>{const h=crypto.createHash('sha512');fs.createReadStream(f).on('data',d=>h.update(d)).on('end',()=>res(h.digest('base64'))).on('error',rej);});
const slug=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
const packDir=(dataDir,id)=>{if(!ID.test(id))throw new Error('Identifiant invalide');return path.join(dataDir,'packs',id);};
function readManifest(dataDir,id){try{return JSON.parse(fs.readFileSync(path.join(packDir(dataDir,id),'manifest.json'),'utf8'));}catch{return null;}}
function listManifests(dataDir){
  const d=path.join(dataDir,'packs');if(!fs.existsSync(d))return[];
  return fs.readdirSync(d).filter(x=>ID.test(x)).map(x=>readManifest(dataDir,x)).filter(Boolean);
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
function createServer({dataDir,accessCode='',updateDir=path.join(dataDir,'updates'),trustProxy=false,tlsOptions=null,log=()=>{}}){
  const hits=new Map();
  const publishStarts=new Map();
  const limited=ip=>{const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<60000);a.push(n);hits.set(ip,a);return a.length>2500;};
  setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(!v.some(t=>n-t<60000))hits.delete(k);},60000).unref();
  const send=(res,code,obj)=>{const b=Buffer.from(JSON.stringify(obj));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(b);};
  const siteDir=path.join(__dirname,'site');
  const handleAuth=createAuth({dataDir,trustProxy,log});
  const siteContent=createSiteContent(dataDir);
  const siteFiles={'/':'index.html','/site.css':'site.css','/site.js':'site.js'};
  const handler=async(req,res)=>{
    try{
      const peer=req.socket.remoteAddress||'';const localProxy=peer==='127.0.0.1'||peer==='::1'||peer==='::ffff:127.0.0.1';if(req.socket.encrypted||(trustProxy&&localProxy&&req.headers['x-forwarded-proto']==='https'))res.setHeader('Strict-Transport-Security','max-age=31536000');
      const ip=req.socket.remoteAddress||'?';if(limited(ip))return send(res,429,{error:'Trop de requêtes'});
      if(req.url.length>500)return send(res,414,{error:'URL trop longue'});
      const u=new URL(req.url,'http://x'),p=u.pathname;
      if(p.startsWith('/api/auth/'))return await handleAuth(req,res,u);
      if(p==='/api/site/content'&&req.method==='GET')return send(res,200,siteContent.view());
      if(p==='/api/admin/site-files'&&(req.method==='POST'||req.method==='DELETE')){
        if(!handleAuth.originOkay(req))return send(res,403,{error:'Origine de la requête refusée'});
        if(!handleAuth.isAdmin(req))return send(res,403,{error:'Connecte-toi avec un compte administrateur.'});
        let name=u.searchParams.get('name')||'';
        name=path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim();
        if(!name||name.length>150||name==='.'||name==='..')return send(res,400,{error:'Nom de fichier invalide'});
        const length=Number(req.headers['content-length']||0);if(length>MAX_SITE_FILE)return send(res,413,{error:'Le fichier dépasse la limite de 100 Mo.'});
        const root=path.join(dataDir,'site-downloads');fs.mkdirSync(root,{recursive:true});
        const target=path.join(root,name),temp=target+'.'+crypto.randomBytes(8).toString('hex')+'.upload';let size=0;
        if(req.method==='DELETE'){if(!fs.existsSync(target)||!fs.statSync(target).isFile())return send(res,404,{error:'Fichier introuvable'});fs.unlinkSync(target);return send(res,200,{ok:true});}
        try{await pipeline(req,new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>MAX_SITE_FILE)cb(Object.assign(new Error('Le fichier dépasse la limite de 100 Mo.'),{statusCode:413}));else cb(null,chunk);}}),fs.createWriteStream(temp,{flags:'wx'}));if(!size)throw Object.assign(new Error('Le fichier est vide.'),{statusCode:400});fs.renameSync(temp,target);return send(res,201,{name,url:'/site-downloads/'+encodeURIComponent(name),size});}
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
        if(req.method==='GET'&&p==='/api/admin/launcher-update/status'){let version=null;try{version=JSON.parse(fs.readFileSync(path.join(updateDir,'release.json'),'utf8')).payload.version;}catch{}return send(res,200,{version});}
        if(req.method==='POST'&&p==='/api/admin/launcher-update/upload'){
          const name=u.searchParams.get('name')||'';
          if(!/^(release\.json|latest\.yml|Harbor Launcher Setup \d+\.\d+\.\d+\.exe(?:\.blockmap)?)$/.test(name))return send(res,400,{error:'Fichier de mise à jour non reconnu.'});
          if(Number(req.headers['content-length']||0)>MAX_UPDATE_FILE)return send(res,413,{error:'Le fichier de mise à jour dépasse 500 Mo.'});
          fs.mkdirSync(stage,{recursive:true});const temp=path.join(stage,name+'.'+crypto.randomBytes(8).toString('hex')+'.upload');let size=0;
          try{await pipeline(req,new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>MAX_UPDATE_FILE)cb(Object.assign(new Error('Le fichier de mise à jour dépasse 500 Mo.'),{statusCode:413}));else cb(null,chunk);}}),fs.createWriteStream(temp,{flags:'wx'}));if(!size)throw Object.assign(new Error('Le fichier est vide.'),{statusCode:400});fs.renameSync(temp,path.join(stage,name));return send(res,201,{name,size});}
          catch(error){try{fs.rmSync(temp,{force:true});}catch{}if(!res.headersSent)return send(res,error.statusCode||400,{error:error.message||'Envoi du fichier impossible.'});return res.destroy();}
        }
        if(req.method==='POST'&&p==='/api/admin/launcher-update/publish'){
          try{
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
            fs.rmSync(stage,{recursive:true,force:true});return send(res,200,{ok:true,version:payload.version,fileName:payload.fileName});
          }catch(error){return send(res,400,{error:error.message||'Publication de la mise à jour impossible.'});}
        }
        return send(res,404,{error:'Route de mise à jour introuvable.'});
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
          let release=null;try{const r=JSON.parse(fs.readFileSync(path.join(updateDir,'release.json'),'utf8'));const v=r.payload;if(v&&/^\d+\.\d+\.\d+$/.test(v.version)&&/^Harbor Launcher Setup [0-9.]+\.exe$/.test(v.fileName))release={version:v.version,downloadUrl:'/updates/'+encodeURIComponent(v.fileName)};}catch{}
          const packs=listManifests(dataDir).map(summary).sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
          return send(res,200,{name:'Harbor Launcher',release,packs});
        }
        if(Object.hasOwn(siteFiles,p)){
          const file=siteFiles[p],fp=path.join(siteDir,file);if(!fs.existsSync(fp))return send(res,404,{error:'Page introuvable'});
          const type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
          res.writeHead(200,{'Content-Type':type,'Content-Length':fs.statSync(fp).size,'Cache-Control':file==='index.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
          if(req.method==='HEAD')return res.end();return fs.createReadStream(fp).on('error',()=>res.destroy()).pipe(res);
        }
      }
      if((req.method==='GET'||req.method==='HEAD')&&p.startsWith('/updates/')){
        let name;try{name=decodeURIComponent(p.slice('/updates/'.length));}catch{return send(res,400,{error:'Nom invalide'});}
        if(!/^(release\.json|latest\.yml|Harbor Launcher Setup [0-9.]+\.exe(?:\.blockmap)?)$/.test(name))return send(res,404,{error:'Fichier introuvable'});
        const root=path.resolve(updateDir),fp=path.resolve(root,name);if(!fp.startsWith(root+path.sep)||!fs.existsSync(fp)||!fs.statSync(fp).isFile())return send(res,404,{error:'Fichier introuvable'});
        const type=name.endsWith('.json')?'application/json; charset=utf-8':name.endsWith('.yml')?'text/yaml; charset=utf-8':'application/octet-stream';
        res.writeHead(200,{'Content-Type':type,'Content-Length':fs.statSync(fp).size,'Cache-Control':name==='release.json'||name==='latest.yml'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
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
  return tlsOptions?require('https').createServer(tlsOptions,handler):http.createServer(handler);
}
module.exports={createServer,publish,unpublish,listManifests,readManifest,slug,summary};
