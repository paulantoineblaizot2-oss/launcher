// Génération et lecture des formats Open XML essentiels, sans service externe.
const zlib = require('zlib');

const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const unesc = value => String(value ?? '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(?:39|x27);/gi,"'").replace(/&nbsp;|&#(?:160|xA0);/gi,'\u00a0').replace(/&amp;/g,'&');
const xmlText = xml => unesc(String(xml).replace(/<[^>]*>/g,'').replace(/\s+xml:space="preserve"/g,''));
const crcTable=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}return table;})();
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer)crc=crcTable[(crc^byte)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function zipFile(files){
  const local=[],central=[];let offset=0;const stamp=new Date(),dosTime=(stamp.getHours()<<11)|(stamp.getMinutes()<<5)|(stamp.getSeconds()>>1),dosDate=((Math.max(1980,stamp.getFullYear())-1980)<<9)|((stamp.getMonth()+1)<<5)|stamp.getDate();
  for(const [name,text]of Object.entries(files)){const nameBytes=Buffer.from(name,'utf8'),data=Buffer.from(text,'utf8');if(data.length>0xffffffff||offset>0xffffffff)throw new Error('Le document est trop volumineux pour le format Office.');const crc=crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);header.writeUInt16LE(0,8);header.writeUInt16LE(dosTime,10);header.writeUInt16LE(dosDate,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(nameBytes.length,26);header.writeUInt16LE(0,28);local.push(header,nameBytes,data);
    const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(0x0800,8);cd.writeUInt16LE(0,10);cd.writeUInt16LE(dosTime,12);cd.writeUInt16LE(dosDate,14);cd.writeUInt32LE(crc,16);cd.writeUInt32LE(data.length,20);cd.writeUInt32LE(data.length,24);cd.writeUInt16LE(nameBytes.length,28);cd.writeUInt16LE(0,30);cd.writeUInt16LE(0,32);cd.writeUInt16LE(0,34);cd.writeUInt16LE(0,36);cd.writeUInt32LE(0,38);cd.writeUInt32LE(offset,42);central.push(cd,nameBytes);offset+=header.length+nameBytes.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20);return Buffer.concat([...local,directory,end]);
}

function htmlAttrs(source) {
  const attrs={};for(const m of String(source||'').matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[m[1].toLowerCase()]=unesc(m[2]??m[3]??m[4]??'');return attrs;
}
function htmlColor(value) {
  const input=String(value||'').trim();let m;if((m=/^#([\da-f]{3}|[\da-f]{6})$/i.exec(input)))return m[1].length===3?[...m[1]].map(x=>x+x).join('').toUpperCase():m[1].toUpperCase();
  if((m=/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i.exec(input))){const rgb=m.slice(1,4).map(Number);if(rgb.every(n=>n<=255))return rgb.map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();}return'';
}
function paragraphProperties(tag, attrs, lists) {
  const props={};if(['b','strong'].includes(tag))props.bold=true;if(['i','em'].includes(tag))props.italic=true;if(tag==='u')props.underline=true;if(['s','strike','del'].includes(tag))props.strike=true;
  if(tag==='font'){if(attrs.color)props.color=htmlColor(attrs.color);if(attrs.face)props.font=attrs.face.replace(/["<>]/g,'').slice(0,80);if(attrs.size&&/^[1-7]$/.test(attrs.size))props.size=[16,18,20,24,28,36,48][Number(attrs.size)-1];}
  if(tag==='span'&&attrs.style){for(const declaration of attrs.style.split(';')){const [rawKey,...rawValue]=declaration.split(':');const key=rawKey.trim().toLowerCase(),value=rawValue.join(':').trim();if(key==='color')props.color=htmlColor(value);if(key==='background-color')props.highlight=htmlColor(value);if(key==='font-family')props.font=value.split(',')[0].replace(/["']/g,'').trim().slice(0,80);if(key==='font-size'){const px=/^(\d+(?:\.\d+)?)px$/i.exec(value),pt=/^(\d+(?:\.\d+)?)pt$/i.exec(value);if(px)props.size=Math.max(12,Math.min(288,Math.round(Number(px[1])*1.5)));else if(pt)props.size=Math.max(12,Math.min(288,Math.round(Number(pt[1])*2)));}}}
  if(tag==='li')props.list=lists.at(-1)==='ol'?'ordered':'bullet';return props;
}
function documentParagraphs(html) {
  const paragraphs=[];let current={runs:[],style:'Normal',list:''},active=[],lists=[];
  const pushText=text=>{if(!text)return;const props=Object.assign({},...active.map(item=>item.props));const prior=current.runs.at(-1);if(prior&&!prior.break&&JSON.stringify(prior.props)===JSON.stringify(props))prior.text+=text;else current.runs.push({text,props});};
  const flush=()=>{if(current.runs.length||!paragraphs.length)paragraphs.push(current);current={runs:[],style:'Normal',list:''};};
  const blockStyle=tag=>/^h[1-3]$/.test(tag)?`Heading${tag[1]}`:tag==='li'?'ListParagraph':'Normal';
  const token=/<(\/)?([a-z][\w-]*)\b([^>]*)>|([^<]+)|<[^>]*>/gi;let match;
  while((match=token.exec(String(html||'')))){
    if(match[4]){pushText(unesc(match[4]));continue;}
    const closing=Boolean(match[1]),tag=match[2].toLowerCase(),attrs=htmlAttrs(match[3]);
    if(tag==='ul'||tag==='ol'){if(closing)lists.pop();else lists.push(tag);continue;}
    if(['p','div','li','h1','h2','h3'].includes(tag)){if(closing){flush();continue;}if(current.runs.length)flush();current.style=blockStyle(tag);if(tag==='li')current.list=lists.at(-1)==='ol'?'ordered':'bullet';continue;}
    if(tag==='br'&&!closing){current.runs.push({text:'',props:{},break:true});continue;}
    if(['b','strong','i','em','u','s','strike','del','span','font'].includes(tag)){if(closing){const index=active.findLastIndex(item=>item.tag===tag);if(index>=0)active.splice(index,1);}else if(!/\/$/.test(match[3].trim()))active.push({tag,props:paragraphProperties(tag,attrs,lists)});}
  }
  if(current.runs.length||!paragraphs.length)flush();return paragraphs;
}
function docxRun(run) {
  const props=run.props||{},rpr=[];if(props.bold)rpr.push('<w:b/>');if(props.italic)rpr.push('<w:i/>');if(props.underline)rpr.push('<w:u w:val="single"/>');if(props.strike)rpr.push('<w:strike/>');if(props.color)rpr.push(`<w:color w:val="${props.color}"/>`);if(props.highlight)rpr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${props.highlight}"/>`);if(props.font)rpr.push(`<w:rFonts w:ascii="${esc(props.font)}" w:hAnsi="${esc(props.font)}"/>`);if(props.size)rpr.push(`<w:sz w:val="${props.size}"/>`);
  const body=run.break?'<w:br/>':`<w:t xml:space="preserve">${esc(run.text)}</w:t>`;return`<w:r>${rpr.length?`<w:rPr>${rpr.join('')}</w:rPr>`:''}${body}</w:r>`;
}

function makeDocx(doc) {
  const numbering={bullet:0,ordered:0};
  const paragraphs = documentParagraphs(doc.content.html).map(p => {const prefix=p.list?(p.list==='ordered'?`${++numbering.ordered}. `:'• '):'';if(!p.list)numbering.ordered=0;const runs=[...(prefix?[{text:prefix,props:{}}]:[]),...p.runs].map(docxRun).join('')||'<w:r><w:t xml:space="preserve"> </w:t></w:r>';return`<w:p><w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>${runs}</w:p>`;}).join('');
  return zipFile({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>'
  }, `${String(doc.title || 'document')}.docx`);
}

function slideXml(slide, index) {
  const body = String(slide.body || '').split(/\r?\n/).filter(Boolean).map(line => `<a:p><a:r><a:rPr lang="fr-FR" sz="2200"/><a:t>${esc(line)}</a:t></a:r><a:endParaRPr lang="fr-FR"/></a:p>`).join('') || '<a:p><a:endParaRPr lang="fr-FR"/></a:p>';
  const titleGeometry='<a:xfrm><a:off x="960000" y="950000"/><a:ext cx="10272000" cy="1200000"/></a:xfrm>',bodyGeometry='<a:xfrm><a:off x="1000000" y="2550000"/><a:ext cx="10200000" cy="3500000"/></a:xfrm>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="${esc(slide.title || `Diapositive ${index+1}`)}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Titre ${index+1}"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${titleGeometry}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="fr-FR" sz="3800" b="1"/><a:t>${esc(slide.title || '')}</a:t></a:r><a:endParaRPr lang="fr-FR"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Texte ${index+1}"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${bodyGeometry}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function makePptx(doc) {
  const slides = (doc.content.slides || []).slice(0, 100); if (!slides.length) slides.push({ title: '', body: '' });
  const slideOverrides = slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  const slideIds = slides.map((_,i)=>`<p:sldId id="${256+i}" r:id="rId${i+2}"/>`).join('');
  const presentationRels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_,i)=>`<Relationship Id="rId${i+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i+1}.xml"/>`).join('')}`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presentationRels}</Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>',
    'ppt/slideLayouts/slideLayout1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    'ppt/theme/theme1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="MAVIE Office"><a:themeElements><a:clrScheme name="MAVIE"><a:dk1><a:srgbClr val="142034"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="101A2B"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="E9BE60"/></a:accent1><a:accent2><a:srgbClr val="43C4A5"/></a:accent2><a:accent3><a:srgbClr val="5599EF"/></a:accent3><a:accent4><a:srgbClr val="C87850"/></a:accent4><a:accent5><a:srgbClr val="8F72D9"/></a:accent5><a:accent6><a:srgbClr val="777777"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="MAVIE"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="MAVIE"><a:fillStyleLst><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:solidFill><a:schemeClr val="lt2"/></a:solidFill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
  };
  slides.forEach((slide,i)=>{files[`ppt/slides/slide${i+1}.xml`]=slideXml(slide,i);files[`ppt/slides/_rels/slide${i+1}.xml.rels`]='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';});
  return zipFile(files, `${String(doc.title||'présentation')}.pptx`);
}

function columnName(index) { let name=''; for(index++;index;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name; return name; }
function safeFormula(value) {
  let formula=String(value).slice(1).toUpperCase(),valid=true;
  formula=formula.replace(/(SUM|AVERAGE|MIN|MAX)\(([^()]*)\)/g,(_,fn,args)=>{for(const part of args.split(/[;,]/).map(s=>s.trim()))if(!/^(?:[A-Z]{1,3}\d+)(?::[A-Z]{1,3}\d+)?$/.test(part)&&!/^\d+(?:\.\d+)?$/.test(part))valid=false;return '0';});
  formula=formula.replace(/\b[A-Z]{1,3}\d+\b/g,'0');return valid&&/^[\d.+\-*/():,;\s]*$/.test(formula);
}
function makeXlsx(doc) {
  const cells=doc.content.cells||{}, refs=Object.keys(cells).map(ref=>/^([A-Z]+)(\d+)$/i.exec(ref)).filter(Boolean);
  let maxRow=1,maxCol=1; for(const m of refs){maxRow=Math.max(maxRow,Number(m[2]));let col=0;for(const c of m[1].toUpperCase())col=col*26+c.charCodeAt(0)-64;maxCol=Math.max(maxCol,col);}
  maxRow=Math.min(maxRow,200);maxCol=Math.min(maxCol,40);
  const rows=[];for(let r=1;r<=maxRow;r++){const items=[];for(let c=1;c<=maxCol;c++){const ref=`${columnName(c-1)}${r}`,raw=String(cells[ref]??'');if(!raw)continue;
      if(raw.startsWith('=')&&safeFormula(raw)){items.push(`<c r="${ref}"><f>${esc(raw.slice(1))}</f><v></v></c>`);}else if(/^-?\d+(?:\.\d+)?$/.test(raw)){items.push(`<c r="${ref}"><v>${raw}</v></c>`);}else{items.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(raw)}</t></is></c>`);}}
    if(items.length)rows.push(`<row r="${r}">${items.join('')}</row>`);}
  return zipFile({
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuille 1" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>',
    'xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
  },`${String(doc.title||'tableur')}.xlsx`);
}

function exportOffice(doc, format) {
  if (!doc || !doc.content || !['document','presentation','spreadsheet'].includes(doc.type)) throw new Error('Document invalide.');
  if (format==='docx'&&doc.type==='document') return { buffer:makeDocx(doc), filename:doc.title+'.docx', contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  if (format==='pptx'&&doc.type==='presentation') return { buffer:makePptx(doc), filename:doc.title+'.pptx', contentType:'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  if (format==='xlsx'&&doc.type==='spreadsheet') return { buffer:makeXlsx(doc), filename:doc.title+'.xlsx', contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  throw new Error('Ce format ne correspond pas à ce type de document.');
}

function loadZip(buffer) {
  if (!Buffer.isBuffer(buffer)||buffer.length<4||buffer.readUInt32LE(0)!==0x04034b50) throw new Error('Le fichier Office est invalide ou endommagé.');
  const min=Math.max(0,buffer.length-65557);let end=-1;for(let i=buffer.length-22;i>=min;i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}if(end<0)throw new Error('L’archive Office est incomplète.');
  const count=buffer.readUInt16LE(end+10),directoryOffset=buffer.readUInt32LE(end+16);if(count>3000||directoryOffset>=buffer.length)throw new Error('Cette archive Office est invalide.');
  const files=new Map();let cursor=directoryOffset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>buffer.length||buffer.readUInt32LE(cursor)!==0x02014b50)throw new Error('L’archive Office est invalide.');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),crc=buffer.readUInt32LE(cursor+16),packed=buffer.readUInt32LE(cursor+20),size=buffer.readUInt32LE(cursor+24),nameLength=buffer.readUInt16LE(cursor+28),extraLength=buffer.readUInt16LE(cursor+30),commentLength=buffer.readUInt16LE(cursor+32),localOffset=buffer.readUInt32LE(cursor+42),name=buffer.subarray(cursor+46,cursor+46+nameLength).toString(flags&0x0800?'utf8':'latin1');
    cursor+=46+nameLength+extraLength+commentLength;if(flags&1)throw new Error('Les fichiers Office protégés par mot de passe ne sont pas pris en charge.');if(!['0','8'].includes(String(method)))throw new Error('Méthode de compression Office non prise en charge.');
    total+=size;if(size>40*1024*1024||total>40*1024*1024)throw new Error('Le document décompressé dépasse 40 Mo.');
    if(localOffset+30>buffer.length||buffer.readUInt32LE(localOffset)!==0x04034b50)throw new Error('Un fichier interne de l’archive est invalide.');const localName=buffer.readUInt16LE(localOffset+26),localExtra=buffer.readUInt16LE(localOffset+28),dataOffset=localOffset+30+localName+localExtra;if(dataOffset+packed>buffer.length)throw new Error('Les données de l’archive sont tronquées.');const compressed=buffer.subarray(dataOffset,dataOffset+packed);let data;
    try{data=method===0?Buffer.from(compressed):zlib.inflateRawSync(compressed,{maxOutputLength:40*1024*1024});}catch{throw new Error('Impossible de décompresser un fichier Office.');}
    if(data.length!==size||crc32(data)!==crc)throw new Error('Un fichier interne de l’archive est endommagé.');files.set(name,data.toString('utf8'));
  }
  return files;
}
function entryText(zip,name) { return zip.get(name)||null; }
function importDocx(zip, title) {
  const xml=entryText(zip,'word/document.xml');if(!xml)throw new Error('Ce fichier ne contient pas de document Word.');
  const blocks=[];for(const p of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)){const body=p[1],runs=[];for(const run of body.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)){const contents=run[1],texts=[...contents.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m=>xmlText(m[1])).join('');let html=esc(texts).replace(/\t/g,'&nbsp;&nbsp;&nbsp;&nbsp;');if(!html&&/<w:br\b/.test(contents))html='<br>';if(!html)continue;const rpr=/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i.exec(contents)?.[1]||'';if(/<w:b(?:\s|\/|>)/i.test(rpr))html=`<strong>${html}</strong>`;if(/<w:i(?:\s|\/|>)/i.test(rpr))html=`<em>${html}</em>`;if(/<w:u\b(?![^>]*w:val="none")/i.test(rpr))html=`<u>${html}</u>`;if(/<w:strike(?:\s|\/|>)/i.test(rpr))html=`<s>${html}</s>`;const color=/\bw:color\b[^>]*\bw:val="([0-9a-f]{6})"/i.exec(rpr)?.[1];const fill=/\bw:shd\b[^>]*\bw:fill="([0-9a-f]{6})"/i.exec(rpr)?.[1];const font=/\bw:rFonts\b[^>]*\bw:ascii="([^"]{1,80})"/i.exec(rpr)?.[1];const size=Number(/<w:sz\b[^>]*\bw:val="(\d{1,3})"/i.exec(rpr)?.[1]||0);const styles=[];if(color)styles.push(`color:#${color}`);if(fill)styles.push(`background-color:#${fill}`);if(font)styles.push(`font-family:${unesc(font).replace(/[;<>]/g,'')}`);if(size)styles.push(`font-size:${Math.round(size*2/3)}px`);if(styles.length)html=`<span style="${esc(styles.join(';'))}">${html}</span>`;runs.push(html);}if(!runs.length)continue;const style=/<w:pStyle\b[^>]*w:val="Heading([1-3])"/i.exec(body),tag=style?`h${style[1]}`:'p';blocks.push(`<${tag}>${runs.join('')}</${tag}>`);}
  return {type:'document',title,content:{html:blocks.join('')||'<p>Document importé</p>'}};
}
function importPptx(zip,title) {
  const files=[...zip.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));
  if(!files.length)throw new Error('Aucune diapositive trouvée dans ce fichier.');
  const slides=files.slice(0,100).map(file=>{const xml=entryText(zip,file);const shapeTexts=[...xml.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g)].map(shape=>[...shape[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(m=>xmlText(m[1])).join('\n')).filter(Boolean);return {title:shapeTexts[0]||'',body:shapeTexts.slice(1).join('\n')};});
  return {type:'presentation',title,content:{slides}};
}
function importXlsx(zip,title) {
  const workbook=entryText(zip,'xl/workbook.xml');if(!workbook)throw new Error('Ce fichier ne contient pas un classeur Excel.');
  const stringsXml=entryText(zip,'xl/sharedStrings.xml')||'',strings=[...stringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(si=>[...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m=>xmlText(m[1])).join(''));
  const rels=entryText(zip,'xl/_rels/workbook.xml.rels')||'';const relId=/<sheet\b[^>]*r:id="([^"]+)"/i.exec(workbook)?.[1]||'rId1';const target=[...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g)].find(r=>r[1]===relId)?.[2]||'worksheets/sheet1.xml';const sheetName=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`;const xml=entryText(zip,sheetName);if(!xml)throw new Error('La première feuille Excel est introuvable.');
  const cells={};for(const m of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){const ref=/\br="([A-Z]+\d+)"/i.exec(m[1])?.[1]?.toUpperCase();if(!ref)continue;const formula=/<f\b[^>]*>([\s\S]*?)<\/f>/.exec(m[2])?.[1];const value=/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(m[2])?.[1];const inline=[...m[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t=>xmlText(t[1])).join('');if(formula)cells[ref]='='+xmlText(formula);else if(/\bt="s"/.test(m[1])&&value)cells[ref]=strings[Number(value)]||'';else if(/\bt="inlineStr"/.test(m[1]))cells[ref]=inline;else if(value!==undefined)cells[ref]=xmlText(value);}
  return {type:'spreadsheet',title,content:{cells}};
}
function importOffice(buffer, format, title) {
  const zip=loadZip(buffer),safeTitle=String(title||'Document importé').slice(0,120);
  if(format==='docx')return importDocx(zip,safeTitle);if(format==='pptx')return importPptx(zip,safeTitle);if(format==='xlsx')return importXlsx(zip,safeTitle);
  throw new Error('Format Office non pris en charge.');
}
module.exports={exportOffice,importOffice};

