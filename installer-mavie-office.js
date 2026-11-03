const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const files = [
  'auth.js', 'cloud-store.js', 'lib.js', 'managed-minecraft-servers.js', 'minecraft-server-builder.js', 'office-formats.js', 'office-store.js', 'site-content.js', 'serveur.js', 'publier.js',
  'site/index.html', 'site/site.css', 'site/site.js', 'site/minecraft-servers.js', 'site/portal-app.css', 'site/assets/mavie-avatar.png',
  'site/office/index.html', 'site/office/app.css', 'site/office/sheet-engine.js', 'site/office/app.js',
  'site-serveur.js', 'lancer-serveur.bat', 'lancer-site.bat', 'publier.bat', 'demarrer-services.bat', 'activer-https.bat',
  'site/cloud/index.html', 'site/cloud/app.css', 'site/cloud/app.js'
];
const runtimeFiles = new Set(files.filter(file => file !== 'installer-mavie-office.js' && (file.endsWith('.js') || file.startsWith('site/'))));
function destinationFor(target, file) {
  return path.join(target, runtimeFiles.has(file) ? 'runtime' : '', file);
}
function backupName(file) {
  return path.join(runtimeFiles.has(file) ? 'runtime' : '', file);
}
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--target');
  return index >= 0 ? args[index + 1] : '';
}

function mergeContent(file) {
  const updates = {
    navNation: 'Algérie · site & bots',
    nationCardTitle: 'ALGÉRIE',
    nationCardLongTitle: 'Algérie — site communautaire et bots Discord',
    nationCardDescription: 'Le site communautaire d’Algérie et ses trois bots Discord : Valerius, Osiris et Sirius.',
    nationEyebrow: 'UN PROJET COMMUNAUTAIRE COMPLET',
    nationDescription: 'Algérie réunit un site communautaire et trois bots Discord dans un même projet.',
    nationHeroKicker: 'SITE WEB + 3 BOTS DISCORD',
    nationHeroTitle: 'Un même projet, quatre outils complémentaires.',
    nationHeroDescription: 'Le portail web et ses outils rassemblent les espaces et services de la communauté Algérie.',
    nationSectionTitle: 'Le portail et ses outils',
    nationCard1Title: 'Portail web',
    nationCard2Title: 'Valerius',
    nationCard3Title: 'Osiris',
    nationCard4Title: 'Sirius',
    nationNote: 'Valerius, Osiris et Sirius servent tous le même royaume et sa communauté.',
    contactDescription: 'Pour me contacter, retrouve-moi sur Discord.',
    contactPseudo: 'MAVIE7620',
    contactNote: 'Contacte-moi sur Discord avec le pseudo MAVIE7620.'
  };

  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  saved.copy = { ...(saved.copy && typeof saved.copy === 'object' ? saved.copy : {}), ...updates };
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(saved, null, 2)}\n`, { flag: 'wx' });
  fs.copyFileSync(temporary, file);
  fs.rmSync(temporary, { force: true });
}

async function main() {
  const source = __dirname;
  let target = parseArgs();
  if (!target) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    target = await rl.question('Dossier du serveur (celui qui contient serveur.js) : ');
    rl.close();
  }
  target = path.resolve(target.trim().replace(/^"|"$/g, ''));
  if (!fs.existsSync(path.join(target, 'serveur.js')) || !fs.existsSync(path.join(target, 'lib.js'))) {
    throw new Error('Dossier invalide : serveur.js et lib.js doivent s’y trouver.');
  }
  for (const file of files) {
    if (!fs.existsSync(path.join(source, file))) throw new Error(`Fichier du paquet manquant : ${file}`);
  }

  const configPath = path.join(target, 'config.json');
  let dataDirName = 'data';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (typeof config.dataDir === 'string' && config.dataDir.trim()) dataDirName = config.dataDir;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`config.json illisible : ${error.message}`);
  }
  const dataDir = path.resolve(target, dataDirName);
  const contentPath = path.join(dataDir, 'site', 'content.json');
  const backup = path.join(target, `sauvegarde-office-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  ensureDir(backup);
  const installed = [];
  try {
    for (const file of files) {
      const destination = destinationFor(target, file);
      if (fs.existsSync(destination)) {
        const backupFile = path.join(backup, 'fichiers', backupName(file));
        ensureDir(path.dirname(backupFile));
        fs.copyFileSync(destination, backupFile);
      }
      ensureDir(path.dirname(destination));
      fs.copyFileSync(path.join(source, file), destination);
      installed.push(file);
    }
    let serverConfig={};try{serverConfig=JSON.parse(fs.readFileSync(configPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error(`config.json illisible : ${error.message}`);}
    if(serverConfig.trustProxy!==true){if(fs.existsSync(configPath)){const backupConfig=path.join(backup,'fichiers','config.json');ensureDir(path.dirname(backupConfig));fs.copyFileSync(configPath,backupConfig);}serverConfig.trustProxy=true;const temporary=`${configPath}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(serverConfig,null,2)}\n`,{flag:'wx'});if(fs.existsSync(configPath))fs.copyFileSync(temporary,configPath);else fs.renameSync(temporary,configPath);fs.rmSync(temporary,{force:true});installed.push('config.json');}
    if (fs.existsSync(contentPath)) {
      const backupContent = path.join(backup, 'donnees-site', 'content.json');
      ensureDir(path.dirname(backupContent));
      fs.copyFileSync(contentPath, backupContent);
    }
    mergeContent(contentPath);
  } catch (error) {
    for (const file of installed.reverse()) {
      const old = path.join(backup, 'fichiers', backupName(file));
      const destination = destinationFor(target, file);
      if(file==='config.json'&&!fs.existsSync(old))continue;
      if (fs.existsSync(old)) fs.copyFileSync(old, destination);
      else fs.rmSync(destination, { force: true });
    }
    const oldContent = path.join(backup, 'donnees-site', 'content.json');
    if (fs.existsSync(oldContent)) fs.copyFileSync(oldContent, contentPath);
    throw error;
  }
  console.log(`Mise à jour terminée. Sauvegarde créée ici : ${backup}`);
  console.log('Le code est installe dans runtime/ pour assurer les imports Node sur les lecteurs FAT. Les donnees et config.json restent a la racine.');
  console.log('Relance les deux serveurs Node avec demarrer-services.bat, puis utilise activer-https.bat pour appliquer le routage Caddy. Caddy reste ouvert.');
}

main().catch(error => { console.error(`Échec : ${error.message}`); process.exitCode = 1; });
