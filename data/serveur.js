// Lance le serveur : node serveur.js
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {createServer,listManifests}=require('./lib');
const cfgFile=path.join(__dirname,'config.json');
if(!fs.existsSync(cfgFile))fs.writeFileSync(cfgFile,JSON.stringify({port:8787,accessCode:crypto.randomBytes(5).toString('hex'),dataDir:'data'},null,2));
const cfg=JSON.parse(fs.readFileSync(cfgFile,'utf8'));
if('publishCode' in cfg){delete cfg.publishCode;fs.writeFileSync(cfgFile,JSON.stringify(cfg,null,2));}
const dataDir=path.resolve(__dirname,cfg.dataDir||'data');
fs.mkdirSync(path.join(dataDir,'packs'),{recursive:true});
const updateDir=path.resolve(__dirname,cfg.updateDir||path.join(cfg.dataDir||'data','updates'));fs.mkdirSync(updateDir,{recursive:true});
const tlsKeyFile=cfg.httpsKeyFile?path.resolve(__dirname,cfg.httpsKeyFile):null;
const tlsCertFile=cfg.httpsCertFile?path.resolve(__dirname,cfg.httpsCertFile):null;
if(Boolean(tlsKeyFile)!==Boolean(tlsCertFile))throw new Error('Configure les deux chemins httpsKeyFile et httpsCertFile, ou aucun.');
const tlsOptions=tlsKeyFile?{key:fs.readFileSync(tlsKeyFile),cert:fs.readFileSync(tlsCertFile)}:null;
const log=m=>console.log(`[${new Date().toLocaleString('fr-FR')}] ${m}`);
createServer({dataDir,updateDir,accessCode:cfg.accessCode||'',trustProxy:cfg.trustProxy===true,tlsOptions,log}).listen(cfg.port||8787,'0.0.0.0',()=>{
  log(`Serveur Build Boat démarré en ${tlsOptions?'HTTPS':'HTTP'} sur le port ${cfg.port||8787}`);log(`Modpacks publiés : ${listManifests(dataDir).length}`);
  log(cfg.accessCode?`Code d'accès à donner à tes amis : ${cfg.accessCode}`:'Attention : aucun code d\'accès, tout le monde peut télécharger.');
  log('Publication publique activée : tout le monde peut publier.');});
