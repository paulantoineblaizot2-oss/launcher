(() => {
  const names = {
    home: 'PORTAIL PERSONNEL', nation: 'PROJET / ALGÉRIE',
    harbor: 'PROJET / HARBOR LAUNCHER',
    catalogue: 'UNIVERS / MODPACKS EN LIGNE', about: 'PERSONNEL / À PROPOS',
    contact: 'PERSONNEL / CONTACT', servers: 'ADMINISTRATION / SERVEURS MINECRAFT', account: 'ESPACE MEMBRE / MON COMPTE', admin: 'ADMINISTRATION / CONTENU DU SITE'
  };
  const pageAliases = { bots: 'nation', projets: 'nation', projects: 'nation', 'site-communautaire': 'nation' };
  const pages = [...document.querySelectorAll('.page')];
  const navLinks = [...document.querySelectorAll('.side-link')];
  const breadcrumb = document.querySelector('#breadcrumb');
  const sidebar = document.querySelector('#sidebar');
  const menuButton = document.querySelector('#mobile-menu');
  const scrim = document.querySelector('#sidebar-scrim');
  let siteContent = null;
  let publishedDownloads = {},publishedReleaseVersion = '';
  const progress = document.querySelector('#ng-progress'); const topButton = document.querySelector('#ng-top');
  const editablePages = ['home','nation','harbor','catalogue','about','contact'];
  function prepareAutoCopyFields(){
    const scopes=editablePages.map(page=>({key:page,node:document.querySelector(`#page-${page}`)}));
    scopes.push({key:'site',node:document.querySelector('#sidebar')},{key:'site',node:document.querySelector('.page-topline')},{key:'site',node:document.querySelector('.main-footer')});
    const counters={};
    for(const {key:scope,node:root} of scopes){if(!root)continue;counters[scope]??=0;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const textNodes=[];while(walker.nextNode())textNodes.push(walker.currentNode);
      for(const textNode of textNodes){const text=textNode.nodeValue;if(!text?.trim()||textNode.parentElement?.closest('[data-site-copy],script,style,textarea,input,select,option,template'))continue;const index=counters[scope]++,fieldKey=`auto_${scope}_${index}`,span=document.createElement('span');span.dataset.siteCopy=fieldKey;span.dataset.editorLabel=text.trim().replace(/\s+/g,' ').slice(0,42)||'Texte de la page';textNode.parentNode.replaceChild(span,textNode);span.append(textNode);const clickable=span.closest('a,button');if(clickable&&!clickable.dataset.editorAttrKey)clickable.dataset.editorAttrKey=fieldKey;
      }
    }
  }
  prepareAutoCopyFields();
  document.querySelectorAll('[data-site-copy]').forEach(node=>{const clickable=node.closest('a,button');if(clickable&&!clickable.dataset.editorAttrKey)clickable.dataset.editorAttrKey=node.dataset.siteCopy;});
  function renderPlatformDownloads(blocks=siteContent?.blocks||[]) {
    for(const platform of ['macos','linux']) {
      const block=[...blocks].reverse().find(item=>item.page==='harbor'&&item.type==='link'&&item.platform===platform&&item.url);
      const link=document.querySelector(`#platform-download-${platform}`),status=document.querySelector(`#platform-status-${platform}`);
      if(!link)continue;
      if(!link.dataset.uploadClickBound){link.dataset.uploadClickBound='true';link.addEventListener('click',event=>{if(!document.body.classList.contains('developer-live')||!link.classList.contains('platform-unavailable'))return;event.preventDefault();event.stopPropagation();const upload=document.querySelector('#editor-file-upload');if(upload){upload.dataset.platform=platform;upload.click();}});}
      if(publishedDownloads[platform]){link.href=publishedDownloads[platform];link.removeAttribute('aria-disabled');link.classList.remove('platform-unavailable','secondary-button');link.classList.add('primary-button');link.setAttribute('download','');link.innerHTML='Télécharger <span>↓</span>';if(status)status.textContent=`Version ${publishedReleaseVersion}`;}
      else if(block){link.href=block.url;link.removeAttribute('aria-disabled');link.classList.remove('platform-unavailable','secondary-button');link.classList.add('primary-button');link.setAttribute('download','');link.innerHTML='Télécharger <span>↓</span>';if(status)status.textContent=block.title;}
      else{link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.classList.remove('primary-button');link.classList.add('secondary-button','platform-unavailable');link.textContent='Bientôt disponible';if(status)status.textContent=developerModeActive?'Clique ici pour téléverser un fichier':`Version ${platform==='macos'?'macOS':'Linux'} à publier`;}
    }
  }
  function preparePageLayoutKeys() { for (const page of editablePages) { const root=document.querySelector(`#page-${page}`); if(!root)continue;[...root.children].forEach((node,index)=>{node.dataset.editorLayoutGroup='root';if(!node.dataset.editorLayoutKey)node.dataset.editorLayoutKey=`${page}-${index}`;});const portal=root.querySelector('.home-portal');if(portal)[...portal.children].forEach((node,index)=>{node.dataset.editorLayoutGroup='portal';node.dataset.editorLayoutKey=`home-portal-${index}`;}); } }
  function applySiteLayouts(layouts = siteContent?.layouts || {}) { for(const page of editablePages){const root=document.querySelector(`#page-${page}`),saved=layouts?.[page];if(!root||!saved)continue;const groups=Array.isArray(saved)?{root:saved}:saved;for(const [group,ids] of Object.entries(groups)){const parent=group==='root'?root:group==='portal'&&page==='home'?root.querySelector('.home-portal'):null;if(!parent||!Array.isArray(ids))continue;const nodes=new Map([...parent.children].map(node=>[node.dataset.editorLayoutKey,node]));for(const id of ids){const node=nodes.get(id);if(node){parent.append(node);nodes.delete(id);}}for(const node of nodes.values())parent.append(node);}} }
  function applyCopy(copy = {}) {
    for (const node of document.querySelectorAll('[data-site-copy]')) { const value = copy[node.dataset.siteCopy]; if (typeof value === 'string') node.textContent = value; }
    for(const [key,value] of Object.entries(copy)){if(!key.startsWith('href__')||typeof value!=='string')continue;const target=document.querySelector(`[data-editor-attr-key="${CSS.escape(key.slice(6))}"]`);if(!target)continue;if(value.startsWith('page:')){const page=value.slice(5);target.dataset.page=page;if(target instanceof HTMLAnchorElement)target.setAttribute('href',`#${page}`);}else if(target instanceof HTMLAnchorElement)target.setAttribute('href',value);}
    siteContent = siteContent || { copy: {}, blocks: [] };
    siteContent.copy = { ...siteContent.copy, ...copy };
    const pseudo = document.querySelector('#copy-name'); if (pseudo && copy.contactPseudo) pseudo.dataset.name = copy.contactPseudo;
  }
  function buildFragmentNode(node, block, path='0') {
    if (typeof node.text === 'string') {
      const span=document.createElement('span');span.dataset.siteCopy=`auto_${block.page}_${block.id.replace(/-/g,'')}_${path.replace(/\./g,'_')}`;span.dataset.editorLabel=node.text.trim().replace(/\s+/g,' ').slice(0,42)||'Texte copié';span.textContent=node.text;
      const saved=siteContent?.copy?.[span.dataset.siteCopy];if(typeof saved==='string')span.textContent=saved;return span;
    }
    const svgTags=['svg','path','circle','rect','line','polyline','polygon'];const element=svgTags.includes(node.tag)?document.createElementNS('http://www.w3.org/2000/svg',node.tag):document.createElement(node.tag);for(const [key,value] of Object.entries(node.attrs||{})){if(['class','title','aria-label','role','alt','href','src','target','rel','download','viewBox','width','height','fill','stroke','stroke-width','d','cx','cy','r','x','y','x1','x2','y1','y2','points'].includes(key))element.setAttribute(key,value);else if(key==='data-page')element.dataset.page=value;}
    (node.children||[]).forEach((child,index)=>element.append(buildFragmentNode(child,block,`${path}.${index}`)));return element;
  }
  function renderSiteBlocks(blocks = []) {
    for (const page of ['home','nation','harbor','catalogue','about','contact']) {
      const root = document.querySelector(`#page-${page}`); if (!root) continue;
      root.querySelectorAll(':scope > [data-site-block-id][data-editor-layout-group], .home-portal > [data-site-block-id][data-editor-layout-group]').forEach(node=>node.remove());
      let holder = root.querySelector('.custom-content-blocks');
      if (!holder) { holder = document.createElement('div'); holder.className = 'custom-content-blocks'; holder.dataset.editorLayoutKey='custom-blocks'; root.append(holder); }
      holder.replaceChildren();
      for (const block of blocks.filter(item => item.page === page)) {
      if(block.type==='fragment'&&block.tree){const fragment=buildFragmentNode(block.tree,block);fragment.dataset.siteBlockId=block.id;fragment.dataset.editorLayoutGroup=block.group||'root';fragment.dataset.editorLayoutKey=`fragment-${block.id.slice(0,24)}`;fragment.classList.add('editor-selectable');fragment.querySelectorAll('[data-site-copy]').forEach(node=>{const clickable=node.closest('a,button');if(clickable&&!clickable.dataset.editorAttrKey)clickable.dataset.editorAttrKey=node.dataset.siteCopy;});const parent=block.group==='portal'&&page==='home'?root.querySelector('.home-portal'):root;const after=block.afterKey&&parent?[...parent.children].find(node=>node.dataset.editorLayoutKey===block.afterKey):null;if(parent)parent.insertBefore(fragment,after?.nextSibling||null);continue;}
        if(block.platform)continue;
        const element = block.type === 'note' ? document.createElement('aside') : document.createElement('article');
        element.className = block.type === 'note' ? 'note-panel custom-note' : 'info-card custom-info-card';
        element.dataset.siteBlockId=block.id;element.classList.add('editor-selectable');
        const icon = document.createElement('span'); icon.className = block.type === 'note' ? '' : 'info-icon gold'; icon.textContent = block.icon || '✦'; element.append(icon);
        const title = document.createElement(block.type === 'note' ? 'strong' : 'h3'); title.textContent = block.title; element.append(title);
        if (block.text) { const text = document.createElement('p'); text.textContent = block.text; element.append(text); }
        if (block.type === 'link' && block.url) { const link = document.createElement('a'); link.className = 'secondary-button'; link.href = block.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = block.url.startsWith('/site-downloads/') ? 'Télécharger le fichier ↓' : 'Ouvrir le lien ↗'; element.append(link); }
        holder.append(element);
      }
      holder.hidden = !holder.childElementCount;
    }
    renderPlatformDownloads(blocks);
    applySiteLayouts();
    for(const block of blocks.filter(item=>item.type==='fragment'&&item.afterKey)){const parent=block.group==='portal'&&block.page==='home'?document.querySelector('#page-home .home-portal'):document.querySelector(`#page-${block.page}`),copy=parent?.querySelector(`[data-site-block-id="${CSS.escape(block.id)}"]`),anchor=parent&&[...parent.children].find(node=>node.dataset.editorLayoutKey===block.afterKey);if(copy&&anchor)parent.insertBefore(copy,anchor.nextSibling);}
    if(developerModeActive&&editablePages.includes(editorPage))enableLivePage(editorPage);
  }
  preparePageLayoutKeys();
  async function loadSiteContent() {
    try { const response = await fetch('/api/site/content', { cache: 'no-store' }); if (!response.ok) return; siteContent = await response.json(); applyCopy(siteContent.copy); renderSiteBlocks(siteContent.blocks); }
    catch { /* Le site garde ses textes intégrés si l’API de contenu est momentanément indisponible. */ }
  }
  loadSiteContent();
  function fieldElement(key, label, value) {
    const wrapper = document.createElement('label'); wrapper.className = 'admin-copy-field'; wrapper.textContent = label;
    const input = String(value || '').length > 105 ? document.createElement('textarea') : document.createElement('input');
    input.name = key; input.value = value || ''; input.maxLength = 600; input.required = true;
    if (input.tagName === 'TEXTAREA') input.rows = 3;
    wrapper.append(input); return wrapper;
  }
  function renderAdminCopy(data) {
    const mount = document.querySelector('#admin-copy-fields'); if (!mount) return; mount.replaceChildren();
    for (const group of Object.values(data.fields || {})) {
      const section = document.createElement('section'); section.className = 'admin-copy-group';
      const title = document.createElement('h3'); title.textContent = group.title; section.append(title);
      const grid = document.createElement('div'); grid.className = 'admin-copy-grid';
      for (const [key, label] of Object.entries(group.items || {})) grid.append(fieldElement(key, label, data.copy[key]));
      section.append(grid); mount.append(section);
    }
  }
  const pageNames = { home:'Accueil', nation:'Algérie', harbor:'Harbor Launcher', catalogue:'Modpacks en ligne', about:'À propos', contact:'Contact' };
  function renderAdminBlocks(blocks = []) {
    const mount = document.querySelector('#admin-block-list'); if (!mount) return; mount.replaceChildren();
    for (const block of blocks) {
      const row = document.createElement('article'); row.className = 'admin-block-row';
      const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${block.icon || '✦'} ${block.title}`;
      const meta = document.createElement('small'); meta.textContent = `${pageNames[block.page] || block.page} · ${block.type}`; info.append(title, meta);
      const actions = document.createElement('div'); actions.className = 'admin-block-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary-button'; edit.textContent = 'Modifier'; edit.dataset.editBlock = block.id;edit.hidden=block.type==='fragment';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary-button admin-delete'; remove.textContent = 'Supprimer'; remove.dataset.deleteBlock = block.id;
      actions.append(edit, remove); row.append(info, actions); mount.append(row);
    }
    if (!blocks.length) { const empty = document.createElement('p'); empty.className = 'mut'; empty.textContent = 'Aucun bloc personnalisé pour le moment.'; mount.append(empty); }
  }
  const editorPages = [
    { id:'global', label:'Identité & navigation', groups:['general','navigation'] },
    { id:'home', label:'Accueil', groups:['home'] },
    { id:'nation', label:'Algérie', groups:['nation'] },
    { id:'harbor', label:'Harbor Launcher', groups:['harbor'] },
    { id:'catalogue', label:'Modpacks en ligne', groups:['catalogue'] },
    { id:'about', label:'À propos', groups:['about'] },
    { id:'contact', label:'Contact', groups:['contact'] }
  ];
  let editorPage = 'home';
  let editorSelectedKey = '';
  let editorSelectedAttrKey = '';
  let editorSelectedElement = null;
  let editorCopiedElement = null;
  let editorDraft = {};
  let editorLayoutDirty = false;
  let developerModeActive = false;
  function editorFieldMap() {
    const fields = {};
    for (const group of Object.values(siteContent?.fields || {})) for (const [key, label] of Object.entries(group.items || {})) fields[key] = label;
    document.querySelectorAll('[data-site-copy]').forEach(node=>{const key=node.dataset.siteCopy;if(!fields[key])fields[key]=node.dataset.editorLabel||node.textContent.trim().replace(/\s+/g,' ').slice(0,42)||'Texte libre';});
    return fields;
  }
  function editorKeys(page) {
    const groups = editorPages.find(item => item.id === page)?.groups || [];
    const configured=groups.flatMap(group => Object.keys(siteContent?.fields?.[group]?.items || {}));
    const roots=page==='global'?[document.querySelector('#sidebar'),document.querySelector('.page-topline'),document.querySelector('.main-footer')]:[document.querySelector(`#page-${page}`)];
    const generated=roots.filter(Boolean).flatMap(root=>[...root.querySelectorAll('[data-site-copy]')].map(node=>node.dataset.siteCopy));
    return [...new Set([...configured,...generated])];
  }
  function renderEditorNav() {
    const nav = document.querySelector('#editor-page-nav'); if (!nav) return;
    nav.replaceChildren();
    for (const page of editorPages.filter(item=>item.id==='global')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'editor-page-tab';
      button.dataset.editorPage = page.id; button.textContent = page.label;
      button.setAttribute('aria-pressed', String(page.id === editorPage)); nav.append(button);
    }
  }
  function renderEditorPreviewNav() {
    const nav=document.querySelector('#editor-preview-nav');if(!nav)return;nav.replaceChildren();
    for(const page of editorPages.filter(item=>item.id!=='global')){const button=document.createElement('button');button.type='button';button.dataset.previewPage=page.id;button.textContent=page.label;button.classList.toggle('active',page.id===editorPage);nav.append(button);}
  }
  function renderEditorGlobalPreview(mount, keys, labels) {
    const preview = document.createElement('div'); preview.className = 'editor-global-preview';
    const title = document.createElement('div'); title.className = 'editor-global-brand';
    const logo = document.createElement('span'); logo.className = 'editor-global-mark'; logo.textContent = 'M✦'; title.append(logo);
    const brand = document.createElement('div'); brand.className = 'editor-global-name';
    for (const key of ['brandName','brandSubtitle','ownerName','ownerRole']) {
      if (!keys.includes(key)) continue;
      const item = document.createElement(key === 'brandName' ? 'strong' : 'small'); item.dataset.editorKey = key; item.className = 'editor-editable'; item.tabIndex = 0;
      item.textContent = editorDraft[key] ?? siteContent.copy[key] ?? ''; item.title = labels[key] || key; brand.append(item);
    }
    title.append(brand); preview.append(title);
    const navTitle = document.createElement('span'); navTitle.className = 'detail-kicker'; navTitle.textContent = 'NAVIGATION DU SITE'; preview.append(navTitle);
    const nav = document.createElement('div'); nav.className = 'editor-global-nav';
    for (const key of keys.filter(item => item.startsWith('nav'))) {
      const item = document.createElement('button'); item.type = 'button'; item.dataset.editorKey = key; item.className = 'editor-editable';
      item.textContent = editorDraft[key] ?? siteContent.copy[key] ?? ''; item.title = labels[key] || key; nav.append(item);
    }
    preview.append(nav); mount.replaceChildren(preview);
  }
  function selectEditorField(key) {
    if (!editorKeys(editorPage).includes(key)&&!editorKeys('global').includes(key)&&!editablePages.some(page=>editorKeys(page).includes(key))) return;
    editorSelectedKey = key;
    const labels = editorFieldMap(), value = document.querySelector('#editor-field-value');
    const heading = document.querySelector('#editor-inspector-title'), label = document.querySelector('#editor-field-label');
    const help = document.querySelector('#editor-inspector-help'), count = document.querySelector('#editor-char-count'),urlInput=document.querySelector('#editor-field-url'),urlLabel=document.querySelector('#editor-field-url-label');
    const save = document.querySelector('#editor-save'), reset = document.querySelector('#editor-reset');
    if (!value || !heading || !label || !count || !save || !reset) return;
    heading.textContent = labels[key] || 'Modifier le texte'; label.textContent = labels[key] || 'Texte';
    label.hidden = value.hidden = count.hidden = false; value.value = editorDraft[key] ?? siteContent.copy[key] ?? '';
    if (help) help.textContent = 'Modifie le contenu ici. L’aperçu se met à jour immédiatement; enregistre pour publier le changement.';
    count.textContent = `${value.value.length} / 600 caractères`;
    const selectedField=document.querySelector(`[data-site-copy="${CSS.escape(key)}"]`),clickable=selectedField?.closest('a,button');editorSelectedAttrKey=clickable?.dataset.editorAttrKey||'';
    if(urlInput&&urlLabel){urlLabel.hidden=urlInput.hidden=!editorSelectedAttrKey;if(editorSelectedAttrKey){const attrValue=editorDraft[`href__${editorSelectedAttrKey}`]??siteContent.copy[`href__${editorSelectedAttrKey}`]??(clickable.dataset.page?`page:${clickable.dataset.page}`:clickable instanceof HTMLAnchorElement?clickable.getAttribute('href')||'':'');urlInput.value=attrValue;}}
    const hrefKey=editorSelectedAttrKey?`href__${editorSelectedAttrKey}`:'';save.disabled=value.value===(siteContent.copy[key]??'')&&(!hrefKey||!Object.prototype.hasOwnProperty.call(editorDraft,hrefKey));reset.hidden=false;
    document.querySelectorAll('[data-editor-key]').forEach(node => node.classList.toggle('is-selected', node.dataset.editorKey === key));
    const selectedPreview=document.querySelector(`[data-editor-key="${CSS.escape(key)}"]`);if(selectedPreview)selectEditorElement(selectedPreview.closest('.editor-selectable,.editor-layout-item')||selectedPreview);
  }
  function selectEditorElement(element){
    if(!element)return;document.querySelectorAll('.editor-element-selected').forEach(node=>node.classList.remove('editor-element-selected'));
    editorSelectedElement=element;element.classList.add('editor-element-selected');
    const blockId=element.dataset.siteBlockId,block=siteContent?.blocks?.find(item=>item.id===blockId);
    const heading=document.querySelector('#editor-inspector-title'),help=document.querySelector('#editor-inspector-help'),copyButton=document.querySelector('#editor-copy-element');
    if(heading)heading.textContent=block?.title||element.querySelector('h1,h2,h3,strong')?.textContent?.trim()||'Élément sélectionné';
    if(help)help.textContent=block?.type==='fragment'?'Section copiée : modifie chaque texte en cliquant dessus. Tu peux aussi déplacer ou supprimer la section.':block?'Élément ajouté : tu peux le copier, le modifier ou le déplacer.':'Section du site : copie sa structure et son apparence, puis modifie ses textes séparément.';
    if(copyButton)copyButton.disabled=false;const modifyButton=document.querySelector('#editor-modify-element');if(modifyButton)modifyButton.disabled=!block||block.type==='fragment';
  }
  function setEditorHref(target,value){if(!target)return;if(value.startsWith('page:')){const page=value.slice(5);if(/^(home|nation|harbor|catalogue|about|contact|account)$/.test(page)){target.dataset.page=page;if(target instanceof HTMLAnchorElement)target.setAttribute('href',`#${page}`);}return;}delete target.dataset.page;if(target instanceof HTMLAnchorElement){if(!value)target.removeAttribute('href');else if(/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value))target.setAttribute('href',value);}}
  function serializeEditorNode(node){
    if(node.nodeType===Node.TEXT_NODE)return node.nodeValue?{text:node.nodeValue}:null;
    if(node.nodeType!==Node.ELEMENT_NODE)return null;const tag=node.tagName.toLowerCase();if(!new Set(['div','section','article','aside','header','footer','span','strong','em','b','i','p','small','h1','h2','h3','h4','h5','h6','ul','ol','li','a','button','label','br','hr','img','sup','sub','mark','svg','path','circle','rect','line','polyline','polygon']).has(tag))return{tag:'span',attrs:{},children:[...node.childNodes].map(serializeEditorNode).filter(Boolean)};
    const attrs={};for(const name of ['class','href','src','alt','data-page','title','aria-label','role','target','rel','download']){let value=name==='data-page'?node.dataset.page:node.getAttribute(name);if(name==='class'&&value)value=value.split(/\s+/).filter(token=>!token.startsWith('editor-')&&!token.startsWith('is-')).join(' ');if(name==='title'&&value&&/^(Clique pour|Modifier\s*:|Fais glisser)/i.test(value))value='';if(value!==null&&value!=='')attrs[name]=value;}
    const children=[...node.childNodes].map(serializeEditorNode).filter(Boolean);return{tag,attrs,children};
  }
  function snapshotSelectedElement(){
    const block=siteContent?.blocks?.find(item=>item.id===editorSelectedElement?.dataset.siteBlockId);if(block)return{...block};
    const element=editorSelectedElement;if(!element)return null;
    if(!element||editorPage==='global')return null;const tree=serializeEditorNode(element);if(!tree)return null;
    const title=(element.querySelector('h1,h2,h3,h4,strong,.detail-kicker')?.textContent||element.textContent||'Section copiée').trim().replace(/\s+/g,' ').slice(0,80);
    return{page:editorPage,type:'fragment',icon:'✦',title,text:'',url:'',platform:'',tree,group:element.dataset.editorLayoutGroup||'root',afterKey:element.dataset.editorLayoutKey||''};
  }
  function renderEditorPreview() {
    const mount = document.querySelector('#editor-preview'); if (!mount || !siteContent) return;
    const page = editorPages.find(item => item.id === editorPage), keys = editorKeys(editorPage), labels = editorFieldMap();
    const title = document.querySelector('#editor-preview-title'); if (title) title.textContent = page?.label || 'Aperçu';
    const counter = document.querySelector('#editor-field-count'); if (counter) counter.textContent = `${keys.length} élément${keys.length === 1 ? '' : 's'} modifiable${keys.length === 1 ? '' : 's'}`;
    renderEditorPreviewNav();
    document.querySelectorAll('.editor-page-tab').forEach(button => { const active = button.dataset.editorPage === editorPage; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    if (editorPage === 'global') renderEditorGlobalPreview(mount, keys, labels);
    else {
      const source = document.querySelector(`#page-${editorPage}`);
      if (!source) { mount.replaceChildren(); return; }
      const clone = source.cloneNode(true); clone.id = 'editor-preview-page'; clone.classList.add('active','editor-preview-page'); if (editorPage === 'home') clone.classList.add('editor-home-preview'); clone.removeAttribute('aria-labelledby');
      clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      for(const child of clone.children){child.draggable=true;child.classList.add('editor-layout-item');child.title='Fais glisser cet élément pour le déplacer';}
      if(editorPage==='home'){const portal=clone.querySelector('.home-portal');for(const child of portal?.children||[]){child.draggable=true;child.classList.add('editor-layout-item');child.title='Fais glisser cet élément pour le déplacer';}}
      clone.querySelectorAll('form').forEach(node => node.remove());
      clone.querySelectorAll('[data-site-copy]').forEach(node => {
        const key = node.dataset.siteCopy; if (!keys.includes(key)) return;
        node.dataset.editorKey = key; node.classList.add('editor-editable'); node.tabIndex = 0; node.title = `Modifier : ${labels[key] || key}`;
      });
      mount.replaceChildren(clone);
    }
    const elements = document.querySelector('#editor-elements'), addHelp = document.querySelector('#editor-add-help');
    if (elements) elements.hidden = editorPage === 'global';
    const layoutTools=document.querySelector('#editor-layout-tools');if(layoutTools)layoutTools.hidden=editorPage==='global';
    if (addHelp) addHelp.textContent = editorPage === 'global' ? 'Choisis une page pour ajouter du contenu.' : 'Ajoute une carte, une note ou un lien. Tu pourras le déplacer avec les flèches.';
    renderEditorBlocks();
    if (editorSelectedKey && keys.includes(editorSelectedKey)) selectEditorField(editorSelectedKey);
  }
  function renderEditorBlocks() {
    const mount = document.querySelector('#editor-blocks-list'); if (!mount) return; mount.replaceChildren();
    const blocks = (siteContent?.blocks || []).filter(block => block.page === editorPage);
    blocks.forEach((block, index) => {
      const row = document.createElement('article'); row.className = 'editor-block-row';
      const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${block.icon || '✦'} ${block.title}`;
       const meta = document.createElement('small'); meta.textContent = block.type === 'fragment'?'Section copiée — clique ses textes pour les modifier':block.type === 'card' ? 'Carte' : block.type === 'note' ? 'Note' : 'Lien'; info.append(title, meta);
      const actions = document.createElement('div'); actions.className = 'editor-block-actions';
      for (const [label, action, disabled] of [['↑','up',index===0],['↓','down',index===blocks.length-1]]) { const button = document.createElement('button'); button.type='button'; button.textContent=label; button.title=action==='up'?'Monter':'Descendre'; button.dataset.moveBlock=block.id; button.dataset.direction=action; button.disabled=disabled; actions.append(button); }
       const edit = document.createElement('button'); edit.type='button'; edit.textContent='Modifier'; edit.dataset.editBlock=block.id;edit.hidden=block.type==='fragment';actions.append(edit);
      const remove = document.createElement('button'); remove.type='button'; remove.textContent='Supprimer'; remove.className='editor-delete'; remove.dataset.deleteBlock=block.id; actions.append(remove);
      row.append(info,actions); mount.append(row);
    });
    if (!blocks.length) { const empty=document.createElement('p'); empty.className='mut'; empty.textContent='Rien d’ajouté sur cette page pour le moment.'; mount.append(empty); }
  }
  function enableLivePage(page){
    const root=document.querySelector(`#page-${page}`);if(!root)return;
    const keys=editorKeys(page),labels=editorFieldMap();
    root.querySelectorAll('[data-site-copy]').forEach(node=>{const key=node.dataset.siteCopy;if(!keys.includes(key))return;node.dataset.editorKey=key;node.classList.add('editor-editable');node.tabIndex=0;node.title=`Modifier : ${labels[key]||key}`;});
    const mark=parent=>[...parent.children].forEach(node=>{node.draggable=true;node.classList.add('editor-layout-item','editor-selectable');node.title='Clique pour sélectionner ou fais glisser pour déplacer cette section';});mark(root);
    root.querySelectorAll('.custom-info-card,.custom-note').forEach(node=>node.classList.add('editor-selectable'));
    if(page==='home'){const portal=root.querySelector('.home-portal');if(portal)mark(portal);}
    renderEditorBlocks();
  }
  function enableGlobalLiveFields(){const keys=new Set(editorKeys('global')),labels=editorFieldMap();for(const node of [document.querySelector('#sidebar'),document.querySelector('.page-topline'),document.querySelector('.main-footer')].filter(Boolean).flatMap(root=>[...root.querySelectorAll('[data-site-copy]')])){const key=node.dataset.siteCopy;if(!keys.has(key))continue;node.dataset.editorKey=key;node.classList.add('editor-editable');node.tabIndex=0;node.title=`Modifier : ${labels[key]||key}`;}}
  function setEditorLayoutDirty(dirty=true){editorLayoutDirty=dirty;const save=document.querySelector('#editor-layout-save'),feedback=document.querySelector('#editor-layout-feedback');if(save)save.disabled=!dirty;if(feedback)feedback.textContent=dirty?'Disposition modifiée — enregistre pour publier.':'';}
  function handleEditorPreviewDrag(preview){
    preview.addEventListener('dragstart',event=>{const item=event.target.closest('.editor-layout-item');if(!item)return;event.dataTransfer?.setData('text/plain',item.dataset.editorLayoutKey||'');if(event.dataTransfer)event.dataTransfer.effectAllowed='move';item.classList.add('is-dragging');});
    preview.addEventListener('dragover',event=>{const target=event.target.closest('.editor-layout-item'),source=preview.querySelector('.is-dragging');if(!target||!source||target.parentElement!==source.parentElement)return;event.preventDefault();target.classList.add('is-drop-target');});
    preview.addEventListener('dragleave',event=>event.target.closest('.editor-layout-item')?.classList.remove('is-drop-target'));
    preview.addEventListener('drop',event=>{const target=event.target.closest('.editor-layout-item'),key=event.dataTransfer?.getData('text/plain'),source=[...preview.querySelectorAll('.editor-layout-item')].find(node=>node.dataset.editorLayoutKey===key);if(!target||!source||source===target||source.parentElement!==target.parentElement)return;event.preventDefault();target.classList.remove('is-drop-target');const rect=target.getBoundingClientRect();target.parentElement.insertBefore(source,event.clientY<rect.top+rect.height/2?target:target.nextSibling);setEditorLayoutDirty();});
    preview.addEventListener('dragend',()=>preview.querySelectorAll('.is-dragging,.is-drop-target').forEach(node=>node.classList.remove('is-dragging','is-drop-target')));
  }
  function handleLivePageDrag(root){
    if(root.dataset.editorDragBound)return;root.dataset.editorDragBound='true';
    const findContainer=target=>{const item=target.closest('.editor-layout-item');if(item?.closest('#page-home .home-portal'))return item.closest('.home-portal');return item?.closest('.page');};
    root.addEventListener('dragstart',event=>{const item=event.target.closest('.editor-layout-item');if(!item)return;event.dataTransfer?.setData('text/plain',item.dataset.editorLayoutKey||'');if(event.dataTransfer)event.dataTransfer.effectAllowed='move';item.classList.add('is-dragging');});
    root.addEventListener('dragover',event=>{const target=event.target.closest('.editor-layout-item'),source=root.querySelector('.is-dragging');if(!target||!source||findContainer(target)!==findContainer(source))return;event.preventDefault();target.classList.add('is-drop-target');});
    root.addEventListener('drop',event=>{const target=event.target.closest('.editor-layout-item'),key=event.dataTransfer?.getData('text/plain'),source=[...root.querySelectorAll('.editor-layout-item')].find(node=>node.dataset.editorLayoutKey===key);if(!target||!source||source===target||findContainer(source)!==findContainer(target))return;event.preventDefault();target.classList.remove('is-drop-target');const rect=target.getBoundingClientRect();target.parentElement.insertBefore(source,event.clientY<rect.top+rect.height/2?target:target.nextSibling);setEditorLayoutDirty();});
    root.addEventListener('dragend',()=>root.querySelectorAll('.is-dragging,.is-drop-target').forEach(node=>node.classList.remove('is-dragging','is-drop-target')));
  }
  function setEditorPage(page) {
    if (!editorPages.some(item => item.id === page)) return;
    if(editorLayoutDirty&&!window.confirm('La disposition n’est pas enregistrée. Abandonner ce déplacement ?'))return;
    setEditorLayoutDirty(false);
    editorSelectedElement?.classList.remove('editor-element-selected');editorSelectedElement=null;const copyButton=document.querySelector('#editor-copy-element');if(copyButton)copyButton.disabled=true;const modifyButton=document.querySelector('#editor-modify-element');if(modifyButton)modifyButton.disabled=true;const pasteButton=document.querySelector('#editor-paste-element');if(pasteButton)pasteButton.disabled=!editorCopiedElement;
    editorPage = page; editorSelectedKey = ''; editorSelectedAttrKey=''; editorDraft = {};
    const platformHint=document.querySelector('.platform-admin-hint');if(platformHint)platformHint.hidden=!developerModeActive||page!=='harbor';renderPlatformDownloads();
    navLinks.forEach(link=>link.classList.toggle('active',page!=='global'&&link.dataset.page===page));
    const heading = document.querySelector('#editor-inspector-title'), help = document.querySelector('#editor-inspector-help');
    const field = document.querySelector('#editor-field-value'), label = document.querySelector('#editor-field-label'), count = document.querySelector('#editor-char-count');
    if (heading) heading.textContent = 'Sélectionne un élément';
    if (help) help.textContent = 'Clique sur un texte encadré pour le modifier, ou ajoute un élément ci-dessous.';
    if (field) field.hidden = true; if (label) label.hidden = true; if (count) count.hidden = true;const urlField=document.querySelector('#editor-field-url'),urlLabel=document.querySelector('#editor-field-url-label');if(urlField)urlField.hidden=true;if(urlLabel)urlLabel.hidden=true;
    const save = document.querySelector('#editor-save'), reset = document.querySelector('#editor-reset'); if (save) save.disabled = true; if (reset) reset.hidden = true;
    renderEditorNav(); renderEditorPreview();
  }
  function initVisualEditor() {
    const nav = document.querySelector('#editor-page-nav'), preview = document.querySelector('#editor-preview'), field = document.querySelector('#editor-field-value');
    if (nav && !nav.dataset.bound) { nav.dataset.bound = 'true'; nav.addEventListener('click', event => { const button = event.target.closest('[data-editor-page]'); if (button) setEditorPage(button.dataset.editorPage); }); }
    if (preview && !preview.dataset.bound) {
      preview.dataset.bound = 'true';
      renderEditorPreviewNav();handleEditorPreviewDrag(preview);
      document.querySelector('#editor-preview-nav')?.addEventListener('click',event=>{const button=event.target.closest('[data-preview-page]');if(button)setEditorPage(button.dataset.previewPage);});
      preview.addEventListener('click', event => { event.stopPropagation(); const pageLink=event.target.closest('[data-page]');if(pageLink){event.preventDefault();setEditorPage(pageLink.dataset.page);return;}const target = event.target.closest('[data-editor-key]'); if (target) { event.preventDefault(); selectEditorField(target.dataset.editorKey); } else if (event.target.closest('a,button')) event.preventDefault(); });
      preview.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-editor-key]')) { event.preventDefault(); selectEditorField(event.target.dataset.editorKey); } });
    }
    if (field && !field.dataset.bound) {
      field.dataset.bound = 'true'; field.addEventListener('input', () => {
        if (!editorSelectedKey) return;
        const key = editorSelectedKey, saved = siteContent.copy[key] ?? '';
        if (field.value === saved) delete editorDraft[key]; else editorDraft[key] = field.value;
        document.querySelectorAll('#editor-preview [data-editor-key]').forEach(node => { if (node.dataset.editorKey === key) node.textContent = field.value; });
        const count = document.querySelector('#editor-char-count'); if (count) count.textContent = `${field.value.length} / 600 caractères`;
        const hrefKey=editorSelectedAttrKey?`href__${editorSelectedAttrKey}`:'';const save = document.querySelector('#editor-save'); if (save) save.disabled = field.value === saved&&(!hrefKey||!Object.prototype.hasOwnProperty.call(editorDraft,hrefKey));
      });
    }
    const urlField=document.querySelector('#editor-field-url');if(urlField&&!urlField.dataset.bound){urlField.dataset.bound='true';urlField.addEventListener('input',()=>{if(!editorSelectedAttrKey)return;const key=`href__${editorSelectedAttrKey}`,selected=document.querySelector(`[data-site-copy="${CSS.escape(editorSelectedKey)}"]`),clickable=selected?.closest('a,button'),saved=siteContent.copy[key]??(clickable?.dataset.page?`page:${clickable.dataset.page}`:clickable instanceof HTMLAnchorElement?clickable.getAttribute('href')||'':'');if(urlField.value===saved)delete editorDraft[key];else editorDraft[key]=urlField.value;document.querySelectorAll(`[data-editor-attr-key="${CSS.escape(editorSelectedAttrKey)}"]`).forEach(node=>setEditorHref(node,urlField.value));const textField=document.querySelector('#editor-field-value'),textSaved=siteContent.copy[editorSelectedKey]??'';const save=document.querySelector('#editor-save');if(save)save.disabled=(textField?.value??'')===textSaved&&!Object.prototype.hasOwnProperty.call(editorDraft,key);});}
    renderEditorNav(); if (!editorPages.some(item => item.id === editorPage)) editorPage = 'home'; renderEditorPreview();
  }
  document.querySelector('#editor-save')?.addEventListener('click', async () => {
    const feedback = document.querySelector('#editor-feedback'), key = editorSelectedKey;
    if (!key || !Object.keys(editorDraft).length) return;
    try {
      siteContent = await authRequest('/api/admin/site-content', 'PUT', { copy: editorDraft });
      applyCopy(siteContent.copy); renderSiteBlocks(siteContent.blocks); editorDraft = {}; renderEditorPreview();
      if (key) selectEditorField(key);
      showAuthMessage(feedback, 'Modifications enregistrées et visibles sur le site.', 'success');
    } catch (error) { showAuthMessage(feedback, error.message, 'error'); }
  });
  document.querySelector('#editor-reset')?.addEventListener('click', () => { const key = editorSelectedKey;if(!key)return;delete editorDraft[key];if(editorSelectedAttrKey)delete editorDraft[`href__${editorSelectedAttrKey}`];applyCopy(siteContent.copy);renderEditorPreview();selectEditorField(key);showAuthMessage(document.querySelector('#editor-feedback'),'Modification annulée.',''); });
  document.querySelector('#editor-layout-save')?.addEventListener('click',async()=>{
    const root=developerModeActive?document.querySelector(`#page-${editorPage}`):document.querySelector('#editor-preview-page');if(!root||!editorLayoutDirty)return;
    const layout={root:[...root.children].map(node=>node.dataset.editorLayoutKey).filter(Boolean)};if(editorPage==='home'){const portal=root.querySelector('.home-portal');if(portal)layout.portal=[...portal.children].map(node=>node.dataset.editorLayoutKey).filter(Boolean);}
    try{siteContent=await authRequest('/api/admin/site-content/layout','PUT',{page:editorPage,layout});applySiteLayouts(siteContent.layouts);setEditorLayoutDirty(false);renderEditorPreview();const feedback=document.querySelector('#editor-layout-feedback');if(feedback)feedback.textContent='Nouvel emplacement enregistré.';}
    catch(error){const feedback=document.querySelector('#editor-layout-feedback');if(feedback)feedback.textContent=error.message;}
  });
  async function loadAdminEditor() {
    const warning = document.querySelector('#admin-https-warning');
    if (!securePage) { if (warning) warning.hidden = false; return; }
    try {
      const response = await fetch('/api/site/content', { cache: 'no-store' }); if (!response.ok) throw new Error('Impossible de charger le contenu du site.');
      siteContent = await response.json(); applyCopy(siteContent.copy); renderSiteBlocks(siteContent.blocks);
      renderAdminBlocks(siteContent.blocks);
      initVisualEditor();
      const status=await fetch('/api/admin/launcher-update/status',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).catch(()=>({version:null,archives:[]}));const current=document.querySelector('#launcher-release-current');if(current)current.textContent=`${status.version?`Version publiée : ${status.version}`:'Aucune version publiée détectée.'} · Archives conservées : ${(status.archives||[]).join(', ')||'aucune'}`;
      const siteStatus=await fetch('/api/admin/site-update/status',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).catch(()=>({releases:[]}));const history=document.querySelector('#site-update-history');if(history)history.textContent=`Archives du site conservées : ${(siteStatus.releases||[]).join(', ')||'aucune'}. Les fichiers publiés sont sauvegardés avant remplacement.`;
    } catch (error) { showAuthMessage(document.querySelector('#admin-copy-feedback'), error.message, 'error'); }
  }
  const developerToggle=document.querySelector('#developer-mode-toggle'),workspace=document.querySelector('#admin-editor-workspace'),editorLayout=document.querySelector('.editor-layout'),inspector=document.querySelector('.editor-inspector'),composerPanel=document.querySelector('#admin-block-panel'),releasePanel=document.querySelector('.launcher-release-panel'),siteUpdatePanel=document.querySelector('#site-update-panel'),layoutTools=document.querySelector('#editor-layout-tools');
  const liveTools=document.createElement('section');liveTools.id='developer-live-tools';liveTools.className='developer-live-tools';liveTools.hidden=true;document.body.append(liveTools);
  const restorePositions=new Map([developerToggle,editorLayout,composerPanel,releasePanel,siteUpdatePanel].filter(Boolean).map(node=>[node,{parent:node.parentElement,next:node.nextSibling}]));
  function setDeveloperMode(active){
    developerModeActive=active;document.body.classList.toggle('developer-live',active);
    const platformHint=document.querySelector('.platform-admin-hint');if(platformHint){platformHint.hidden=!active||editorPage!=='harbor';platformHint.textContent='Mode développeur : clique sur « Bientôt disponible » pour téléverser le fichier de cette plateforme.';}
    renderPlatformDownloads();
    if(active){
      if(developerToggle)liveTools.append(developerToggle);
      if(editorLayout){liveTools.append(editorLayout);const preview=editorLayout.querySelector('.editor-preview-panel');if(preview)preview.hidden=true;if(inspector){liveTools.prepend(inspector);if(layoutTools)inspector.append(layoutTools);}}
      if(composerPanel)liveTools.append(composerPanel);if(releasePanel)liveTools.append(releasePanel);if(siteUpdatePanel)liveTools.append(siteUpdatePanel);liveTools.hidden=false;workspace.hidden=true;
      const page=editablePages.includes(editorPage)?editorPage:'home';showPage(page);enableLivePage(page);enableGlobalLiveFields();handleLivePageDrag(document.querySelector(`#page-${page}`));
    }else{
      if(layoutTools){const preview=editorLayout?.querySelector('.editor-preview-panel');preview?.append(layoutTools);}if(inspector&&editorLayout)editorLayout.append(inspector);if(editorLayout){const preview=editorLayout.querySelector('.editor-preview-panel');if(preview)preview.hidden=false;}
      for(const [node,position] of restorePositions){if(position.parent)position.parent.insertBefore(node,position.next?.parentNode===position.parent?position.next:null);}
      document.querySelectorAll('.editor-editable').forEach(node=>node.classList.remove('editor-editable','is-selected'));
      document.querySelectorAll('.editor-element-selected,.editor-selectable').forEach(node=>node.classList.remove('editor-element-selected','editor-selectable'));
      document.querySelectorAll('[data-editor-key]').forEach(node=>node.removeAttribute('data-editor-key'));
      document.querySelectorAll('.editor-layout-item').forEach(node=>{node.classList.remove('editor-layout-item','is-dragging','is-drop-target');node.removeAttribute('draggable');});
      liveTools.hidden=true;workspace.hidden=false;editorSelectedElement=null;const copyButton=document.querySelector('#editor-copy-element'),modifyButton=document.querySelector('#editor-modify-element');if(copyButton)copyButton.disabled=true;if(modifyButton)modifyButton.disabled=true;showPage('admin');renderEditorPreview();
    }
    developerToggle?.setAttribute('aria-pressed',String(active));if(developerToggle)developerToggle.innerHTML=active?'Quitter le mode développeur <span>×</span>':'Activer le mode développeur <span>⚙</span>';
  }
  developerToggle?.addEventListener('click',()=>setDeveloperMode(!developerModeActive));
  document.addEventListener('click',event=>{if(!developerModeActive)return;const page=document.querySelector(`#page-${editorPage}`),platformLink=event.target.closest('#platform-download-macos.platform-unavailable,#platform-download-linux.platform-unavailable');if(platformLink&&editorPage==='harbor'){event.preventDefault();event.stopImmediatePropagation();const upload=document.querySelector('#editor-file-upload');if(upload){upload.dataset.platform=platformLink.id.endsWith('macos')?'macos':'linux';upload.click();}return;}const fieldTarget=event.target.closest('[data-editor-key]'),itemTarget=event.target.closest('.editor-selectable,.editor-layout-item');if(fieldTarget){if(page?.contains(fieldTarget)){const item=fieldTarget.closest('.editor-selectable,.editor-layout-item');if(item)selectEditorElement(item);}event.preventDefault();event.stopImmediatePropagation();selectEditorField(fieldTarget.dataset.editorKey);return;}if(itemTarget&&page?.contains(itemTarget)){event.preventDefault();event.stopImmediatePropagation();selectEditorElement(itemTarget);return;}const navTarget=event.target.closest('a,button');if(page&&navTarget&&page.contains(navTarget)&&!navTarget.matches('[data-page]'))event.preventDefault();},true);
  document.addEventListener('keydown',event=>{if(!developerModeActive||!(event.ctrlKey||event.metaKey))return;const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'');if(typing)return;if(event.key.toLowerCase()==='c'&&editorSelectedElement){event.preventDefault();document.querySelector('#editor-copy-element')?.click();}else if(event.key.toLowerCase()==='v'&&editorCopiedElement){event.preventDefault();document.querySelector('#editor-paste-element')?.click();}});
  document.addEventListener('input',event=>{if(!developerModeActive||event.target.id!=='editor-field-value'||!editorSelectedKey)return;const key=editorSelectedKey,saved=siteContent.copy[key]||'';if(event.target.value===saved)delete editorDraft[key];else editorDraft[key]=event.target.value;document.querySelectorAll(`[data-editor-key="${CSS.escape(key)}"]`).forEach(node=>node.textContent=event.target.value);const count=document.querySelector('#editor-char-count');if(count)count.textContent=`${event.target.value.length} / 600 caractères`;const save=document.querySelector('#editor-save');if(save)save.disabled=!event.target.value.trim()||event.target.value===saved;});
  function xhrFileUpload(url,file,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',url);xhr.setRequestHeader('content-type','application/octet-stream');xhr.upload.addEventListener('progress',event=>onProgress(event.loaded,event.total,event.lengthComputable));xhr.addEventListener('load',()=>{let result={};try{result=JSON.parse(xhr.responseText||'{}');}catch{}if(xhr.status>=200&&xhr.status<300)resolve(result);else reject(new Error(result.error||`Envoi impossible (${xhr.status})`));});xhr.addEventListener('error',()=>reject(new Error('Connexion interrompue pendant l’envoi.')));xhr.addEventListener('abort',()=>reject(new Error('Envoi annulé.')));xhr.send(file);});}
  const releaseFilesInput=document.querySelector('#launcher-update-files');
  releaseFilesInput?.addEventListener('change',()=>{const list=document.querySelector('#launcher-update-file-list'),files=[...(releaseFilesInput.files||[])];if(list)list.textContent=files.length?files.map(file=>`${file.name} (${formatFileSize(file.size)})`).join(' · '):'Aucun fichier sélectionné.';});
  document.querySelector('#launcher-update-publish')?.addEventListener('click',async event=>{
    const button=event.currentTarget,feedback=document.querySelector('#launcher-update-feedback'),files=[...(releaseFilesInput?.files||[])],transfer=document.querySelector('#launcher-update-progress'),progress=document.querySelector('#launcher-update-progress-bar'),progressLabel=document.querySelector('#launcher-update-progress-label');if(files.length!==1||!/^Harbor Launcher Update \d+\.\d+\.\d+\.zip$/.test(files[0]?.name||'')){showAuthMessage(feedback,'Choisis le fichier ZIP Harbor Launcher Update x.y.z.zip créé sur le PC de compilation.','error');return;}
    button.disabled=true;if(transfer)transfer.hidden=false;if(progress){progress.max=100;progress.value=0;}
    try{
      const total=files.reduce((sum,file)=>sum+file.size,0);let completed=0;
      for(let i=0;i<files.length;i++){const file=files[i];if(feedback)feedback.textContent=`Envoi du fichier ${i+1}/${files.length} : ${file.name}`;if(progressLabel)progressLabel.textContent=`${i+1}/${files.length} · ${file.name} · 0 %`;await xhrFileUpload(`/api/admin/launcher-update/upload?name=${encodeURIComponent(file.name)}`,file,(loaded,size,known)=>{if(known){const percent=total?Math.round((completed+loaded)/total*100):100;if(progress)progress.value=percent;if(progressLabel)progressLabel.textContent=`${i+1}/${files.length} · ${file.name} · ${percent} % · ${formatFileSize(completed+loaded)} sur ${formatFileSize(total)}`;}});completed+=file.size;}
      if(progress)progress.value=100;if(progressLabel)progressLabel.textContent='Fichiers envoyés · vérification de la signature…';if(feedback)feedback.textContent='Vérification de la signature et publication…';const response=await fetch('/api/admin/launcher-update/publish',{method:'POST',credentials:'same-origin',cache:'no-store'});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`Publication impossible (${response.status})`);
      if(feedback){feedback.classList.add('success');feedback.textContent=`Harbor Launcher ${result.version} est publié pour Windows et Linux. Le ZIP est conservé dans les archives du serveur.`;}const current=document.querySelector('#launcher-release-current');if(current)current.textContent=`Version publiée : ${result.version} · archive conservée`;if(releaseFilesInput)releaseFilesInput.value='';const list=document.querySelector('#launcher-update-file-list');if(list)list.textContent='Aucun fichier sélectionné.';if(progressLabel)progressLabel.textContent=`Publication ${result.version} terminée.`;
    }catch(error){showAuthMessage(feedback,error.message,'error');}finally{button.disabled=false;}
  });

  const siteFilesInput=document.querySelector('#site-update-files'),siteDrop=document.querySelector('#site-update-file-list');
  siteFilesInput?.addEventListener('change',()=>{const file=siteFilesInput.files?.[0];if(siteDrop)siteDrop.textContent=file?`${file.name} (${formatFileSize(file.size)})`:'Dépose le ZIP ici ou clique pour le choisir.';});
  siteDrop?.addEventListener('click',()=>siteFilesInput?.click());
  for(const type of ['dragenter','dragover'])siteDrop?.addEventListener(type,event=>{event.preventDefault();siteDrop.classList.add('drag-over');});
  for(const type of ['dragleave','drop'])siteDrop?.addEventListener(type,event=>{event.preventDefault();siteDrop.classList.remove('drag-over');});
  siteDrop?.addEventListener('drop',event=>{const file=event.dataTransfer?.files?.[0];if(!file)return;const transfer=new DataTransfer();transfer.items.add(file);siteFilesInput.files=transfer.files;siteFilesInput.dispatchEvent(new Event('change',{bubbles:true}));});
  document.querySelector('#site-update-publish')?.addEventListener('click',async event=>{
    const button=event.currentTarget,file=siteFilesInput?.files?.[0],feedback=document.querySelector('#site-update-feedback'),transfer=document.querySelector('#site-update-progress'),bar=document.querySelector('#site-update-progress-bar'),label=document.querySelector('#site-update-progress-label');
    if(!file||!/^Harbor Site Update \d+\.\d+\.\d+\.zip$/.test(file.name)){showAuthMessage(feedback,'Choisis le ZIP Harbor Site Update x.y.z.zip préparé depuis le projet.','error');return;}
    button.disabled=true;if(transfer)transfer.hidden=false;if(bar)bar.value=0;
    try{
      if(feedback)feedback.textContent='Envoi du paquet du site…';await xhrFileUpload(`/api/admin/site-update/upload?name=${encodeURIComponent(file.name)}`,file,(loaded,size,known)=>{if(known){const percent=Math.round(loaded/size*100);if(bar)bar.value=percent;if(label)label.textContent=`${percent} % · ${formatFileSize(loaded)} sur ${formatFileSize(size)}`;}});
      if(feedback)feedback.textContent='Vérification, sauvegarde et application des fichiers…';const response=await fetch('/api/admin/site-update/publish',{method:'POST',credentials:'same-origin',cache:'no-store'}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`Publication impossible (${response.status})`);
      if(feedback){feedback.classList.add('success');feedback.textContent=`Mise à jour du site ${result.version} appliquée (${result.files} fichiers). Le serveur va redémarrer.`;}if(bar)bar.value=100;if(label)label.textContent='Application terminée · redémarrage du serveur';if(siteFilesInput)siteFilesInput.value='';if(siteDrop)siteDrop.textContent='Dépose le ZIP ici ou clique pour le choisir.';
    }catch(error){showAuthMessage(feedback,error.message,'error');}finally{button.disabled=false;}
  });

  function showPage(key, updateHash = true) {
    key = pageAliases[key] || key;
    if (!names[key] || !document.querySelector(`#page-${key}`)) key = 'home';
    if(key==='servers'&&document.querySelector('#minecraft-server-nav')?.hidden)key='home';
    pages.forEach(page => page.classList.toggle('active', page.id === `page-${key}`));
    navLinks.forEach(link => link.classList.toggle('active', link.dataset.page === key));
    if (breadcrumb) breadcrumb.textContent = names[key];
    if (updateHash && location.hash !== `#${key}`) history.replaceState(null, '', `#${key}`);
    sidebar?.classList.remove('open');
    scrim?.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateScrollChrome();
  }
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-page]');
    if (control) {
      const requested=pageAliases[control.dataset.page]||control.dataset.page;
      if(developerModeActive&&editablePages.includes(requested)){event.preventDefault();event.stopImmediatePropagation();setEditorPage(requested);showPage(requested);enableLivePage(requested);handleLivePageDrag(document.querySelector(`#page-${requested}`));closePalette();return;}
      const workspace=document.querySelector('#admin-editor-workspace');
      if(!workspace?.hidden&&editorPages.some(item=>item.id===requested&&item.id!=='global')){event.preventDefault();event.stopImmediatePropagation();setEditorPage(requested);closePalette();return;}
      event.preventDefault(); showPage(control.dataset.page); closePalette();
    }
  });
  const initialPage = pageAliases[location.hash.slice(1)] || location.hash.slice(1);
  showPage(names[initialPage] ? initialPage : 'home', false);

  menuButton?.addEventListener('click', () => {
    const open = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    scrim?.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
  });
  scrim?.addEventListener('click', () => { sidebar?.classList.remove('open'); scrim.classList.remove('open'); menuButton?.setAttribute('aria-expanded', 'false'); });

  const palette = document.querySelector('#ng-pal');
  const paletteInput = document.querySelector('#palette-input');
  const paletteItems = [...document.querySelectorAll('#palette-list li')];
  const paletteTrigger = document.querySelector('#open-palette');
  function openPalette() {
    palette?.classList.add('open'); palette?.setAttribute('aria-hidden', 'false');
    if (paletteInput) { paletteInput.value = ''; paletteItems.forEach(item => item.hidden = false); setTimeout(() => paletteInput.focus(), 0); }
  }
  function closePalette() {
    palette?.classList.remove('open'); palette?.setAttribute('aria-hidden', 'true');
    paletteTrigger?.focus({ preventScroll: true });
  }
  paletteTrigger?.addEventListener('click', openPalette);
  palette?.addEventListener('click', event => { if (event.target.matches('[data-pal-close]')) closePalette(); });
  paletteInput?.addEventListener('input', () => {
    const query = paletteInput.value.trim().toLocaleLowerCase('fr');
    paletteItems.forEach(item => item.hidden = !item.textContent.toLocaleLowerCase('fr').includes(query));
  });
  document.addEventListener('keydown', event => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); palette?.classList.contains('open') ? closePalette() : openPalette(); }
    else if (event.key === 'Escape') { if (palette?.classList.contains('open')) closePalette(); sidebar?.classList.remove('open'); scrim?.classList.remove('open'); menuButton?.setAttribute('aria-expanded', 'false'); }
    else if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey) { event.preventDefault(); openPalette(); }
  });

  const copyButton = document.querySelector('#copy-name');
  const feedback = document.querySelector('#copy-feedback');
  copyButton?.addEventListener('click', async () => {
    const name = copyButton.dataset.name || 'MAVIE7620';
    try { await navigator.clipboard.writeText(name); if (feedback) feedback.textContent = 'Pseudo copié dans le presse-papiers.'; }
    catch { if (feedback) feedback.textContent = `Mon pseudo : ${name}`; }
  });

  const authWarning = document.querySelector('#auth-https-warning');
  const authForms = document.querySelector('#auth-forms');
  const accountDashboard = document.querySelector('#account-dashboard');
  const authFeedback = document.querySelector('#auth-feedback');
  const passwordFeedback = document.querySelector('#password-feedback');
  const loginForm = document.querySelector('#auth-login-form');
  const registerForm = document.querySelector('#auth-register-form');
  const securePage = window.isSecureContext;
  const showAuthMessage = (node, message, kind = '') => { if (!node) return; node.textContent = message; node.classList.toggle('error', kind === 'error'); node.classList.toggle('success', kind === 'success'); };
  function selectAuthTab(which) {
    const register = which === 'register';
    if (loginForm) loginForm.hidden = register;
    if (registerForm) registerForm.hidden = !register;
    for (const [id, active] of [['auth-tab-login', !register], ['auth-tab-register', register]]) {
      const tab = document.getElementById(id); tab?.classList.toggle('active', active); tab?.setAttribute('aria-selected', String(active));
    }
    showAuthMessage(authFeedback, '');
  }
  document.querySelector('#auth-tab-login')?.addEventListener('click', () => selectAuthTab('login'));
  document.querySelector('#auth-tab-register')?.addEventListener('click', () => selectAuthTab('register'));
  async function authRequest(path, method = 'GET', values = null) {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: values ? { 'content-type': 'application/json' } : {}, body: values ? JSON.stringify(values) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `Erreur ${response.status}`); error.status = response.status; error.code = data.code; throw error; }
    return data;
  }
  function renderAccount(account, adminSetupAvailable = false) {
    if (authForms) authForms.hidden = Boolean(account);
    if (accountDashboard) accountDashboard.hidden = !account;
    const loginLink = document.querySelector('[data-page="account"].side-link > span:nth-child(2)');
    const claim = document.querySelector('#admin-claim-card'), adminOpen = document.querySelector('#admin-open');
    if (claim) claim.hidden = !account || account.role === 'admin' || !adminSetupAvailable;
    if (adminOpen) adminOpen.hidden = account?.role !== 'admin';
    const serverNav=document.querySelector('#minecraft-server-nav'),serverLabel=document.querySelector('#minecraft-server-label');if(serverNav)serverNav.hidden=account?.role!=='admin';if(serverLabel)serverLabel.hidden=account?.role!=='admin';
    for (const id of ['admin-copy-form','admin-editor-workspace','admin-block-panel']) { const element = document.getElementById(id); if (element) element.hidden = true; }
    const developerToggle=document.querySelector('#developer-mode-toggle');if(developerToggle){developerToggle.hidden=account?.role!=='admin';developerToggle.setAttribute('aria-pressed','false');developerToggle.innerHTML='Activer le mode développeur <span>⚙</span>';}
    if (!account) { if (loginLink) loginLink.textContent = siteContent?.copy?.navAccount || 'Créer un compte / Connexion'; return; }
    const display = account.displayName || account.username;
    const name = document.querySelector('#account-display-name'); if (name) name.textContent = display;
    const username = document.querySelector('#account-username'); if (username) username.textContent = account.username;
    const avatar = document.querySelector('#account-avatar'); if (avatar) avatar.textContent = display.trim().slice(0, 1).toUpperCase();
    const profileName = document.querySelector('#profile-display'); if (profileName) profileName.value = display;
    if (loginLink) loginLink.textContent = display;
    refreshSessionList();
    if (account.role === 'admin') loadAdminEditor();
  }
  async function refreshSessionList(){
    const summary=document.querySelector('#sessions-summary');if(!summary)return;
    try{const data=await authRequest('/api/auth/sessions');const others=data.sessions.filter(item=>!item.current).length;summary.textContent=`${data.sessions.length} session${data.sessions.length>1?'s':''} active${data.sessions.length>1?'s':''} · ${others} autre${others>1?'s':''} appareil${others>1?'s':''}. Les connexions expirent après 14 jours.`;}
    catch(error){summary.textContent=error.message;}
  }
  async function refreshAuthState() {
    if (!securePage) {
      if (authWarning) authWarning.hidden = false;
      document.querySelectorAll('#auth-login-form input,#auth-login-form button,#auth-register-form input,#auth-register-form button').forEach(control => control.disabled = true);
      showAuthMessage(authFeedback, 'Le site doit être en HTTPS avant que tu puisses saisir un mot de passe.', 'error');
      return;
    }
    if (authWarning) authWarning.hidden = true;
    document.querySelectorAll('#auth-login-form input,#auth-login-form button,#auth-register-form input,#auth-register-form button').forEach(control => control.disabled = false);
    try { const result = await authRequest('/api/auth/me'); renderAccount(result.account, result.adminSetupAvailable); }
    catch (error) {
      renderAccount(null);
      if (error.code === 'HTTPS_REQUIRED') { if (authWarning) authWarning.hidden = false; }
      else showAuthMessage(authFeedback, error.message, 'error');
    }
  }
  async function submitCredentials(event, mode) {
    event.preventDefault();
    if (!securePage) { showAuthMessage(authFeedback, 'Connexion bloquée : cette page est en HTTP. Utilise la version HTTPS du site.', 'error'); return; }
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
    if (mode === 'register') {
      if (values.password !== values.passwordConfirm) { showAuthMessage(authFeedback, 'Les deux mots de passe ne correspondent pas.', 'error'); return; }
      delete values.passwordConfirm;
    }
    try {
      const result = await authRequest(`/api/auth/${mode}`, 'POST', values);
      const state = await authRequest('/api/auth/me');
      form.reset(); renderAccount(state.account || result.account, state.adminSetupAvailable); showAuthMessage(authFeedback, mode === 'register' ? 'Ton compte est créé et tu es connecté.' : 'Tu es connecté.', 'success');
    } catch (error) { showAuthMessage(authFeedback, error.message, 'error'); }
  }
  loginForm?.addEventListener('submit', event => submitCredentials(event, 'login'));
  registerForm?.addEventListener('submit', event => submitCredentials(event, 'register'));
  document.querySelector('#admin-claim-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const feedback = document.querySelector('#admin-claim-feedback');
    if (!securePage) { showAuthMessage(feedback, 'L’activation administrateur exige HTTPS.', 'error'); return; }
    const code = new FormData(event.currentTarget).get('code');
    try { const result = await authRequest('/api/auth/admin/claim', 'POST', { code }); renderAccount(result.account, false); showAuthMessage(feedback, 'Administration activée. Tu peux maintenant modifier le contenu du site.', 'success'); }
    catch (error) { showAuthMessage(feedback, error.message, 'error'); }
  });
  document.querySelector('#auth-logout')?.addEventListener('click', async () => {
    try { await authRequest('/api/auth/logout', 'POST', {}); renderAccount(null); showAuthMessage(authFeedback, 'Tu es déconnecté.', 'success'); }
    catch (error) { showAuthMessage(authFeedback, error.message, 'error'); }
  });
  document.querySelector('#revoke-other-sessions')?.addEventListener('click',async()=>{
    const feedback=document.querySelector('#sessions-feedback');if(!confirm('Fermer toutes les autres sessions de ton compte ?'))return;
    try{await authRequest('/api/auth/sessions','POST',{});showAuthMessage(feedback,'Les autres appareils ont été déconnectés.','success');refreshSessionList();}
    catch(error){showAuthMessage(feedback,error.message,'error');}
  });
  document.querySelector('#auth-profile-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!securePage) { showAuthMessage(document.querySelector('#profile-feedback'), 'La modification du profil exige HTTPS.', 'error'); return; }
    const displayName = new FormData(event.currentTarget).get('displayName');
    try { const result = await authRequest('/api/auth/profile', 'PATCH', { displayName }); renderAccount(result.account); showAuthMessage(document.querySelector('#profile-feedback'), 'Profil enregistré.', 'success'); }
    catch (error) { showAuthMessage(document.querySelector('#profile-feedback'), error.message, 'error'); }
  });
  document.querySelector('#auth-password-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    if (!securePage) { showAuthMessage(passwordFeedback, 'Le changement de mot de passe exige HTTPS.', 'error'); return; }
    try { const data = Object.fromEntries(new FormData(form).entries()); if (data.newPassword !== data.confirmNewPassword) { showAuthMessage(passwordFeedback, 'Les deux nouveaux mots de passe ne correspondent pas.', 'error'); return; } await authRequest('/api/auth/password', 'PATCH', { currentPassword: data.currentPassword, newPassword: data.newPassword }); form.reset(); showAuthMessage(passwordFeedback, 'Mot de passe changé. Les autres sessions ont été fermées.', 'success'); }
    catch (error) { showAuthMessage(passwordFeedback, error.message, 'error'); }
  });

  document.querySelector('#admin-copy-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, feedback = document.querySelector('#admin-copy-feedback');
    if (!securePage) { showAuthMessage(feedback, 'L’administration exige HTTPS.', 'error'); return; }
    const copy = Object.fromEntries([...form.querySelectorAll('[name]')].map(input => [input.name, input.value]));
    try { siteContent = await authRequest('/api/admin/site-content', 'PUT', { copy }); applyCopy(siteContent.copy); renderSiteBlocks(siteContent.blocks); renderAdminCopy(siteContent); renderAdminBlocks(siteContent.blocks); showAuthMessage(feedback, 'Les textes du site sont enregistrés.', 'success'); }
    catch (error) { showAuthMessage(feedback, error.message, 'error'); }
  });
  const blockForm = document.querySelector('#admin-block-form'), blockType = blockForm?.elements.type, blockLink = document.querySelector('#admin-link-field');
  const blockPanel = document.querySelector('#admin-block-panel');
  const platformField=document.querySelector('#admin-platform-field');
  document.querySelector('#editor-modify-element')?.addEventListener('click',()=>{
    const block=siteContent?.blocks?.find(item=>item.id===editorSelectedElement?.dataset.siteBlockId);if(!block||!blockForm)return;
    blockForm.dataset.editId=block.id;for(const key of ['page','type','platform','icon','title','text','url'])if(blockForm.elements[key])blockForm.elements[key].value=block[key]||'';
    updateBlockFormFields();blockForm.querySelector('[type="submit"]').textContent='Enregistrer les modifications';document.querySelector('#admin-block-cancel').hidden=false;blockPanel.hidden=false;blockPanel.scrollIntoView({behavior:'smooth',block:'center'});
  });
  document.querySelector('#editor-copy-element')?.addEventListener('click',()=>{
    editorCopiedElement=snapshotSelectedElement();const paste=document.querySelector('#editor-paste-element'),feedback=document.querySelector('#editor-copy-feedback');if(paste)paste.disabled=!editorCopiedElement;
    if(feedback)showAuthMessage(feedback,editorCopiedElement?'Élément copié. Tu peux le coller sur une page pour en faire une copie modifiable.':'Sélectionne d’abord une section.','success');
  });
  document.querySelector('#editor-paste-element')?.addEventListener('click',async()=>{
    if(!editorCopiedElement||!blockForm||editorPage==='global')return;
    const source=editorCopiedElement;
    if(source.type==='fragment'){
      const payload={...source,page:editorPage,title:`Copie — ${source.title||'Section'}`.slice(0,80),group:editorPage==='home'&&source.group==='portal'?'portal':'root',afterKey:source.page===editorPage?source.afterKey:''};
      try{siteContent=await authRequest('/api/admin/site-content/blocks','POST',payload);renderSiteBlocks(siteContent.blocks);renderAdminBlocks(siteContent.blocks);renderEditorPreview();showAuthMessage(document.querySelector('#editor-copy-feedback'),'Section dupliquée avec sa mise en page. Clique ensuite sur un texte de la copie pour le modifier.','success');}
      catch(error){showAuthMessage(document.querySelector('#editor-copy-feedback'),error.message,'error');}return;
    }
    blockForm.reset();delete blockForm.dataset.editId;blockForm.elements.page.value=editorPage;blockForm.elements.type.value=source.type||'card';blockForm.elements.icon.value=source.icon||'✦';blockForm.elements.title.value=`Copie — ${source.title||'Nouvel élément'}`.slice(0,80);blockForm.elements.text.value=source.text||'';blockForm.elements.url.value=source.type==='link'?source.url||'':'';if(blockForm.elements.platform)blockForm.elements.platform.value=editorPage==='harbor'?source.platform||'':'';
    if(blockType)blockType.dispatchEvent(new Event('change'));blockForm.querySelector('[type="submit"]').textContent='Ajouter la copie au site ＋';document.querySelector('#admin-block-cancel').hidden=true;blockPanel.hidden=false;blockPanel.scrollIntoView({behavior:'smooth',block:'center'});blockForm.elements.title.focus();
    const feedback=document.querySelector('#editor-copy-feedback');if(feedback)showAuthMessage(feedback,'Copie prête : modifie son titre ou son texte, puis ajoute-la à la page.','success');
  });
  document.querySelectorAll('[data-editor-add]').forEach(button => button.addEventListener('click', () => {
    if (!blockForm || editorPage === 'global') return;
    blockForm.reset(); delete blockForm.dataset.editId; blockForm.elements.page.value = editorPage; blockForm.elements.type.value = button.dataset.editorAdd;
    blockForm.elements.icon.value = button.dataset.editorAdd === 'card' ? '✦' : button.dataset.editorAdd === 'note' ? '💡' : '↗';
    blockForm.querySelector('[type="submit"]').textContent = 'Ajouter à la page ＋'; document.querySelector('#admin-block-cancel').hidden = true;
    if (blockType) blockType.dispatchEvent(new Event('change')); blockPanel.hidden = false; blockPanel.scrollIntoView({behavior:'smooth',block:'center'}); blockForm.elements.title.focus();
  }));
  let siteFileUploadXhr=null;
  document.querySelector('#editor-file-cancel')?.addEventListener('click',()=>siteFileUploadXhr?.abort());
  document.querySelector('#editor-file-upload')?.addEventListener('change', async event => {
    const input=event.currentTarget,file=input.files?.[0],feedback=document.querySelector('#editor-file-feedback'),requestedPlatform=input.dataset.platform||'',targetPage=editorPage;delete input.dataset.platform;if(!file)return;
    if(targetPage==='global'){if(feedback)feedback.textContent='Choisis d’abord la page du projet.';input.value='';return;}
    if(file.size>10*1024*1024*1024){if(feedback)feedback.textContent='Ce fichier dépasse la limite de 10 Go.';input.value='';return;}
    const transfer=document.querySelector('#editor-file-transfer'),progress=document.querySelector('#editor-file-progress'),progressLabel=document.querySelector('#editor-file-progress-label'),cancelButton=document.querySelector('#editor-file-cancel');
    if(transfer)transfer.hidden=false;if(progress){progress.value=0;progress.removeAttribute('value');}if(progressLabel)progressLabel.textContent='Préparation de l’envoi…';if(cancelButton)cancelButton.disabled=false;if(input)input.disabled=true;if(feedback)feedback.textContent=`Envoi de « ${file.name} »…`;
    try {
      const data=await new Promise((resolve,reject)=>{
        const xhr=new XMLHttpRequest();siteFileUploadXhr=xhr;xhr.open('POST',`/api/admin/site-files?name=${encodeURIComponent(file.name)}`);xhr.setRequestHeader('content-type','application/octet-stream');
        xhr.upload.addEventListener('progress',event=>{if(!event.lengthComputable)return;const percent=Math.min(100,Math.round(event.loaded/event.total*100));if(progress){progress.max=100;progress.value=percent;}if(progressLabel)progressLabel.textContent=`${percent} % · ${formatFileSize(event.loaded)} sur ${formatFileSize(event.total)}`;});
        xhr.addEventListener('load',()=>{let result={};try{result=JSON.parse(xhr.responseText||'{}');}catch{}if(xhr.status>=200&&xhr.status<300)resolve(result);else reject(new Error(result.error||`Envoi impossible (${xhr.status})`));});
        xhr.addEventListener('error',()=>reject(new Error('Connexion interrompue pendant l’envoi. Réessaie quand la connexion sera stable.')));xhr.addEventListener('abort',()=>reject(new Error('Envoi annulé. Le fichier ne sera pas ajouté à la page.')));xhr.send(file);
      });
      if(!blockForm)throw new Error('Formulaire d’ajout indisponible.');
      const ext=file.name.toLowerCase(),platform=requestedPlatform||(/\.(dmg|pkg)$/.test(ext)?'macos':/\.(appimage|deb|rpm|tar\.gz)$/.test(ext)?'linux':/\.(exe|msi|msix)$/.test(ext)?'windows':'');
      blockForm.reset();delete blockForm.dataset.editId;blockForm.elements.page.value=platform?'harbor':targetPage;blockForm.elements.type.value='link';blockForm.elements.icon.value='⬇';blockForm.elements.title.value=platform?`Harbor Launcher — ${platform==='macos'?'macOS':platform==='linux'?'Linux':'Windows'}`:file.name.slice(0,80);blockForm.elements.text.value='Télécharger Harbor Launcher.';blockForm.elements.url.value=data.url;if(blockForm.elements.platform)blockForm.elements.platform.value=platform;
      if(blockType)blockType.dispatchEvent(new Event('change'));blockForm.querySelector('[type="submit"]').textContent='Ajouter le téléchargement ＋';document.querySelector('#admin-block-cancel').hidden=true;blockPanel.hidden=false;blockPanel.scrollIntoView({behavior:'smooth',block:'center'});blockForm.elements.title.focus();
      if(feedback)feedback.textContent=`Fichier envoyé (${formatFileSize(file.size)}). Vérifie le titre, puis clique sur « Ajouter le téléchargement » pour le publier sur la page.`;
    } catch(error){if(feedback)feedback.textContent=error.message;}
    finally{siteFileUploadXhr=null;if(input){input.disabled=false;input.value='';}if(cancelButton)cancelButton.disabled=true;if(transfer)transfer.hidden=true;}
  });
  function formatFileSize(bytes){if(!Number.isFinite(bytes)||bytes<0)return'0 octet';const units=['octets','Ko','Mo','Go'],index=Math.min(Math.floor(Math.log(bytes||1)/Math.log(1024)),units.length-1);return`${(bytes/1024**index).toFixed(index===0?0:1)} ${units[index]}`;}
  const fileDrop=document.querySelector('#editor-file-drop');
  fileDrop?.addEventListener('dragover',event=>{event.preventDefault();fileDrop.classList.add('drag-over');});
  fileDrop?.addEventListener('dragleave',event=>{if(!fileDrop.contains(event.relatedTarget))fileDrop.classList.remove('drag-over');});
  fileDrop?.addEventListener('drop',event=>{event.preventDefault();fileDrop.classList.remove('drag-over');const input=document.querySelector('#editor-file-upload');if(!input||!event.dataTransfer?.files?.length)return;input.files=event.dataTransfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
  function updateBlockFormFields(){const isLink=blockType?.value==='link',isHarbor=blockForm?.elements.page.value==='harbor';if(blockLink)blockLink.hidden=!isLink;if(blockForm?.elements.url)blockForm.elements.url.required=Boolean(isLink);if(platformField)platformField.hidden=!(isLink&&isHarbor);if(blockForm?.elements.platform&&!(isLink&&isHarbor))blockForm.elements.platform.value='';}
  blockType?.addEventListener('change',updateBlockFormFields);blockForm?.elements.page.addEventListener('change',updateBlockFormFields);
  blockForm?.addEventListener('submit', async event => {
    event.preventDefault(); const feedback = document.querySelector('#admin-block-feedback');
    if (!securePage) { showAuthMessage(feedback, 'L’administration exige HTTPS.', 'error'); return; }
    const values = Object.fromEntries(new FormData(blockForm).entries());
    const editId = blockForm.dataset.editId, endpoint = editId ? `/api/admin/site-content/blocks/${encodeURIComponent(editId)}` : '/api/admin/site-content/blocks';
    try { siteContent = await authRequest(endpoint, editId ? 'PATCH' : 'POST', values); renderSiteBlocks(siteContent.blocks); renderAdminBlocks(siteContent.blocks); renderEditorPreview(); blockForm.reset(); delete blockForm.dataset.editId; blockForm.querySelector('[type="submit"]').textContent = 'Ajouter au site ＋'; const cancel = document.querySelector('#admin-block-cancel'); if (cancel) cancel.hidden = true; blockForm.elements.icon.value = '✦'; if (blockType) blockType.dispatchEvent(new Event('change')); showAuthMessage(document.querySelector('#editor-feedback'), editId ? 'Élément modifié.' : 'Élément ajouté à la page.', 'success'); }
    catch (error) { showAuthMessage(feedback, error.message, 'error'); }
  });
  document.querySelector('#admin-block-list')?.addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit-block]');
    if (editButton) { const block = siteContent?.blocks?.find(item => item.id === editButton.dataset.editBlock); if (!block || !blockForm) return; blockForm.dataset.editId = block.id; for (const key of ['page','type','platform','icon','title','text','url']) if(blockForm.elements[key])blockForm.elements[key].value = block[key] || ''; updateBlockFormFields(); blockForm.querySelector('[type="submit"]').textContent = 'Enregistrer les modifications'; const cancel = document.querySelector('#admin-block-cancel'); if (cancel) cancel.hidden = false; blockForm.scrollIntoView({ behavior:'smooth', block:'center' }); return; }
    const button = event.target.closest('[data-delete-block]'); if (!button) return;
    try { siteContent = await authRequest(`/api/admin/site-content/blocks/${encodeURIComponent(button.dataset.deleteBlock)}`, 'DELETE'); if (blockForm?.dataset.editId === button.dataset.deleteBlock) document.querySelector('#admin-block-cancel')?.click(); renderSiteBlocks(siteContent.blocks); renderAdminBlocks(siteContent.blocks); renderEditorPreview(); showAuthMessage(document.querySelector('#admin-block-feedback'), 'Bloc supprimé.', 'success'); }
    catch (error) { showAuthMessage(document.querySelector('#admin-block-feedback'), error.message, 'error'); }
  });
  document.querySelector('#editor-blocks-list')?.addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit-block]');
    if (editButton) { const block=siteContent?.blocks?.find(item=>item.id===editButton.dataset.editBlock); if (!block || !blockForm) return; blockForm.dataset.editId=block.id; for (const key of ['page','type','platform','icon','title','text','url']) if(blockForm.elements[key])blockForm.elements[key].value=block[key]||''; updateBlockFormFields(); blockForm.querySelector('[type="submit"]').textContent='Enregistrer les modifications'; document.querySelector('#admin-block-cancel').hidden=false; blockPanel.hidden=false; blockPanel.scrollIntoView({behavior:'smooth',block:'center'}); return; }
    const moveButton=event.target.closest('[data-move-block]');
    if (moveButton) { const ordered=[...(siteContent?.blocks||[])], peers=ordered.map((item,index)=>item.page===editorPage?index:-1).filter(index=>index>=0), index=ordered.findIndex(item=>item.id===moveButton.dataset.moveBlock), position=peers.indexOf(index), next=peers[position+(moveButton.dataset.direction==='up'?-1:1)]; if(index<0||next===undefined)return; [ordered[index],ordered[next]]=[ordered[next],ordered[index]]; try { siteContent=await authRequest('/api/admin/site-content/blocks/order','PUT',{ids:ordered.map(item=>item.id)}); renderSiteBlocks(siteContent.blocks); renderAdminBlocks(siteContent.blocks); renderEditorPreview(); } catch(error) { showAuthMessage(document.querySelector('#editor-feedback'),error.message,'error'); } return; }
    const remove=event.target.closest('[data-delete-block]'); if (!remove || !window.confirm('Supprimer cet élément ?')) return;
    try { const oldBlock=siteContent?.blocks?.find(item=>item.id===remove.dataset.deleteBlock); siteContent=await authRequest(`/api/admin/site-content/blocks/${encodeURIComponent(remove.dataset.deleteBlock)}`,'DELETE'); if(oldBlock?.url?.startsWith('/site-downloads/')&&!siteContent.blocks.some(item=>item.url===oldBlock.url)){const name=oldBlock.url.slice('/site-downloads/'.length);await authRequest(`/api/admin/site-files?name=${encodeURIComponent(decodeURIComponent(name))}`,'DELETE');} renderSiteBlocks(siteContent.blocks); renderAdminBlocks(siteContent.blocks); renderEditorPreview(); showAuthMessage(document.querySelector('#editor-feedback'),'Élément supprimé.','success'); }
    catch(error) { showAuthMessage(document.querySelector('#editor-feedback'),error.message,'error'); }
  });
  document.querySelector('#admin-block-cancel')?.addEventListener('click', () => { if (!blockForm) return; blockForm.reset(); delete blockForm.dataset.editId; blockForm.querySelector('[type="submit"]').textContent = 'Ajouter au site ＋'; document.querySelector('#admin-block-cancel').hidden = true; blockForm.elements.icon.value = '✦'; if (blockType) blockType.dispatchEvent(new Event('change')); });
  refreshAuthState();

  function renderPack(pack) {
    const card = document.createElement('article'); card.className = 'pack-card';
    const banner = document.createElement('div'); banner.className = 'pack-banner';
    const sigil = document.createElement('span'); sigil.className = 'pack-sigil'; sigil.textContent = (pack.name || '?').trim().slice(0, 1).toUpperCase(); banner.append(sigil);
    const info = document.createElement('div'); info.className = 'pack-info';
    const title = document.createElement('h3'); title.textContent = pack.name || 'Modpack';
    const desc = document.createElement('p'); desc.className = 'pack-desc'; desc.textContent = pack.description || 'Un nouveau monde à découvrir avec Harbor Launcher.';
    const tags = document.createElement('div'); tags.className = 'tags';
    for (const label of [`Minecraft ${pack.mc || '?'}`, String(pack.loader || 'vanilla'), `${pack.modCount || 0} mod${pack.modCount === 1 ? '' : 's'}`]) {
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = label; tags.append(tag);
    }
    info.append(title, desc, tags); card.append(banner, info); return card;
  }
  function setPackGrid(grid, packs) {
    if (!grid) return;
    grid.replaceChildren();
    if (!packs.length) { const empty = document.createElement('div'); empty.className = 'loading-card'; empty.textContent = 'Les premiers modpacks arrivent bientôt.'; grid.append(empty); return; }
    packs.forEach(pack => grid.append(renderPack(pack)));
  }
  async function loadSiteInfo() {
    const grids = [document.querySelector('#pack-grid'), document.querySelector('#catalogue-grid')];
    try {
      const response = await fetch('/api/site/info', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); const packs = Array.isArray(data.packs) ? data.packs : [];
      publishedDownloads=data.release?.downloads||{};publishedReleaseVersion=data.release?.version||'';
      const count = `${packs.length} modpack${packs.length === 1 ? '' : 's'}`;
      const packCount = document.querySelector('#pack-count'); if (packCount) packCount.textContent = count;
      const catalogueCount = document.querySelector('#catalogue-count'); if (catalogueCount) catalogueCount.textContent = packs.length;
      setPackGrid(grids[0], packs.slice(0, 6)); setPackGrid(grids[1], packs);
      const download = document.querySelector('#download-button'); const version = document.querySelector('#release-version');
      const windowsDownload=document.querySelector('#platform-download-windows');
      if (data.release?.downloadUrl) { if(download){download.href=data.release.downloadUrl;download.removeAttribute('aria-disabled');}if(windowsDownload){windowsDownload.href=data.release.downloadUrl;windowsDownload.removeAttribute('aria-disabled');windowsDownload.setAttribute('download','');} }
      if (version && data.release?.version) version.textContent = `Version ${data.release.version}`;
      if(data.release?.version){const status=document.querySelector('#platform-status-windows');if(status)status.textContent=`Version ${data.release.version}`;}
      renderPlatformDownloads();
    } catch {
      for (const id of ['pack-count', 'catalogue-count']) { const node = document.getElementById(id); if (node) node.textContent = 'Indisponible'; }
      grids.forEach(grid => { if (grid) { grid.replaceChildren(); const error = document.createElement('div'); error.className = 'loading-card'; error.textContent = 'Impossible de charger le catalogue pour le moment.'; grid.append(error); } });
      const version = document.querySelector('#release-version'); if (version) version.textContent = 'Téléchargement direct · version 0.2.3';
    }
  }
  document.querySelector('#refresh-packs')?.addEventListener('click', loadSiteInfo);
  loadSiteInfo();

  function updateScrollChrome() {
    const doc = document.documentElement; const max = doc.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = `${max > 0 ? Math.min(100, window.scrollY / max * 100) : 0}%`;
    topButton?.classList.toggle('visible', window.scrollY > 420);
  }
  window.addEventListener('scroll', updateScrollChrome, { passive: true });
  topButton?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  const revealNodes = [...document.querySelectorAll('.zone-card,.info-card,.bot-card,.detail-hero,.note-panel,.about-profile,.contact-card,.pack-card')];
  revealNodes.forEach((node, index) => { node.classList.add('ng-reveal'); node.style.setProperty('--ng-d', `${index % 4 * 65}ms`); });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('ng-visible'); observer.unobserve(entry.target); } }), { threshold: .12 });
    revealNodes.forEach(node => observer.observe(node));
  } else revealNodes.forEach(node => node.classList.add('ng-visible'));
  updateScrollChrome();
})();
