
const crypto = require('crypto');
const zlib = require('zlib');
const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const NEOFORGE_METADATA = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const FORGE_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const MAX_SERVER_JAR = 160 * 1024 * 1024;
const MAX_INSTALLER = 80 * 1024 * 1024;
let manifestCache = null, manifestAt = 0, neoCache = null, neoAt = 0, forgeCache = null, forgeAt = 0;

const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function makeZip() {
  const entries = [];
  return {
    addFile(name, value) { const data = Buffer.isBuffer(value) ? value : Buffer.from(value); const stored = /\.jar$/i.test(name); entries.push({ name: Buffer.from(name, 'utf8'), data, packed: stored ? data : zlib.deflateRawSync(data, { level: 6 }), method: stored ? 0 : 8, crc: crc32(data) }); },
    getFiles() { return entries.map(entry => ({ name: entry.name.toString('utf8'), data: entry.data })); },
    toBuffer() {
      const local = [], central = []; let offset = 0; const stamp = new Date(); const dosTime = (stamp.getHours() << 11) | (stamp.getMinutes() << 5) | (stamp.getSeconds() >> 1); const dosDate = ((stamp.getFullYear() - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate();
      for (const entry of entries) {
        const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6); header.writeUInt16LE(entry.method, 8); header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12); header.writeUInt32LE(entry.crc, 14); header.writeUInt32LE(entry.packed.length, 18); header.writeUInt32LE(entry.data.length, 22); header.writeUInt16LE(entry.name.length, 26); header.writeUInt16LE(0, 28); local.push(header, entry.name, entry.packed);
        const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0, 8); record.writeUInt16LE(entry.method, 10); record.writeUInt16LE(dosTime, 12); record.writeUInt16LE(dosDate, 14); record.writeUInt32LE(entry.crc, 16); record.writeUInt32LE(entry.packed.length, 20); record.writeUInt32LE(entry.data.length, 24); record.writeUInt16LE(entry.name.length, 28); record.writeUInt16LE(0, 30); record.writeUInt16LE(0, 32); record.writeUInt16LE(0, 34); record.writeUInt16LE(0, 36); record.writeUInt32LE(0, 38); record.writeUInt32LE(offset, 42); central.push(record, entry.name); offset += header.length + entry.name.length + entry.packed.length;
      }
      const centralData = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20); return Buffer.concat([...local, centralData, end]);
    }
  };
}

