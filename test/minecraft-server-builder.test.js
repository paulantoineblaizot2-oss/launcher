const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const AdmZip=require('adm-zip');
const fs=require('fs'),path=require('path');
const builder=require('../minecraft-server-builder');
const {createManagedMinecraftServers}=require('../managed-minecraft-servers');

test('création vanilla : archive ZIP valide, paramètres et empreinte du serveur',async()=>{
  const previousFetch=global.fetch;
  const jar=Buffer.from('fake-minecraft-server-jar');
  const sha1=crypto.createHash('sha1').update(jar).digest('hex');
  global.fetch=async input=>{
    const url=String(input);
    if(url.includes('version_manifest_v2.json'))return new Response(JSON.stringify({latest:{release:'1.21.1'},versions:[{id:'1.21.1',type:'release',url:'https://piston-meta.mojang.com/version.json'}]}),{status:200,headers:{'content-type':'application/json'}});
    if(url==='https://piston-meta.mojang.com/version.json')return new Response(JSON.stringify({downloads:{server:{url:'https://piston-data.mojang.com/server.jar',sha1}}}),{status:200});
    if(url==='https://piston-data.mojang.com/server.jar')return new Response(jar,{status:200});
    throw Error('URL de test inattendue : '+url);
  };
  try{
    const result=await builder.create({name:'Test Harbor',minecraftVersion:'1.21.1',loader:'vanilla',memoryGb:4,port:25565,maxPlayers:6,motd:'Serveur test',acceptEula:true});
    const zip=new AdmZip(result.buffer);
    assert.deepEqual(zip.getEntry('minecraft_server.jar').getData(),jar);
    assert.match(zip.getEntry('server.properties').getData().toString(),/server-port=25565/);
    assert.match(zip.getEntry('start.bat').getData().toString(),/-Xmx4G/);
    assert.equal(zip.getEntry('eula.txt').getData().toString().includes('eula=true'),true);
    assert.ok(result.files.some(file=>file.name==='minecraft_server.jar'));
  }finally{global.fetch=previousFetch;}
});

test('création refusée sans acceptation du contrat EULA',async()=>{
  const previousFetch=global.fetch;
  global.fetch=async()=>new Response(JSON.stringify({latest:{release:'1.21.1'},versions:[{id:'1.21.1',type:'release',url:'https://piston-meta.mojang.com/version.json'}]}),{status:200});
  try{await assert.rejects(builder.create({name:'Test',minecraftVersion:'1.21.1',loader:'vanilla',memoryGb:4,port:25565,maxPlayers:6,acceptEula:false}),/EULA/);}finally{global.fetch=previousFetch;}
});

test('gestionnaire : crée les fichiers dans son espace isolé',async()=>{
  const previousFetch=global.fetch,jar=Buffer.from('managed-test-jar'),sha1=crypto.createHash('sha1').update(jar).digest('hex'),dataDir=path.join(__dirname,'.minecraft-test-data');
  global.fetch=async input=>{const url=String(input);if(url.includes('version_manifest_v2.json'))return new Response(JSON.stringify({latest:{release:'1.21.1'},versions:[{id:'1.21.1',type:'release',url:'https://piston-meta.mojang.com/version.json'}]}),{status:200});if(url.endsWith('/version.json'))return new Response(JSON.stringify({downloads:{server:{url:'https://piston-data.mojang.com/server.jar',sha1}}}),{status:200});if(url.endsWith('/server.jar'))return new Response(jar,{status:200});throw Error('URL de test inattendue : '+url);};
  try{const manager=createManagedMinecraftServers(dataDir);const server=await manager.create({name:'Serveur Test',minecraftVersion:'1.21.1',loader:'vanilla',memoryGb:4,port:25565,maxPlayers:6,motd:'Test',acceptEula:true});assert.equal(server.status,'stopped');assert.equal(fs.readFileSync(path.join(dataDir,'minecraft-servers',server.id,'minecraft_server.jar'),'utf8'),jar.toString());assert.equal(manager.list()[0].name,'Serveur Test');await manager.remove(server.id);assert.equal(manager.list().length,0);}finally{global.fetch=previousFetch;fs.rmSync(dataDir,{recursive:true,force:true});}
});

test('création Forge : utilise une version du catalogue officiel compatible',async()=>{
  const previousFetch=global.fetch,installer=Buffer.from('forge-installer-test');
  global.fetch=async input=>{const url=String(input);if(url.includes('version_manifest_v2.json'))return new Response(JSON.stringify({latest:{release:'1.21.1'},versions:[{id:'1.21.1',type:'release',url:'https://piston-meta.mojang.com/version.json'}]}),{status:200});if(url.includes('maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'))return new Response('<metadata><versioning><versions><version>1.21.1-52.0.2</version></versions></versioning></metadata>',{status:200});if(url.endsWith('forge-1.21.1-52.0.2-installer.jar'))return new Response(installer,{status:200});throw Error('URL de test inattendue : '+url);};
  try{const result=await builder.create({name:'Forge Test',minecraftVersion:'1.21.1',loader:'forge',forgeVersion:'1.21.1-52.0.2',memoryGb:4,port:25566,maxPlayers:6,acceptEula:true});const zip=new AdmZip(result.buffer);assert.deepEqual(zip.getEntry('forge-installer.jar').getData(),installer);assert.match(zip.getEntry('installer.bat').getData().toString(),/forge-installer\.jar/);}finally{global.fetch=previousFetch;}
});
