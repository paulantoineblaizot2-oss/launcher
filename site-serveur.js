// Serveur séparé pour le portfolio, les comptes, Havre, Suite Horizon et les outils d'administration.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {createServer}=require('./lib');
const serverRoot=path.basename(__dirname).toLowerCase()==='runtime'?path.dirname(__dirname):__dirname;
const cfgFile=path.join(serverRoot,'config.json');
if(!fs.existsSync(cfgFile))throw new Error('config.json introuvable. Lance d’abord le serveur Harbor Launcher.');
const cfg=JSON.parse(fs.readFileSync(cfgFile,'utf8'));
const dataDir=path.resolve(serverRoot,cfg.dataDir||'data');
const updateDir=path.resolve(serverRoot,cfg.updateDir||path.join(cfg.dataDir||'data','updates'));
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(updateDir,{recursive:true});
const port=Number(cfg.sitePort)||8788;
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('sitePort doit être un port valide entre 1024 et 65535.');
const log=message=>console.log(`[${new Date().toLocaleString('fr-FR')}] ${message}`);
let server;
function restartSite(){
  if(!server)return;server.close(()=>{const child=spawn(process.execPath,[__filename],{cwd:path.dirname(__filename),detached:true,windowsHide:true,stdio:'ignore',env:process.env});child.unref();process.exit(0);});
}
server=createServer({dataDir,updateDir,trustProxy:cfg.trustProxy===true,surface:'site',log,restartSite});server.listen(port,'127.0.0.1',()=>{
  log(`Serveur du site démarré en HTTP local sur 127.0.0.1:${port}`);
  log('Comptes, Havre, Suite Horizon et outils du site sont disponibles derrière Caddy.');
});
