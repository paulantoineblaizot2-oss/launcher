(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const byId = id => document.getElementById(id);
  const listNode = byId('document-list'), welcome = byId('welcome-view'), editor = byId('editor-view');
  const docView = byId('document-stage'), slideView = byId('presentation-workspace'), sheetView = byId('spreadsheet-workspace');
  const toolbar = byId('document-toolbar'), docTitle = byId('document-title'), editorLabel = byId('editor-kind-label');
  const localKey = 'mavie-office-documents-v1';
  const labels = { document: 'DOCUMENT', presentation: 'PRÉSENTATION', spreadsheet: 'TABLEUR' };
  const icons = { document: 'W', presentation: 'P', spreadsheet: '▦' };
  const state = { documents: [], currentId: null, current: null, currentKind:'document', recentlyOpened:{}, cloudFiles:[], loggedIn: false, account: null, selectedCell: 'A1', activeSlide: 0, saveTimer: null, toastTimer: null, restoring: false, saving: new Map(), saveAgain: new Set(), deleted: new Set() };
  const recentStorageKey=()=>`${localKey}-recent-${state.account?.id||'local'}`;
  const typeLabels={document:'Documents',presentation:'Présentations',spreadsheet:'Tableurs'};
  const compatibleExtensions={document:new Set(['docx','txt','md','html','htm','json']),presentation:new Set(['pptx']),spreadsheet:new Set(['xlsx','csv'])};
  const maxOfficeFileBytes=25*1024*1024;
  const fileExtension=name=>(String(name).split('.').pop()||'').toLowerCase();
  const formatBytes=value=>{if(value<1024)return`${value} o`;const units=['Ko','Mo','Go'];let n=value/1024,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return`${n.toFixed(n>=10?0:1)} ${units[i]}`;};

  function toast(message, error = false) {
    const node = byId('toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('show');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
  }
  function readLocal() { try { const docs = JSON.parse(localStorage.getItem(localKey) || '[]'); return Array.isArray(docs) ? docs : []; } catch { return []; } }
  function writeLocal() { try { localStorage.setItem(localKey, JSON.stringify(state.documents.filter(doc => !doc.server))); } catch { toast('Le stockage local du navigateur est plein.', true); } }
  function makeDocument(type) {
    const id = crypto.randomUUID();
    const content = type === 'document' ? { html: '<h1>Nouveau document</h1><p>Commence à écrire ici…</p>' } :
      type === 'presentation' ? { slides: [{ title: 'Une nouvelle idée', body: 'Ajoute ici les points importants de ta présentation.' }] } : { cells: { A1: 'Mon tableau', A2: 'Exemple', B1: 'Valeur', B2: '1' } };
    return { id, type, title: type === 'document' ? 'Sans titre' : type === 'presentation' ? 'Présentation sans titre' : 'Tableur sans titre', content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), server: false };
  }
  function localize(doc) { return { ...doc, server: false }; }
  async function api(path, method = 'GET', body = undefined) {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {}; try { data = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(data.error || `Erreur ${response.status}`); error.status = response.status; throw error; }
    return data;
  }
  async function initialize() {
    try {
      const result = await api('/api/auth/me'); state.account = result.account; state.loggedIn = Boolean(result.account);
      byId('account-status').textContent = result.account ? result.account.displayName : 'Session locale';
      byId('account-status').previousElementSibling.classList.toggle('ok', Boolean(result.account));
    } catch { byId('account-status').textContent = 'Mode hors ligne'; }
    const local = readLocal();
    if (state.loggedIn) {
      try {
        const remote = await api('/api/office/docs');
        const merged = new Map(remote.documents.map(doc => [doc.id, { ...doc, server: true }]));
        for (const doc of local) if (!merged.has(doc.id)) merged.set(doc.id, localize(doc));
        state.documents = [...merged.values()];
      } catch (error) { state.documents = local; toast(error.message, true); }
    } else state.documents = local;
    try{state.recentlyOpened=JSON.parse(localStorage.getItem(recentStorageKey())||'{}')||{};}catch{state.recentlyOpened={};}
    renderList();
    const params = new URLSearchParams(location.search); const id = params.get('doc');
    if (id && state.documents.some(doc => doc.id === id)) await openDocument(id);
    else await showLibrary('document');
    const cloudFile=params.get('cloudFile');if(cloudFile){if(!state.loggedIn){toast('Connecte-toi pour modifier un fichier Havre.',true);return;}await openCloudFile(cloudFile,params.get('name')||'Document',params.get('folder')||'');}
  }
  async function openCloudFile(id,name,folder){
    try{const existing=state.documents.find(doc=>doc.server&&doc.cloudSource?.fileId===id);if(existing){await openDocument(existing.id);toast('Document Havre rouvert. Les prochaines sauvegardes mettront à jour son fichier d’origine.');return;}const ext=name.split('.').pop().toLowerCase();if(!['docx','pptx','xlsx'].includes(ext))throw Error('Suite Horizon ouvre les fichiers Word, PowerPoint et Excel (.docx, .pptx, .xlsx).');const response=await fetch(`/api/cloud/files/${encodeURIComponent(id)}`,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Impossible de télécharger ce fichier depuis Havre.');const blob=await response.blob();if(blob.size>maxOfficeFileBytes)throw Error('Suite Horizon accepte les fichiers Office jusqu’à 25 Mo.');const file=new File([blob],name,{type:blob.type||'application/octet-stream'});await importFile(file,{fileId:id,name,folder,format:ext});history.replaceState(null,'',`${location.pathname}?cloudFile=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder)}`);}
    catch(error){toast(error.message||'Ouverture impossible.',true);}
  }
  function renderList() {
    if (!state.documents.length) { listNode.innerHTML = '<p class="muted tiny">Tes nouveaux fichiers apparaîtront ici.</p>'; return; }
    listNode.replaceChildren();
    for (const doc of [...state.documents].sort((a, b) => (Number(state.recentlyOpened[b.id])||Date.parse(b.updatedAt)||0)-(Number(state.recentlyOpened[a.id])||Date.parse(a.updatedAt)||0))) {
      const button = document.createElement('button'); button.className = `recent-doc${doc.id === state.currentId ? ' current' : ''}`; button.dataset.id = doc.id;
      const icon = document.createElement('span'); icon.className = 'recent-doc-icon'; icon.textContent = icons[doc.type] || 'W';
      const name = document.createElement('span'); name.className = 'recent-doc-label'; name.textContent = doc.title || 'Sans titre';
      button.append(icon, name); button.addEventListener('click', () => openDocument(doc.id)); listNode.append(button);
    }
  }
  async function openDocument(id) {
    if(state.currentId&&state.currentId!==id){clearTimeout(state.saveTimer);serializeCurrent();void saveDocument(state.currentId);}
    let doc = state.documents.find(item => item.id === id); if (!doc) return;
    if (doc.server && state.loggedIn) { try { doc = { ...await api(`/api/office/docs/${encodeURIComponent(id)}`), server: true }; Object.assign(state.documents.find(item => item.id === id), doc); } catch (error) { toast(error.message, true); return; } }
    state.currentId = id; state.current = doc; state.currentKind=doc.type;state.recentlyOpened[id]=Date.now();try{localStorage.setItem(recentStorageKey(),JSON.stringify(state.recentlyOpened));}catch{}state.activeSlide = 0; state.restoring = true;
    document.querySelectorAll('.app-nav-item').forEach(item=>item.classList.toggle('active',item.dataset.kind===doc.type));
    welcome.hidden = true; editor.hidden = false; docTitle.value = doc.title || 'Sans titre'; editorLabel.textContent = labels[doc.type];
    const isDoc = doc.type === 'document', isSlide = doc.type === 'presentation';
    docView.hidden = !isDoc; toolbar.hidden = !isDoc; slideView.hidden = !isSlide; sheetView.hidden = doc.type !== 'spreadsheet';
    if (isDoc) byId('rich-editor').innerHTML = safeEditorHtml(doc.content?.html || '<p><br></p>');
    if (isSlide) renderSlides();
    if (doc.type === 'spreadsheet') renderSheet();
    byId('save-state').innerHTML = `<i class="${doc.server ? 'saved' : ''}"></i> ${doc.server ? 'Enregistré' : 'Sur cet appareil'}`;
    history.replaceState(null, '', `${location.pathname}?doc=${encodeURIComponent(id)}`); renderList();renderRecentFiles();state.restoring = false;
  }
  async function showLibrary(kind,refreshFiles=true){
    if(!['document','presentation','spreadsheet'].includes(kind))kind='document';
    if(state.current){clearTimeout(state.saveTimer);serializeCurrent();await saveCurrent();}
    state.current=null;state.currentId=null;state.currentKind=kind;editor.hidden=true;welcome.hidden=false;history.replaceState(null,'',location.pathname);
    document.querySelectorAll('.app-nav-item').forEach(item=>item.classList.toggle('active',item.dataset.kind===kind));
    byId('library-title').innerHTML=`${typeLabels[kind]} <em>et fichiers.</em>`;
    byId('library-description').textContent=`Reprends un fichier ouvert récemment ou choisis un fichier compatible depuis Havre.`;
    byId('compatible-description').textContent=`Formats pris en charge ici : ${[...compatibleExtensions[kind]].map(ext=>`.${ext}`).join(', ')} · 25 Mo maximum par fichier.`;
    renderRecentFiles();
    const container=byId('compatible-files-grid');container.innerHTML='<p class="library-empty">Chargement des fichiers Havre…</p>';
    if(!state.loggedIn){container.innerHTML='<p class="library-empty">Connecte-toi pour voir les fichiers de Havre. <a href="/#account">Ouvrir la connexion →</a></p>';byId('compatible-count').textContent='—';return;}
    if(refreshFiles){try{const result=await api('/api/cloud/list?all=1');state.cloudFiles=result.files||[];}catch(error){container.textContent=`Impossible de charger Havre : ${error.message}`;byId('compatible-count').textContent='—';return;}}
    renderCompatibleFiles();
  }
  function renderRecentFiles(){
    const container=byId('recent-files-grid');if(!container)return;container.replaceChildren();
    const recent=[...state.documents].sort((a,b)=>(Number(state.recentlyOpened[b.id])||Date.parse(b.updatedAt)||0)-(Number(state.recentlyOpened[a.id])||Date.parse(a.updatedAt)||0)).slice(0,12);
    byId('recent-count').textContent=`${recent.length} fichier${recent.length===1?'':'s'}`;
    if(!recent.length){container.innerHTML='<p class="library-empty">Aucun document récent. Crée ou ouvre un fichier pour le retrouver ici.</p>';return;}
    for(const doc of recent){const card=document.createElement('button');card.className='library-file-card';card.type='button';const icon=document.createElement('span');icon.className=`library-file-icon ${doc.type}`;icon.textContent=icons[doc.type]||'W';const details=document.createElement('span');details.className='library-file-details';const title=document.createElement('b');title.textContent=doc.title||'Sans titre';const meta=document.createElement('small');meta.textContent=`${typeLabels[doc.type]||'Fichier'} · Ouvert ${new Date(Number(state.recentlyOpened[doc.id])||Date.parse(doc.updatedAt)||Date.now()).toLocaleDateString('fr-FR')}`;details.append(title,meta);card.append(icon,details);card.onclick=()=>openDocument(doc.id);container.append(card);}
  }
  function renderCompatibleFiles(){
    const container=byId('compatible-files-grid');container.replaceChildren();const accepted=compatibleExtensions[state.currentKind];const files=state.cloudFiles.filter(file=>accepted.has(fileExtension(file.name))).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    byId('compatible-count').textContent=`${files.length} fichier${files.length===1?'':'s'}`;
    if(!files.length){container.innerHTML='<p class="library-empty">Aucun fichier compatible trouvé dans Havre.</p>';return;}
    for(const file of files){const card=document.createElement('article');card.className='library-file-card cloud';const ext=fileExtension(file.name);const icon=document.createElement('span');icon.className=`library-file-icon ${state.currentKind}`;icon.textContent=icons[state.currentKind]||'W';const details=document.createElement('span');details.className='library-file-details';const title=document.createElement('b');title.textContent=file.name;const folder=document.createElement('small');folder.textContent=`${file.folder||'Mes fichiers'} · ${formatBytes(file.size)}`;details.append(title,folder);const open=document.createElement('button');open.className='primary small';open.type='button';open.textContent=file.size>maxOfficeFileBytes?'Trop volumineux':'Ouvrir';open.disabled=file.size>maxOfficeFileBytes;open.title=open.disabled?'Suite Horizon accepte actuellement les fichiers jusqu’à 25 Mo.':'Ouvrir dans Suite Horizon';open.onclick=()=>void openCompatibleFile(file);card.append(icon,details,open);container.append(card);}
  }
  async function openCompatibleFile(file){
    try{const ext=fileExtension(file.name);if(['docx','pptx','xlsx'].includes(ext)){await openCloudFile(file.id,file.name,file.folder||'');return;}const response=await fetch(`/api/cloud/files/${encodeURIComponent(file.id)}`,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Impossible de lire ce fichier depuis Havre.');const blob=await response.blob();const source=new File([blob],file.name,{type:file.mime||blob.type||'application/octet-stream'});await importFile(source);}
    catch(error){toast(error.message||'Ouverture impossible.',true);}
  }
  function safeEditorHtml(html) {
    const template = document.createElement('template'); template.innerHTML = String(html).slice(0, 400000);
    template.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form,svg,video,audio').forEach(node => node.remove());
    const allowed=new Set('P DIV SPAN BR HR PRE H1 H2 H3 H4 H5 H6 BLOCKQUOTE UL OL LI STRONG B EM I U S STRIKE DEL SUB SUP TABLE THEAD TBODY TR TD TH A IMG FONT'.split(' '));
    template.content.querySelectorAll('*').forEach(node => {
      if(!allowed.has(node.tagName)){node.replaceWith(...node.childNodes);return;}
      for(const attr of [...node.attributes]){
        const key=attr.name.toLowerCase(),value=attr.value.trim();
        if(key==='style'){
          const safe=[];for(const rule of value.split(';')){const [prop,...rest]=rule.split(':');const name=prop?.trim().toLowerCase(),val=rest.join(':').trim();if(['color','background-color','font-family','font-size','font-weight','font-style','text-decoration','text-align','vertical-align','border','border-collapse','padding','width','height','max-width'].includes(name)&&val.length<100&&!/[<>\\]/.test(val)&&!/(url|expression|javascript)/i.test(val))safe.push(`${name}:${val}`)}
          if(safe.length)node.setAttribute('style',safe.join(';'));else node.removeAttribute('style');
        }else if(key==='href'){if(!/^(https?:\/\/|mailto:|tel:|#)/i.test(value))node.removeAttribute(attr.name);}
        else if(key==='src'){if(!/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,|\/)/i.test(value))node.removeAttribute(attr.name);}
        else if(key==='face'&&node.tagName==='FONT'&&/^[\w "'-]{1,60}$/.test(value)){}
        else if(key==='color'&&node.tagName==='FONT'&&/^#[0-9a-f]{6}$/i.test(value)){}
        else if(key==='size'&&node.tagName==='FONT'&&/^[1-7]$/.test(value)){}
        else if(!['alt','title','colspan','rowspan','width','height'].includes(key))node.removeAttribute(attr.name);
      }
    });
    return template.innerHTML;
  }
  function updateWordCount(){const text=byId('rich-editor').innerText.trim();const words=text?text.split(/\s+/).length:0;byId('doc-count').textContent=`${words} mot${words===1?'':'s'} · ${text.length} caractères`;}
  async function showOfficeHistory(){if(!state.loggedIn||!state.current?.server){toast('Connecte-toi et enregistre le document en ligne pour voir ses sauvegardes.',true);return;}try{const data=await api(`/api/office/docs/${state.current.id}/history`);if(!data.versions.length){toast('Aucune sauvegarde antérieure pour le moment.');return;}const choices=data.versions.map((v,i)=>`${i+1}. ${new Date(v.savedAt).toLocaleString('fr-FR')} — ${v.title}`).join('\n');const pick=prompt(`Choisis une version à restaurer :\n${choices}\n\nSaisis son numéro.`);if(!pick)return;const version=data.versions[Number(pick)-1];if(!version){toast('Numéro de version invalide.',true);return;}if(!confirm(`Restaurer « ${version.title} » ? Le contenu actuel sera lui aussi sauvegardé.`))return;await api(`/api/office/docs/${state.current.id}/history/restore`,'POST',{versionId:version.id});const refreshed=await api(`/api/office/docs/${state.current.id}`);Object.assign(state.current,refreshed,{server:true});openDocument(state.current.id);toast('Version restaurée.');}catch(error){toast(error.message,true);}}
  function scheduleSave() {
    if (!state.current || state.restoring) return;
    clearTimeout(state.saveTimer); byId('save-state').innerHTML = '<i class="saving"></i> Enregistrement automatique…';
    state.saveTimer = setTimeout(saveCurrent, 700);
  }
  function serializeCurrent(doc = state.current) {
    if (!doc) return null;
    if (doc.type === 'document') doc.content.html = safeEditorHtml(byId('rich-editor').innerHTML);
    else if (doc.type === 'presentation' && doc.id === state.currentId) {
      const slide = doc.content.slides[state.activeSlide]; if (slide) { slide.title = byId('slide-title').value; slide.body = byId('slide-body').value; }
    }
    if(doc.id===state.currentId)doc.title = docTitle.value.trim() || 'Sans titre';
    doc.updatedAt = new Date().toISOString();
    return { id: doc.id, type: doc.type, title: doc.title, content: doc.content };
  }
  async function saveDocument(id) {
    const doc=state.documents.find(item=>item.id===id);if(!doc||state.deleted.has(id))return;
    if(state.currentId===id)serializeCurrent(doc);
    if(state.saving.has(id)){state.saveAgain.add(id);await state.saving.get(id);return;}
    const payload={id:doc.id,type:doc.type,title:doc.title,content:doc.content,cloudSource:doc.cloudSource||null};
    const operation=(async()=>{
      if(state.loggedIn){const saved=await api(doc.server?`/api/office/docs/${encodeURIComponent(id)}`:'/api/office/docs',doc.server?'PUT':'POST',payload);Object.assign(doc,saved,{server:true});if(doc.cloudSource){await syncCloudSource(doc);if(state.currentId===id)byId('save-state').innerHTML='<i class="saved"></i> Enregistré dans Havre';}else if(state.currentId===id)byId('save-state').innerHTML='<i class="saved"></i> Enregistré en ligne';writeLocal();}
      else{writeLocal();if(state.currentId===id)byId('save-state').innerHTML='<i class="saving"></i> Sur cet appareil';}
      renderList();
    })();
    state.saving.set(id,operation);
    let succeeded=false;try{await operation;succeeded=true;}catch(error){if(state.currentId===id)byId('save-state').innerHTML='<i></i> Non enregistré';toast(error.message,true);}finally{state.saving.delete(id);}
    if(state.saveAgain.has(id)&&!state.deleted.has(id)){state.saveAgain.delete(id);return saveDocument(id);}
    return succeeded;
  }
  async function syncCloudSource(doc){
    const format=doc.cloudSource.format;if(!['docx','pptx','xlsx'].includes(format))throw Error('Format Office de Havre invalide.');
    const response=await fetch(`/api/office/export?format=${format}`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({document:{id:doc.id,type:doc.type,title:doc.title,content:doc.content}})});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'La création du fichier Office a échoué.');}
    const blob=await response.blob();const uploadResponse=await fetch('/api/cloud/upload',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':blob.type||'application/octet-stream','X-File-Name':encodeURIComponent(doc.cloudSource.name),'X-Cloud-Folder':encodeURIComponent(doc.cloudSource.folder||''),'X-File-Id':doc.cloudSource.fileId},body:blob});
    if(!uploadResponse.ok){const data=await uploadResponse.json().catch(()=>({}));throw Error(data.error||`La sauvegarde dans Havre a échoué (${uploadResponse.status}).`);}
  }
  async function saveCurrent() { if(state.current) return saveDocument(state.current.id); return false; }
  async function saveNow(){if(!state.current){toast('Ouvre ou crée un document avant de l’enregistrer.',true);return;}const id=state.current.id;clearTimeout(state.saveTimer);const pending=state.saving.get(id);if(pending)await pending; if(state.current?.id!==id)return;serializeCurrent();const ok=await saveDocument(id);if(ok)toast(state.loggedIn?'Document enregistré sur le serveur.':'Document enregistré sur cet appareil.');}
  function create(type) {
    if (type !== 'document' && type !== 'presentation' && type !== 'spreadsheet') return;
    const doc = makeDocument(type); state.documents.unshift(doc); state.current = doc; state.currentId = doc.id; writeLocal(); renderList(); openDocument(doc.id).then(() => { if (state.loggedIn) saveCurrent(); else if(!sessionStorage.getItem('mavie-office-login-prompted')){sessionStorage.setItem('mavie-office-login-prompted','1');byId('login-dialog').showModal();} });
  }
  function renderSlides() {
    if (!state.current || state.current.type !== 'presentation') return;
    const slides = state.current.content.slides; if (!slides.length) slides.push({ title: '', body: '' });
    const index = Math.min(state.activeSlide, slides.length - 1); state.activeSlide = index;
    const slide = slides[index]; byId('slide-title').value = slide.title || ''; byId('slide-body').value = slide.body || '';
    byId('slide-position').textContent = `Diapositive ${index + 1} / ${slides.length}`;
    const list = byId('slide-list'); list.replaceChildren();
    slides.forEach((item, i) => { const button = document.createElement('button'); button.className = `slide-thumb${i === index ? ' active' : ''}`; button.innerHTML = `<span>DIAPOSITIVE ${i + 1}</span><b></b>`; button.querySelector('b').textContent = item.title || 'Sans titre'; button.addEventListener('click', () => { captureSlide(); state.activeSlide = i; renderSlides(); }); list.append(button); });
    byId('previous-slide').disabled = index === 0; byId('next-slide').disabled = index === slides.length - 1; byId('move-slide-up').disabled=index===0; byId('move-slide-down').disabled=index===slides.length-1;
    byId('slide-canvas').setAttribute('aria-label', `Diapositive ${index + 1} : ${slide.title || 'sans titre'}`);
  }
  function captureSlide() { if (!state.current || state.current.type !== 'presentation') return; const slide = state.current.content.slides[state.activeSlide]; if (slide) { slide.title = byId('slide-title').value; slide.body = byId('slide-body').value; } }
  function colName(index) { let name = ''; for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + ((index - 1) % 26)) + name; return name; }
  function parseCell(ref) { const match = /^([A-Z]+)(\d+)$/i.exec(ref); if (!match) return null; let col = 0; for (const ch of match[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64; return { col: col - 1, row: Number(match[2]) - 1 }; }
  function cellValue(ref) {
    const cells=state.current?.content?.cells||{};
    return window.HorizonSheet.evaluate(cells,ref);
  }
  function renderSheet() {
    if (!state.current || state.current.type !== 'spreadsheet') return;
    const table = byId('sheet-grid'); table.replaceChildren(); const cols = 12, rows = 30;
    const thead = document.createElement('thead'), head = document.createElement('tr'), corner = document.createElement('th'); corner.className = 'row-head'; corner.textContent = ''; head.append(corner);
    for (let c=0;c<cols;c++){const th=document.createElement('th');th.textContent=colName(c);head.append(th);} thead.append(head); table.append(thead);
    const tbody=document.createElement('tbody');
    for(let r=0;r<rows;r++){const tr=document.createElement('tr'),th=document.createElement('th');th.className='row-head';th.textContent=String(r+1);tr.append(th);
      for(let c=0;c<cols;c++){const ref=`${colName(c)}${r+1}`,td=document.createElement('td'),input=document.createElement('input'),raw=String(state.current.content.cells[ref]??'');input.dataset.cell=ref;input.autocomplete='off';input.spellcheck=false;input.value=raw.startsWith('=')?String(cellValue(ref)):raw;input.classList.toggle('calculated',raw.startsWith('='));input.title=raw.startsWith('=')?raw:'';td.append(input);td.dataset.cell=ref;tr.append(td);}tbody.append(tr);}
    table.append(tbody); setSelectedCell(state.selectedCell);
  }
  function setSelectedCell(ref) { state.selectedCell=ref; byId('active-cell-name').textContent=ref; const input=document.querySelector(`#sheet-grid input[data-cell="${CSS.escape(ref)}"]`); byId('formula-input').value=state.current?.content.cells[ref] ?? ''; document.querySelectorAll('.sheet-grid td.selected').forEach(td=>td.classList.remove('selected'));input?.closest('td')?.classList.add('selected'); }
  function updateSheetCell(ref, value) { if (!state.current || state.current.type !== 'spreadsheet') return; state.current.content.cells[ref]=value; renderSheet(); setSelectedCell(ref); scheduleSave(); }
  function escapeHtml(text) { return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function download(name, type, content) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function downloadBlob(name, blob) { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function exportCurrent() {
    if (!state.current) return; const item = serializeCurrent(), base = (item.title || 'document').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90) || 'document';
    if (state.loggedIn) {
      try {
        await saveCurrent();
        const format = { document:'docx', presentation:'pptx', spreadsheet:'xlsx' }[item.type];
        const response = await fetch(`/api/office/export?format=${format}`, { method:'POST', credentials:'same-origin', headers:{'content-type':'application/json'}, body:JSON.stringify({document:item}) });
        if (!response.ok) { const error = await response.json().catch(()=>({})); throw new Error(error.error||'Export impossible.'); }
        const file = await response.blob(); let name = `${base}.${format}`;
        const disposition = response.headers.get('content-disposition')||'', encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition); if(encoded)try{name=decodeURIComponent(encoded[1]);}catch{}
        downloadBlob(name,file); toast(`Fichier .${format} téléchargé.`); return;
      } catch (error) { toast(error.message||'Export impossible.',true); return; }
    }
    if (item.type === 'document') {
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(item.title)}</title><style>body{max-width:800px;margin:50px auto;padding:20px;font:17px/1.7 Georgia,serif;color:#202838}h1,h2,h3{font-family:Arial,sans-serif}</style></head><body>${safeEditorHtml(item.content.html)}</body></html>`;
      download(`${base}.html`, 'text/html;charset=utf-8', html);
    } else if (item.type === 'presentation') {
      const slides = item.content.slides.map((slide,i)=>`<section><small>${i+1} / ${item.content.slides.length}</small><h1>${escapeHtml(slide.title)}</h1><p>${escapeHtml(slide.body).replace(/\n/g,'<br>')}</p></section>`).join('');
      download(`${base}.html`, 'text/html;charset=utf-8', `<!doctype html><html lang="fr"><meta charset="utf-8"><title>${escapeHtml(item.title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#111827;color:white;font:20px Arial}section{display:none;width:100vw;height:100vh;padding:12vw 14vw;background:linear-gradient(130deg,#12423e,#19263d 65%,#422745)}section:first-of-type{display:block}h1{font-size:clamp(35px,7vw,84px)}p{font-size:clamp(19px,3vw,32px);line-height:1.5}small{color:#eac563}</style><body>${slides}<script>let i=0,s=[...document.querySelectorAll('section')];onkeydown=e=>{if(e.key==='ArrowRight'||e.key===' '){s[i].style.display='none';i=(i+1)%s.length;s[i].style.display='block'}if(e.key==='ArrowLeft'){s[i].style.display='none';i=(i-1+s.length)%s.length;s[i].style.display='block'}}</script></body></html>`);
    } else {
      const rows=30,cols=12,quote=value=>{const s=String(value??'');return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
      const csv=Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>{const ref=`${colName(c)}${r+1}`,raw=String(item.content.cells[ref]??'');return quote(raw.startsWith('=')?cellValue(ref):raw);}).join(',')).join('\r\n'); download(`${base}.csv`,'text/csv;charset=utf-8;header=present',`\uFEFF${csv}`);
    }
    toast('Fichier préparé et téléchargé.');
  }
  function parseCsv(text) { const rows=[];let row=[],value='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"')quoted=false;else value+=c;}else if(c==='"')quoted=true;else if(c===','||c===';'){row.push(value);value='';}else if(c==='\n'){row.push(value.replace(/\r$/,''));rows.push(row);row=[];value='';}else value+=c;}row.push(value.replace(/\r$/,''));if(row.length>1||row[0]!=='')rows.push(row);return rows; }
  async function importFile(file,cloudSource=null) {
    if(file.size>maxOfficeFileBytes)throw Error('Suite Horizon accepte les fichiers Office jusqu’à 25 Mo.');
    const ext=file.name.split('.').pop().toLowerCase();
    if(['docx','pptx','xlsx'].includes(ext)){
      if(!state.loggedIn){byId('login-dialog').showModal();throw Error('Connecte-toi pour importer un fichier Word, PowerPoint ou Excel.');}
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
      const parsed=await api(`/api/office/import?format=${ext}`,'POST',{name:file.name,file:btoa(binary)});
      const doc={...makeDocument(parsed.type),title:parsed.title,content:parsed.content,...(cloudSource?{cloudSource}: {})};state.documents.unshift(doc);writeLocal();renderList();await openDocument(doc.id);scheduleSave();toast(cloudSource?`Fichier ouvert depuis Havre · les modifications y seront sauvegardées.`:`Fichier .${ext} importé.`);return;
    }
    if(!['csv','txt','md','html','htm','json'].includes(ext))throw Error('Formats acceptés : Word (.docx), PowerPoint (.pptx), Excel (.xlsx), texte (.txt, .md, .html, .json) et tableur (.csv).');
    const text=await file.text();
    if(ext==='csv') { const rows=parseCsv(text.replace(/^\uFEFF/,''));const cells={};rows.slice(0,30).forEach((row,r)=>row.slice(0,12).forEach((value,c)=>{if(value!=='')cells[`${colName(c)}${r+1}`]=value;}));const doc=makeDocument('spreadsheet');doc.title=file.name.replace(/\.csv$/i,'');doc.content={cells};state.documents.unshift(doc);writeLocal();renderList();openDocument(doc.id);scheduleSave(); }
    else if(ext==='json') { const data=JSON.parse(text);if(data&&['document','presentation','spreadsheet'].includes(data.type)&&data.content){const doc={...makeDocument(data.type),title:String(data.title||file.name).slice(0,120),content:data.content};state.documents.unshift(doc);writeLocal();renderList();openDocument(doc.id);scheduleSave();}else{const doc=makeDocument('document');doc.title=file.name.replace(/\.json$/i,'');doc.content={html:`<pre>${escapeHtml(JSON.stringify(data,null,2))}</pre>`};state.documents.unshift(doc);writeLocal();renderList();openDocument(doc.id);scheduleSave();} }
    else { const doc=makeDocument('document');doc.title=file.name.replace(/\.(txt|md|html?)$/i,'');const safe=ext==='html'||ext==='htm'?safeEditorHtml(text):`<p>${escapeHtml(text).replace(/\r?\n/g,'<br>')}</p>`;doc.content={html:safe};state.documents.unshift(doc);writeLocal();renderList();openDocument(doc.id);scheduleSave(); }
    toast('Fichier importé dans Suite Horizon.');
  }
  async function deleteCurrent() {
    if(!state.current||!confirm(`Supprimer « ${state.current.title} » ? Cette action ne peut pas être annulée.`))return;
    const doc=state.current;clearTimeout(state.saveTimer);state.deleted.add(doc.id);state.saveAgain.delete(doc.id);await state.saving.get(doc.id)?.catch(()=>{});
    if(doc.server&&state.loggedIn){try{await api(`/api/office/docs/${encodeURIComponent(doc.id)}`,'DELETE');}catch(error){state.deleted.delete(doc.id);toast(error.message,true);return;}}
    state.documents=state.documents.filter(item=>item.id!==doc.id);writeLocal();state.current=null;state.currentId=null;state.deleted.delete(doc.id);editor.hidden=true;welcome.hidden=false;history.replaceState(null,'',location.pathname);renderList();toast('Document supprimé.');
  }
  document.querySelectorAll('[data-create]').forEach(button=>button.addEventListener('click',()=>create(button.dataset.create)));
  byId('new-document').addEventListener('click',()=>create(document.querySelector('.app-nav-item.active')?.dataset.kind||'document'));
  document.querySelectorAll('.app-nav-item').forEach(button=>button.addEventListener('click',()=>void showLibrary(button.dataset.kind)));
  byId('refresh-documents').addEventListener('click',initialize);
  docTitle.addEventListener('input',scheduleSave);
  byId('rich-editor').addEventListener('input',scheduleSave);
  let editorRange=null;
  byId('rich-editor').addEventListener('keyup',rememberRange);byId('rich-editor').addEventListener('mouseup',rememberRange);
  function rememberRange(){const selection=getSelection();if(selection?.rangeCount&&byId('rich-editor').contains(selection.anchorNode))editorRange=selection.getRangeAt(0).cloneRange();updateWordCount();}
  function focusEditor(){const node=byId('rich-editor');node.focus();if(editorRange){const selection=getSelection();selection.removeAllRanges();selection.addRange(editorRange);}}
  toolbar.addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
  toolbar.addEventListener('click',event=>{const button=event.target.closest('[data-command]');if(button){focusEditor();document.execCommand(button.dataset.command,false,null);rememberRange();scheduleSave();}});
  byId('block-style').addEventListener('change',event=>{focusEditor();document.execCommand('formatBlock',false,`<${event.target.value}>`);rememberRange();scheduleSave();});
  byId('font-family').addEventListener('change',event=>{focusEditor();document.execCommand('fontName',false,event.target.value.replaceAll("'",''));scheduleSave();});
  byId('font-size').addEventListener('change',event=>{focusEditor();document.execCommand('fontSize',false,event.target.value);scheduleSave();});
  byId('text-color').addEventListener('input',event=>{focusEditor();document.execCommand('foreColor',false,event.target.value);scheduleSave();});
  byId('highlight-color').addEventListener('input',event=>{focusEditor();const ok=document.execCommand('hiliteColor',false,event.target.value);if(!ok)document.execCommand('backColor',false,event.target.value);scheduleSave();});
  byId('insert-link').addEventListener('click',()=>{const url=prompt('Adresse du lien (https://, mailto: ou tel:) :');if(!url)return;if(!/^(https?:\/\/|mailto:|tel:)/i.test(url)){toast('Utilise un lien https://, mailto: ou tel:.',true);return;}focusEditor();document.execCommand('createLink',false,url);scheduleSave();});
  byId('insert-table').addEventListener('click',()=>{const dimensions=prompt('Taille du tableau (lignes x colonnes), par exemple 3x3 :','3x3');const match=/^\s*(\d{1,2})\s*[x×,]\s*(\d{1,2})\s*$/i.exec(dimensions||'');if(!match)return;const rows=Math.min(20,Number(match[1])),cols=Math.min(12,Number(match[2]));if(rows<1||cols<1){toast('Taille de tableau invalide.',true);return;}const html=`<table style="border-collapse:collapse;width:100%"><tbody>${Array.from({length:rows},()=>`<tr>${Array.from({length:cols},()=>'<td style="border:1px solid #999;padding:6px"><br></td>').join('')}</tr>`).join('')}</tbody></table><p><br></p>`;focusEditor();document.execCommand('insertHTML',false,html);scheduleSave();});
  byId('insert-image').addEventListener('click',()=>byId('image-file').click());
  byId('image-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>1024*1024){toast('Pour éviter de remplir ton espace, une image ne peut pas dépasser 1 Mo.',true);event.target.value='';return;}const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});focusEditor();document.execCommand('insertHTML',false,`<img src="${data}" alt="${escapeHtml(file.name)}" style="max-width:100%;height:auto">`);scheduleSave();event.target.value='';});
  byId('find-text').addEventListener('click',()=>{const query=prompt('Texte à rechercher dans le document :');if(!query)return;byId('rich-editor').focus();if(!window.find(query))toast('Aucune occurrence trouvée.');});
  byId('show-history').addEventListener('click',showOfficeHistory);
  byId('rich-editor').addEventListener('input',updateWordCount);
  byId('add-slide').addEventListener('click',()=>{captureSlide();state.current.content.slides.push({title:'Nouvelle diapositive',body:''});state.activeSlide=state.current.content.slides.length-1;renderSlides();scheduleSave();});
  byId('duplicate-slide').addEventListener('click',()=>{captureSlide();const slide=state.current.content.slides[state.activeSlide];state.current.content.slides.splice(state.activeSlide+1,0,{...slide,title:(slide.title||'Diapositive')+' — copie'});state.activeSlide++;renderSlides();scheduleSave();toast('Diapositive dupliquée.');});
  byId('delete-slide').addEventListener('click',()=>{captureSlide();const slides=state.current.content.slides;if(slides.length===1){slides[0]={title:'',body:''};}else{slides.splice(state.activeSlide,1);state.activeSlide=Math.min(state.activeSlide,slides.length-1);}renderSlides();scheduleSave();toast('Diapositive supprimée.');});
  for(const [id,step] of [['move-slide-up',-1],['move-slide-down',1]])byId(id).addEventListener('click',()=>{captureSlide();const slides=state.current.content.slides,to=state.activeSlide+step;if(to<0||to>=slides.length)return;[slides[state.activeSlide],slides[to]]=[slides[to],slides[state.activeSlide]];state.activeSlide=to;renderSlides();scheduleSave();});
  for(const id of ['slide-title','slide-body'])byId(id).addEventListener('input',()=>{captureSlide();const label=byId('slide-list').children[state.activeSlide]?.querySelector('b');if(label)label.textContent=byId('slide-title').value||'Sans titre';scheduleSave();});
  byId('previous-slide').addEventListener('click',()=>{captureSlide();state.activeSlide=Math.max(0,state.activeSlide-1);renderSlides();});
  byId('next-slide').addEventListener('click',()=>{captureSlide();state.activeSlide=Math.min(state.current.content.slides.length-1,state.activeSlide+1);renderSlides();});
  byId('sheet-grid').addEventListener('focusin',event=>{const input=event.target.closest('[data-cell]');if(input)setSelectedCell(input.dataset.cell);});
  byId('sheet-grid').addEventListener('click',event=>{const input=event.target.closest('[data-cell]');if(input)setSelectedCell(input.dataset.cell);});
  byId('sheet-grid').addEventListener('change',event=>{const input=event.target.closest('[data-cell]');if(input)updateSheetCell(input.dataset.cell,input.value);});
  byId('sheet-grid').addEventListener('input',event=>{const input=event.target.closest('[data-cell]');if(input&&state.current?.type==='spreadsheet'){state.current.content.cells[input.dataset.cell]=input.value;scheduleSave();}});
  byId('sheet-grid').addEventListener('keydown',event=>{if(event.key==='Enter'){const input=event.target.closest('[data-cell]');if(input){event.preventDefault();const p=parseCell(input.dataset.cell);const next=`${colName(p.col)}${Math.min(30,p.row+2)}`;updateSheetCell(input.dataset.cell,input.value);document.querySelector(`#sheet-grid input[data-cell="${CSS.escape(next)}"]`)?.focus();}}});
  byId('formula-input').addEventListener('input',event=>{const input=document.querySelector(`#sheet-grid input[data-cell="${CSS.escape(state.selectedCell)}"]`);if(input)input.value=event.target.value;if(state.current?.type==='spreadsheet'){state.current.content.cells[state.selectedCell]=event.target.value;scheduleSave();}});
  byId('formula-input').addEventListener('change',event=>updateSheetCell(state.selectedCell,event.target.value));
  byId('export-file').addEventListener('click',()=>exportCurrent());
  byId('import-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(file){try{await importFile(file);}catch(error){toast(error.message||'Impossible d’importer ce fichier.',true);}finally{event.target.value='';}}});
  byId('delete-document').addEventListener('click',deleteCurrent);
  byId('close-login').addEventListener('click',()=>byId('login-dialog').close());
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&!event.altKey){event.preventDefault();event.stopPropagation();void saveNow();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&state.current&&byId('save-state').textContent.includes('Enregistrement automatique')){clearTimeout(state.saveTimer);serializeCurrent();void saveCurrent();}});
  addEventListener('beforeunload',()=>{if(state.current){clearTimeout(state.saveTimer);serializeCurrent();writeLocal();}});
  initialize();
})();