async function fetchBuffer(url, limit) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['piston-meta.mojang.com','piston-data.mojang.com','launcher.mojang.com','maven.neoforged.net','maven.minecraftforge.net'].includes(parsed.hostname)) throw new Error('Source de téléchargement non autorisée.');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'SuiteHorizon-ServerBuilder/1.0' } });
  if (!response.ok) throw new Error('Le téléchargement officiel a échoué (' + response.status + ').');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > limit) throw new Error('Le fichier distant dépasse la limite prévue.');
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > limit) throw new Error('Le fichier téléchargé est vide ou trop volumineux.');
  return data;
}
async function getManifest() {
  if (manifestCache && Date.now() - manifestAt < 30 * 60 * 1000) return manifestCache;
  const response = await fetch(MOJANG_MANIFEST, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'SuiteHorizon-ServerBuilder/1.0' } });
  if (!response.ok) throw new Error('Impossible de joindre le catalogue officiel Minecraft.');
  manifestCache = await response.json(); manifestAt = Date.now(); return manifestCache;
}
async function getNeoVersions() {
  if (neoCache && Date.now() - neoAt < 60 * 60 * 1000) return neoCache;
  const response = await fetch(NEOFORGE_METADATA, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'SuiteHorizon-ServerBuilder/1.0' } });
  if (!response.ok) throw new Error('Impossible de joindre le catalogue officiel NeoForge.');
  const xml = await response.text();
  neoCache = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1]).filter(version => /^\d+\.\d+\.\d+$/.test(version));
  neoAt = Date.now(); return neoCache;
}
async function getForgeVersions() {
  if (forgeCache && Date.now() - forgeAt < 60 * 60 * 1000) return forgeCache;
  const response = await fetch(FORGE_METADATA, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'SuiteHorizon-ServerBuilder/1.0' } });
  if (!response.ok) throw new Error('Impossible de joindre le catalogue officiel Forge.');
  const xml = await response.text();
  forgeCache = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1]).filter(version => /^1\.\d+(?:\.\d+)?-\d+(?:\.\d+)?(?:\.\d+)?$/.test(version));
  forgeAt = Date.now(); return forgeCache;
}
function slug(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,36) || 'mon-serveur';
}
function properties(options) {
  const motd = String(options.motd || options.name).replace(/[\r\n\\=:]/g,' ').slice(0,60) || 'Mon serveur Minecraft';
  return ['# Serveur créé avec MAVIE7620 · Suite Horizon','motd=' + motd,'server-port=' + options.port,'max-players=' + options.maxPlayers,'online-mode=true','white-list=false','enforce-whitelist=false','view-distance=8','simulation-distance=6','difficulty=normal','gamemode=survival','pvp=true','spawn-protection=0','enable-command-block=false','server-ip=',''].join('\n');
}
function readme(options) {
  const lines = [
    'SERVEUR MINECRAFT — ' + options.name,
    '',
    'Version Minecraft : ' + options.minecraftVersion,
    'Logiciel : ' + (options.loader === 'neoforge' ? 'NeoForge ' + options.neoForgeVersion : options.loader === 'forge' ? 'Forge ' + options.forgeVersion : 'Vanilla'),
    'Port : ' + options.port,
    'Mémoire maximale : ' + options.memoryGb + ' Go',
    '',
    'DÉMARRAGE',
    '1. Décompresse tout le ZIP dans un nouveau dossier sur le PC qui hébergera le serveur.',
    '2. Vérifie que Java compatible est installé. Minecraft 1.20.5 et plus récent demande Java 21.',
    options.loader === 'neoforge' || options.loader === 'forge'
      ? '3. Lance installer.bat (Internet requis pour télécharger les bibliothèques), puis start.bat. start.bat lance l’installation si nécessaire.'
      : '3. Lance start.bat sous Windows ou start.sh sous Linux/macOS.',
    '',
    'eula.txt est sur true parce que tu as confirmé accepter le contrat Minecraft EULA. Si tu ne l’acceptes pas, ne démarre pas ce serveur et remets eula=false.',
    '',
    'Pour les accès publics, configure séparément le pare-feu et la redirection du routeur.',
    'Cet outil prépare les fichiers ; il ne démarre pas le serveur et ne modifie pas ton réseau.'
  ];
  return lines.join('\n') + '\n';
}
function scripts(options) {
  const memory = options.memoryGb;
  if (options.loader === 'vanilla') return {
    'start.bat': '@echo off\r\ncd /d "%~dp0"\r\njava -Xms1G -Xmx' + memory + 'G -jar minecraft_server.jar nogui\r\nif errorlevel 1 pause\r\n',
    'start.sh': '#!/bin/sh\ncd "$(dirname "$0")"\nexec java -Xms1G -Xmx' + memory + 'G -jar minecraft_server.jar nogui\n'
  };
  const installerName = options.loader === 'forge' ? 'forge-installer.jar' : 'neoforge-installer.jar';
  return {
    'user_jvm_args.txt': '-Xms1G\n-Xmx' + memory + 'G\n',
    'installer.bat': '@echo off\r\ncd /d "%~dp0"\r\njava -jar ' + installerName + ' --installServer\r\nif errorlevel 1 pause\r\n',
    'installer.sh': '#!/bin/sh\ncd "$(dirname "$0")"\nexec java -jar ' + installerName + ' --installServer\n',
    'start.bat': '@echo off\r\ncd /d "%~dp0"\r\nif not exist run.bat (\r\n  echo Installation initiale du chargeur...\r\n  java -jar ' + installerName + ' --installServer\r\n  if errorlevel 1 (echo Installation echouee.&pause&exit /b 1)\r\n)\r\ncall run.bat nogui\r\nif errorlevel 1 pause\r\n',
    'start.sh': '#!/bin/sh\ncd "$(dirname "$0")"\nif [ ! -f run.sh ]; then\n  echo "Installation initiale du chargeur..."\n  java -jar ' + installerName + ' --installServer || exit $?\nfi\nexec ./run.sh nogui\n'
  };
}
async function create(options = {}) {
  const name = String(options.name || '').trim();
  if (name.length < 2 || name.length > 48 || /[\x00-\x1f]/.test(name)) throw new Error('Le nom du serveur doit contenir de 2 à 48 caractères.');
  const minecraftVersion = String(options.minecraftVersion || '');
  const manifest = await getManifest();
  const release = manifest.versions.find(item => item.id === minecraftVersion && item.type === 'release');
  if (!release) throw new Error('Choisis une version officielle stable de Minecraft.');
  const loader = ['vanilla','neoforge','forge'].includes(options.loader) ? options.loader : '';
  if (!loader) throw new Error('Choisis Vanilla, Forge ou NeoForge.');
  const memoryGb = Number(options.memoryGb), port = Number(options.port), maxPlayers = Number(options.maxPlayers);
  if (!Number.isInteger(memoryGb) || memoryGb < 2 || memoryGb > 6) throw new Error('La mémoire doit être comprise entre 2 et 6 Go.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Le port doit être compris entre 1024 et 65535.');
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 100) throw new Error('Le nombre de joueurs doit être compris entre 1 et 100.');
  if (options.acceptEula !== true) throw new Error('Confirme d’abord que tu acceptes le contrat Minecraft EULA.');
  const settings = { name, minecraftVersion, loader, memoryGb, port, maxPlayers, motd: String(options.motd || name).slice(0,60) };
  const zip = makeZip();
  zip.addFile('server.properties', Buffer.from(properties(settings), 'utf8'));
  zip.addFile('eula.txt', Buffer.from('# Tu as confirmé accepter le Minecraft EULA lors de la création.\neula=true\n', 'utf8'));
  for (const [file, content] of Object.entries(scripts(settings))) zip.addFile(file, Buffer.from(content, 'utf8'));
  if (loader === 'vanilla') {
    const versionResponse = await fetch(release.url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'SuiteHorizon-ServerBuilder/1.0' } });
    if (!versionResponse.ok) throw new Error('Les informations de cette version Minecraft sont indisponibles.');
    const versionInfo = await versionResponse.json();
    const server = versionInfo.downloads && versionInfo.downloads.server;
    if (!server || !/^https:\/\/(piston-data\.mojang\.com|launcher\.mojang\.com)\//.test(server.url)) throw new Error('Minecraft ne fournit pas de serveur Vanilla pour cette version.');
    const jar = await fetchBuffer(server.url, MAX_SERVER_JAR);
    if (server.sha1 && crypto.createHash('sha1').update(jar).digest('hex') !== server.sha1.toLowerCase()) throw new Error('La vérification du serveur Minecraft a échoué.');
    zip.addFile('minecraft_server.jar', jar);
  } else if (loader === 'neoforge') {
    const all = await getNeoVersions();
    const family = minecraftVersion.match(/^1\.(\d+)(?:\.(\d+))?$/);
    if (!family) throw new Error('Version Minecraft non prise en charge par NeoForge.');
    const neoFamily = family[1] + '.' + (family[2] || '0') + '.';
    const neoVersion = String(options.neoForgeVersion || '');
    if (!neoVersion.startsWith(neoFamily) || !all.includes(neoVersion)) throw new Error('Choisis une version NeoForge compatible avec Minecraft ' + minecraftVersion + '.');
    settings.neoForgeVersion = neoVersion;
    const installerUrl = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/' + neoVersion + '/neoforge-' + neoVersion + '-installer.jar';
    const installer = await fetchBuffer(installerUrl, MAX_INSTALLER);
    zip.addFile('neoforge-installer.jar', installer);
  } else {
    const all = await getForgeVersions();
    const forgeVersion = String(options.forgeVersion || '');
    if (!forgeVersion.startsWith(minecraftVersion + '-') || !all.includes(forgeVersion)) throw new Error('Choisis une version Forge compatible avec Minecraft ' + minecraftVersion + '.');
    settings.forgeVersion = forgeVersion.slice(minecraftVersion.length + 1);
    const installerUrl = 'https://maven.minecraftforge.net/net/minecraftforge/forge/' + forgeVersion + '/forge-' + forgeVersion + '-installer.jar';
    const installer = await fetchBuffer(installerUrl, MAX_INSTALLER);
    zip.addFile('forge-installer.jar', installer);
  }
  zip.addFile('LISEZ-MOI.txt', Buffer.from(readme(settings), 'utf8'));
  const buffer = zip.toBuffer();
  if (buffer.length > 260 * 1024 * 1024) throw new Error('Le paquet généré dépasse la taille maximale autorisée.');
  return { buffer, files: zip.getFiles(), filename: 'MAVIE-Serveur-' + slug(name) + '-' + minecraftVersion + '.zip', settings };
}
async function versions(minecraftVersion = '') {
  const manifest = await getManifest();
  const releases = manifest.versions.filter(item => item.type === 'release').slice(0, 100).map(item => item.id);
  let neoForgeVersions = [], forgeVersions = [];
  if (minecraftVersion) {
    const match = String(minecraftVersion).match(/^1\.(\d+)(?:\.(\d+))?$/);
    if (match) {
      const prefix = match[1] + '.' + (match[2] || '0') + '.';
      neoForgeVersions = (await getNeoVersions()).filter(version => version.startsWith(prefix)).reverse().slice(0, 50);
    }
    forgeVersions = (await getForgeVersions()).filter(version => version.startsWith(String(minecraftVersion) + '-')).reverse().slice(0, 50);
  }
  return { latest: manifest.latest && manifest.latest.release, releases, neoForgeVersions, forgeVersions };
}
module.exports = { create, versions };
