const fs=require('fs'),zlib=require('zlib');

function readUpdateZip(file,{maxCompressed=1024*1024*1024,maxExpanded=2*1024*1024*1024,maxEntries=80}={}){
  const zip=fs.readFileSync(file);if(zip.length>maxCompressed)throw new Error('Le paquet de mise à jour dépasse la limite autorisée.');
  const floor=Math.max(0,zip.length-65557);let eocd=-1;
  for(let i=zip.length-22;i>=floor;i--)if(zip.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw new Error('Archive ZIP de mise à jour invalide.');
  const count=zip.readUInt16LE(eocd+10),directorySize=zip.readUInt32LE(eocd+12),directoryOffset=zip.readUInt32LE(eocd+16);
  if(count<1||count>maxEntries||directoryOffset+directorySize>eocd||count===0xffff||directoryOffset===0xffffffff)throw new Error('Index ZIP invalide ou trop volumineux.');
  const entries=new Map();let cursor=directoryOffset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>zip.length||zip.readUInt32LE(cursor)!==0x02014b50)throw new Error('Entrée ZIP invalide.');
    const flags=zip.readUInt16LE(cursor+8),method=zip.readUInt16LE(cursor+10),compressed=zip.readUInt32LE(cursor+20),expanded=zip.readUInt32LE(cursor+24);
    const nameLen=zip.readUInt16LE(cursor+28),extraLen=zip.readUInt16LE(cursor+30),commentLen=zip.readUInt16LE(cursor+32),localOffset=zip.readUInt32LE(cursor+42);
    if((flags&1)!==0||![0,8].includes(method)||compressed===0xffffffff||expanded===0xffffffff||expanded>maxExpanded||cursor+46+nameLen+extraLen+commentLen>zip.length)throw new Error('ZIP chiffré ou utilisant une compression non prise en charge.');
    const nameBytes=zip.subarray(cursor+46,cursor+46+nameLen),name=nameBytes.toString((flags&0x800)!==0?'utf8':'latin1');
    if(!name||name==='.'||name==='..'||/[\\/\0]/.test(name)||name!==name.normalize('NFC')||entries.has(name))throw new Error('Le paquet contient un nom de fichier invalide ou en double.');
    if(localOffset+30>zip.length||zip.readUInt32LE(localOffset)!==0x04034b50)throw new Error('En-tête de fichier ZIP invalide.');
    const localNameLen=zip.readUInt16LE(localOffset+26),localExtraLen=zip.readUInt16LE(localOffset+28),dataOffset=localOffset+30+localNameLen+localExtraLen;
    if(dataOffset+compressed>zip.length)throw new Error('Données ZIP tronquées.');
    const comp=zip.subarray(dataOffset,dataOffset+compressed),data=method===0?Buffer.from(comp):zlib.inflateRawSync(comp,{maxOutputLength:Math.max(1,expanded)});
    if(data.length!==expanded)throw new Error('Taille décompressée incohérente dans le paquet.');
    total+=data.length;if(total>maxExpanded)throw new Error('Le contenu décompressé du paquet dépasse la limite autorisée.');
    entries.set(name,data);cursor+=46+nameLen+extraLen+commentLen;
  }
  return entries;
}

module.exports={readUpdateZip};
