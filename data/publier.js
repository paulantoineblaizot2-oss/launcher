// Publie un modpack du launcher sur ce serveur :  node publier.js   (liste puis choix)
//                                                 node publier.js "Nom du modpack"
const fs=require('fs'),path=require('path'),os=require('os'),readline=require('readline');
const {publish,slug}=require('./lib');
const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')),dataDir=path.resolve(__dirname,cfg.dataDir||'data');
const root=path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'.buildboat','modpacks');
const packs=fs.existsSync(root)?fs.readdirSync(root).map(d=>{try{return{dir:path.join(root,d),...JSON.parse(fs.readFileSync(path.join(root,d,'pack.json'),'utf8'))};}catch{return null;}}).filter(Boolean):[];
if(!packs.length){console.log('Aucun modpack trouvé dans le launcher ('+root+')');process.exit(1);}
async function go(p){
  const m=await publish(dataDir,{id:slug(p.name),name:p.name,description:p.description,mc:p.mc,loader:p.loader,loaderVersion:p.loaderVersion,modsDir:path.join(p.dir,'game','mods')});
  console.log(`Publié : « ${m.name} » (version ${m.version}, ${m.files.length} mods). Les joueurs peuvent le télécharger.`);
}
const arg=process.argv.slice(2).join(' ').trim();
if(arg){const p=packs.find(x=>x.name.toLowerCase()===arg.toLowerCase());if(!p){console.log('Modpack introuvable : '+arg);process.exit(1);}go(p).catch(e=>{console.log('Erreur : '+e.message);process.exit(1);});}
else{packs.forEach((p,i)=>console.log(`${i+1}. ${p.name}  (${p.loader} ${p.mc}, ${(p.mods||[]).length} mods)`));
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  rl.question('Numéro du modpack à publier : ',a=>{rl.close();const p=packs[+a-1];if(!p){console.log('Choix invalide');process.exit(1);}go(p).catch(e=>{console.log('Erreur : '+e.message);process.exit(1);});});}
