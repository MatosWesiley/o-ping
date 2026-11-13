(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
    bulletin:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    agenda:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-12 4h2m3 0h2"/>',
    map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
    network:'<path d="M3 9a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0"/><circle cx="12" cy="21" r=".5"/>',
    star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    plus:'<path d="M12 4v16M4 12h16"/>',pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    storage:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    building:'<path d="M4 21V5l8-2v18M12 8h8v13M2 21h20M7 7v1m0 3v1m0 3v1m9-4h1m-1 4h1"/>',
    bed:'<path d="M3 18V8m18 10v-7H3m0 5h18M5 8h5v3M3 18v3m18-3v3"/>',
    sync:'<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    close:'<path d="m18 6-12 12M6 6l12 12"/>',
    edit:'<path d="m15 5 4 4M4 20l4-.8L19 8a2.8 2.8 0 0 0-4-4L4 15z"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    chevron:'<path d="m9 18 6-6-6-6"/>'
  };
  const icon = n => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+(paths[n] || paths.info)+'</svg>';
  const isNative = typeof window.EventoNative !== 'undefined' ||
    (window.location.protocol === 'file:' && window.PING_PREVIEW !== true) ||
    window.location.hostname === 'appassets.androidplatform.net';
  const initial = {
    event:'',eventName:'Evento',server:'',records:[],routes:{},favorites:[],outbox:[],nearby:false,peers:0,
    online:'unconfigured',busy:false,lastSync:0,status:'Configure o servidor do evento para sincronizar.',ping:null,
    role:'guest',name:'',username:'',teamId:'',requestedRole:'athlete',teams:[],users:[],
    onboardingDone:false,notificationsEnabled:false,trustFingerprint:''
  };
  const demoKey = 'ping-demo-state-v2';
  let state = initial;
  let page = 'home', filter = 'all', mapFilter = 'all', map = null, mapView = null, toastTimer = 0, lastToast = '';
  let tutorialStep = 0, tutorialOpen = false, authMode = 'login', focusBeforeModal = null;

  const now = () => Date.now();
  const fmt = t => t ? new Date(Number(t)).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
  const date = t => t ? new Date(Number(t)).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}) : '';
  const localDate = t => { const d = new Date(t); return new Date(t - d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  const roleLabel = r => ({athlete:'Atleta',coach:'Técnico',organization:'Organização',guest:'Visitante'}[r] || 'Visitante');
  const allRecords = () => Array.isArray(state.records) ? state.records : [];
  const role = () => state.role || 'guest';
  const teams = () => Array.isArray(state.teams) ? state.teams : [];
  const ownTeam = () => teams().find(t => String(t.id) === String(state.teamId)) || null;
  const visible = r => role()==='organization' || r.audience!=='team' || (r.teamId && String(r.teamId)===String(state.teamId));
   function effectiveRecords() {
     const latest=new Map();
     allRecords().forEach(r=>{
       const key=r.replaces||r.id,old=latest.get(key);
       if(!old||Number(r.created)>Number(old.created)||(Number(r.created)===Number(old.created)&&
         ((!!r.replaces&&!old.replaces)||((!!r.replaces===!!old.replaces)&&String(r.id)>String(old.id)))))latest.set(key,r);
     });
     return [...latest.values()].filter(r=>!r.deleted);
   }
   const records = kind => effectiveRecords().filter(r => visible(r) && (kind==='facility' ? (r.kind==='facility'||(!r.kind&&!!r.category)) : (r.kind||'bulletin')===kind)).sort((a,b) => kind==='agenda' ? Number(a.start)-Number(b.start) : Number(b.created)-Number(a.created));
  const active = r => !r.expires || Number(r.expires) > now();
  const canManage = () => role()==='organization';
  const canCoachPublish = () => role()==='coach' && !!state.teamId;
  const canPublish = () => canManage() || canCoachPublish();
  const canEdit = r => ['notice','agenda','bulletin'].includes(r.kind) && (canManage() ||
    (canCoachPublish()&&(r.original||r).author===state.username&&String(r.teamId)===String(state.teamId)));

  function toast(text) {
    if (!text) return;
    const el = $('#toast'); el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4600);
  }
  function send(action, fields={}) {
    if (isNative) {
      try { window.EventoNative.action(JSON.stringify({action,...fields})); }
      catch (e) { toast('Não foi possível enviar a ação ao aplicativo.'); }
      return;
    }
    demoAction(action,fields);
  }
  window.EventoApp = { receive(next) {
    if (!isNative || !next || typeof next !== 'object') return;
    const previousStatus = state.status;
    const previousUser = state.username;
    const previousRole = role();
     const previousMutation = state.mutationVersion || 0;
    state = {...initial,...next};
     if(state.mutationVersion && state.mutationVersion!==previousMutation)closeModal();
    if (previousUser && state.username && previousUser !== state.username) clearTransient();
    if (previousUser && !state.username) clearTransient();
    if (previousRole!==role() && previousRole!=='guest') clearTransient();
    if (previousRole==='guest' && role()!=='guest') closeModal(false);
    if (state.status !== previousStatus &&
        (state.status.startsWith('Alteração confirmada pelo servidor.') ||
         state.status.startsWith('Aviso assinado salvo.'))) closeModal();
    if (!$('#modal').hidden) {
       const attachmentLabel=$('#attachment-label');
       if(attachmentLabel)attachmentLabel.textContent=state.attachment ? state.attachment.name+' · enviado, pronto para publicar' : attachmentLabel.dataset.existing||'Nenhum arquivo selecionado';
      $('#modal').querySelectorAll('form button[type="submit"], form button:not([type])').forEach(button => { button.disabled=!!state.busy; });
      const error=$('#modal .form-error');
      if(error&&state.status&&state.status!==previousStatus) error.textContent=state.status;
    }
    render();
    if (state.status && state.status !== previousStatus && state.status !== lastToast) {
      lastToast = state.status; toast(state.status);
    }
  }};
  window.EventoLocation = function(o) {
    if (!o || !Number.isFinite(Number(o.lat)) || !Number.isFinite(Number(o.lon))) return;
    if (!map) return;
    mapView = {center:[Number(o.lat),Number(o.lon)],zoom:15};
    window.L.circleMarker([o.lat,o.lon],{radius:7,color:'#7028bd',fillOpacity:1}).addTo(map).bindPopup('Sua localização · precisão aproximada de '+Math.round(o.accuracy || 0)+' m').openPopup();
    map.setView([o.lat,o.lon],15);
    const status = $('#map-status'); if (status) status.textContent='Localização obtida · '+fmt(o.time)+' · não compartilhada com participantes.';
  };
  function clearTransient() {
    page='home'; filter='all'; mapFilter='all'; closeModal(false);
  }
  function navigate(p) {
    if (p==='home' && role()==='guest' && !isNative && state.demoRole) p='home';
    page=p; filter='all'; render(); window.scrollTo(0,0);
    if ((p==='teams'&&canManage()) || (p==='team'&&role()!=='guest')) send('refreshTeams');
    if (p==='users' && canManage()) send('refreshUsers');
  }
  function intro(title, subtitle, marker=state.eventName) {
    return '<div class="intro"><div class="eyebrow">'+esc(marker||'Ping')+'</div><h1>'+title+'</h1><p>'+subtitle+'</p></div>';
  }
  function empty(title,text,which='info') {
    return '<div class="empty"><span class="tile-icon">'+icon(which)+'</span><strong>'+title+'</strong>'+text+'</div>';
  }
  function pill(text, cls='') { return '<span class="pill '+cls+'">'+esc(text)+'</span>'; }
  function statusTag() {
    if (state.online==='connected') return pill('Servidor conectado','green');
    if (state.nearby) return pill(state.nearbyAdvertising||state.nearbyDiscovering?'Proximidade ativa':'Proximidade · iniciando');
    return pill('Dados no aparelho','neutral');
  }
  function authorText(r) {
    const who = r.authorName || r.author || '';
    return who ? 'Publicado por '+esc(who) : '';
  }
  function favoriteButton(r) {
    const on=(state.favorites||[]).map(String).includes(String(r.id));
    return '<button class="favorite '+(on?'active':'')+'" data-favorite="'+esc(r.id)+'" aria-label="'+(on?'Remover dos favoritos':'Salvar nos favoritos')+'">'+icon('star')+'</button>';
  }
  function recordCard(r) {
    const kindName=r.kind||'bulletin';
    const dateText=kindName==='agenda' ? 'Até '+fmt(r.end)+' · '+date(r.start) : date(r.created);
    let category = kindName==='notice'?'Aviso':kindName==='bulletin'?'Boletim':kindName==='agenda'?'Atividade':r.category==='lodging'?'Alojamento':'Ginásio';
    const priorityText=!active(r)?'Vencido':r.priority==='emergency'?'Emergência':r.priority==='important'?'Importante':category;
    const cls=r.priority==='emergency'?'red':r.priority==='important'?'amber':'';
    const sector = r.sector || (kindName==='agenda'?'Programação':category);
    let times='';
    if(kindName==='agenda') times='<span class="time-block">'+fmt(r.start)+'<small>'+date(r.start)+'</small></span>';
    const body='<div class="card-title">'+pill(priorityText,cls)+'<h3>'+esc(r.title||sector)+'</h3><p class="small muted">'+esc(r.text||'')+'</p><div class="meta"><span>'+esc(sector)+'</span><span>'+dateText+'</span>'+(r.audience==='team'?'<span>Equipe '+esc(teamName(r.teamId))+'</span>':'')+(authorText(r)?'<span>'+authorText(r)+'</span>':'')+'</div></div>';
    if(kindName==='facility') return '<article class="card place-card"><span class="place-mark">'+icon(r.category==='lodging'?'bed':'building')+'</span><div>'+body+(Number.isFinite(Number(r.lat))&&Number.isFinite(Number(r.lon))?'<div class="card-actions"><button class="route" data-center="'+esc(r.id)+'">'+icon('pin')+' Ver no mapa</button><button class="route" data-route="'+esc(r.id)+'">Abrir rota</button></div>':'')+'</div></article>';
    const attachment=r.attachment?'<button class="secondary" data-attachment="'+esc(r.id)+'">Abrir '+esc(r.attachment.name)+'</button>':'';
    const link=r.link?'<button class="secondary" data-link="'+esc(r.id)+'">Abrir link externo</button>':'';
    const controls=canEdit(r)?'<button class="quiet" data-edit-record="'+esc(r.id)+'">Editar</button><button class="quiet" data-delete-record="'+esc(r.id)+'">Excluir</button>':'';
    return '<article class="card '+(kindName==='agenda'?'agenda-card':'')+'">'+times+body+'<div class="card-actions">'+attachment+link+favoriteButton(r)+controls+'</div></article>';
  }
  function teamCount(t) { return Number(t.memberCount ?? (t.members||[]).length) || 0; }
  function teamName(id) { const t=teams().find(x=>String(x.id)===String(id)); return t ? t.name : 'equipe'; }
  function quickTile(nav, ico, title, note) {
    return '<button class="quick-tile" data-go="'+nav+'"><span class="tile-icon">'+icon(ico)+'</span><strong>'+title+'</strong><small>'+note+'</small></button>';
  }
  function home() {
    const roleNow=role(), live=records('bulletin').filter(active), news=records('notice').filter(active), next=records('agenda').filter(r=>!r.end||Number(r.end)>now());
    const typeHero=roleNow==='organization'?'Sua equipe organiza. O Ping mantém todos no mesmo ritmo.':roleNow==='coach'?'Sua equipe informada, mesmo quando o sinal falha.':'A conexão muda. A informação fica.';
    const copy=roleNow==='organization'?'Publique informações oficiais e acompanhe equipes, inscrições e locais.':roleNow==='coach'?'Compartilhe avisos com sua equipe e consulte a programação do evento.':'Jogos, locais e avisos que seguem com você no evento.';
    let q=[quickTile('agenda','agenda','Agenda','Partidas e atividades'),quickTile('map','map','Alojamentos','Encontre os locais'),quickTile('notices','bell','Avisos','Recados do evento'),quickTile('bulletins','bulletin','Boletins','Informações oficiais')].join('');
    if(roleNow==='organization') q+=quickTile('teams','users','Equipes','Elenco e técnicos');
    if(roleNow==='athlete') q+=quickTile('team','users','Equipes',ownTeam()?esc(ownTeam().name):'Escolha uma equipe');
    if(roleNow==='coach') q+=quickTile('team','users','Minha equipe',ownTeam()?esc(ownTeam().name):'Criar equipe');
    const featured = live.slice(0,1).concat(news.slice(0,1));
    return '<div class="greeting">'+intro(roleNow==='organization'?'Painel do evento':roleNow==='coach'?'Painel da equipe':'Seu evento, por perto.', 'Olá, '+esc(state.name||'participante')+'. '+(roleNow==='athlete'?'Tenha o essencial à mão.':'Seu trabalho continua no ritmo do evento.'),state.eventName) + statusTag()+'</div>'+
      '<section class="hero"><div class="hero-copy"><span class="eyebrow">'+esc(roleLabel(roleNow))+' · '+(state.online==='connected'?'SINCRONIZADO':state.nearby?'PERTO DE VOCÊ':'MODO LOCAL')+'</span><h2>'+typeHero+'</h2><p>'+copy+'</p><button class="primary" data-go="network">'+icon('network')+' Estado da conexão</button></div><svg class="hero-ornament" viewBox="0 0 120 120" aria-hidden="true"><path d="M26 78c18-1 26-15 31-33 7 17 18 23 39 21-10 18-22 28-42 28-13 0-22-6-28-16Zm27-34c6-18 19-28 39-32-3 20-14 32-34 36m3 50 8 17M33 74l-18 2" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></section>'+
      '<section class="section"><div class="grid quick-grid">'+q+'</div></section>'+
      (roleNow==='organization'?'<section class="section"><div class="section-head"><div><h2>Gestão do evento</h2><p class="small muted">Equipes e permissões exigem servidor. Avisos autorizados podem ser enviados por proximidade.</p></div></div><div class="button-row"><button class="primary danger" id="emergency-compose">'+icon('bell')+' Aviso de emergência</button><button class="secondary" data-go="users">'+icon('users')+' Aprovação de contas</button><button class="secondary" data-go="teams">'+icon('building')+' Gerenciar equipes</button></div></section>':'')+
      (roleNow==='coach'?'<section class="section"><div class="section-head"><div><h2>'+esc(ownTeam()?.name||'Equipe não vinculada')+'</h2><p class="small muted">'+(ownTeam()?teamCount(ownTeam())+' atleta(s) na equipe':'Crie sua equipe para publicar avisos e montar o elenco.')+'</p></div></div><div class="button-row"><button class="secondary" data-go="team">'+icon('users')+(ownTeam()?' Elenco':' Criar equipe')+'</button>'+(canCoachPublish()?'<button class="primary" data-compose="notice">'+icon('plus')+' Aviso da equipe</button>':'')+'</div></section>':'')+
      '<section class="section"><div class="section-head"><div><h2>Para acompanhar</h2><p class="small muted">Informações que ficam disponíveis neste aparelho.</p></div><button class="quiet" data-go="bulletins">Ver tudo</button></div>'+(featured.length?featured.map(recordCard).join(''):empty('O evento começa por aqui','Boletins e avisos recebidos aparecem nesta seção.','bulletin'))+'</section>'+
      '<section class="section"><div class="section-head"><div><h2>Próximas atividades</h2><p class="small muted">Agenda oficial do evento</p></div><button class="quiet" data-go="agenda">Agenda completa</button></div>'+(next.length?next.slice(0,2).map(recordCard).join(''):empty('Agenda ainda vazia','Quando a organização publicar atividades, elas ficam disponíveis aqui.','agenda'))+'</section>'+
      '<div class="storage">'+icon('storage')+'<div><strong class="small">'+allRecords().length+' informação(ões) no aparelho</strong><p class="small muted">O conteúdo já recebido pode ser consultado sem internet.</p></div></div>';
  }
  function collection(kind,title,subtitle) {
    let data=records(kind);
    if(filter==='saved') data=data.filter(r=>(state.favorites||[]).map(String).includes(String(r.id))||(state.favorites||[]).includes(r.replaces));
    if(filter==='active') data=data.filter(active);
    if(filter==='upcoming') data=data.filter(r=>!r.end||Number(r.end)>now());
    const filters = kind==='agenda' ? [['all','Todas'],['upcoming','Próximas'],['saved','Favoritas']] : [['all','Todas'],['active','Válidos'],['saved','Favoritos']];
    return intro(title,subtitle)+ '<div class="role-rail">'+filters.map(([id,label])=>'<button class="filter '+(filter===id?'active':'')+'" data-filter="'+id+'">'+label+'</button>').join('')+'</div>'+
      (data.length?data.map(recordCard).join(''):empty(kind==='notice'?'Nenhum aviso disponível':kind==='bulletin'?'Nenhum boletim disponível':'Nenhuma atividade cadastrada',kind==='notice'?'Avisos oficiais e da sua equipe aparecem aqui.':kind==='bulletin'?'A organização publica boletins oficiais do evento.':'A programação aparece quando a organização publicar as atividades.',kind==='agenda'?'agenda':'info'));
  }
  function bulletins() { return collection('bulletin','Boletins','Comunicados da organização e da sua equipe. Abra os anexos com internet para salvá-los no aparelho.'); }
  function notices() { return collection('notice','Avisos','Recados gerais e avisos da equipe vinculada à sua conta.'); }
  function schedule() { return collection('agenda','Agenda e partidas','Horários, locais e atividades publicados pela organização.'); }
  function places() {
    const data=records('facility').filter(active).filter(r=>mapFilter==='all'||r.category===mapFilter);
    return intro('Alojamentos e locais','Consulte os endereços já carregados. O mapa-base depende de internet.')+
      '<div class="role-rail"><button class="filter '+(mapFilter==='all'?'active':'')+'" data-mapfilter="all">Todos</button><button class="filter '+(mapFilter==='lodging'?'active':'')+'" data-mapfilter="lodging">Alojamentos</button><button class="filter '+(mapFilter==='gym'?'active':'')+'" data-mapfilter="gym">Ginásios</button></div>'+
      '<div class="button-row"><button class="secondary" id="my-location">'+icon('pin')+' Minha localização</button><span class="small muted">'+data.length+' local(is)</span></div><div id="map" class="map" aria-label="Mapa de alojamentos e locais"></div><div id="map-status" class="map-info">O mapa-base usa internet; os registros salvos continuam acessíveis offline.</div>'+
      (data.length?data.map(recordCard).join(''):empty('Nenhum local cadastrado','Endereços adicionados pela organização aparecem aqui.','map'));
  }
  function teamPage() {
    if(role()==='coach') {
      const team=ownTeam();
      if(!team) return intro('Minha equipe','Você ainda não tem uma equipe. Cada técnico pode criar uma equipe própria.')+'<div class="card"><button class="primary" id="team-add">'+icon('plus')+' Criar equipe</button>'+(!isNative?'<p class="form-note">Demonstração: a equipe é criada somente neste navegador.</p>':'')+'</div>';
      const roster=team.members||[];
      return intro(esc(team.name),'Elenco e avisos da sua equipe · '+esc(team.sport||'Esporte'))+
        '<div class="button-row"><button class="secondary" data-team-edit="'+esc(team.id)+'">'+icon('edit')+' Editar nome e esporte</button></div>'+
        '<div class="card"><div class="section-head"><div><h2>Elenco</h2><p class="small muted">'+teamCount(team)+' atleta(s) · atletas entram sozinhos pela lista de equipes</p></div><button class="primary" data-member-add="'+esc(team.id)+'">'+icon('plus')+' Adicionar atleta</button></div>'+
        (roster.length?roster.map(m=>memberRow(m,team.id,false)).join(''):empty('Elenco sem atletas','Atletas podem entrar pela lista de equipes, ou você adiciona manualmente quando estiver online.','users'))+'</div>'+
        '<div class="info-strip">'+icon('shield')+'<span>Você só pode manter o elenco da sua equipe e publicar avisos direcionados a ela.</span></div>';
    }
    if(!canManage()) return empty('Acesso restrito','O gerenciamento de equipes está disponível para a organização.','shield');
    const list=teams();
    return intro('Equipes','Cadastre equipes e mantenha o elenco alinhado. Alterações exigem servidor online.')+
      '<div class="section-head"><div><h2>'+list.length+' equipe(s)</h2><p class="small muted">As mudanças são enviadas diretamente ao servidor.</p></div><button class="primary" id="team-add">'+icon('plus')+' Nova equipe</button></div>'+
      (list.length?list.map(teamCard).join(''):empty('Nenhuma equipe cadastrada','Crie a primeira equipe para vincular técnicos e atletas.','users'))+
      '<div class="info-strip">'+icon('info')+'<span>Equipe e elenco não são salvos como alterações offline. Se o servidor estiver indisponível, a tela mostrará a falha retornada pelo aplicativo.</span></div>';
  }
  function teamCard(t) {
    return '<article class="card"><div class="card-top"><div><span class="eyebrow">'+esc(t.sport||'Equipe esportiva')+'</span><h3 style="margin-top:7px">'+esc(t.name)+'</h3><div class="small muted">Técnico: '+esc(t.coach||'Não definido')+' · '+teamCount(t)+' atleta(s)</div></div><div class="row-tools"><button class="icon-button" data-team-edit="'+esc(t.id)+'" aria-label="Editar equipe">'+icon('edit')+'</button><button class="icon-button danger" data-team-delete="'+esc(t.id)+'" aria-label="Excluir equipe">'+icon('trash')+'</button></div></div><div class="section" style="margin-top:14px"><div class="section-head"><h3>Elenco</h3><button class="quiet" data-member-add="'+esc(t.id)+'">Adicionar atleta</button></div>'+
      ((t.members||[]).length?t.members.map(m=>memberRow(m,t.id,true)).join(''):empty('Elenco vazio','Use adicionar atleta para manter a lista atualizada.','users'))+'</div></article>';
  }
  function memberRow(m,teamId,org) {
    return '<div class="list-row"><div class="row-copy"><strong>'+esc(m.number?('#'+m.number+' · '):'')+esc(m.name)+'</strong><small>'+esc(m.position||'Atleta')+(m.username?' · @'+esc(m.username):'')+'</small></div><div class="row-tools"><button class="icon-button" data-member-edit="'+esc(m.id)+'" data-team="'+esc(teamId)+'" aria-label="Editar atleta">'+icon('edit')+'</button><button class="icon-button danger" data-member-delete="'+esc(m.id)+'" data-team="'+esc(teamId)+'" aria-label="Remover atleta">'+icon('trash')+'</button></div></div>';
  }
  function usersPage() {
    if(!canManage()) return empty('Acesso restrito','A aprovação de perfis é exclusiva da organização.','shield');
    const list=Array.isArray(state.users)?state.users:[];
    const pending=list.filter(u=>u.requestedRole&&u.requestedRole!==u.role);
    return intro('Contas e permissões','Atribua funções e equipes aos usuários registrados. Atualizações exigem conexão.')+
      '<div class="section-head"><div><h2>Usuários</h2><p class="small muted">'+list.length+' perfil(is) · '+pending.length+' solicitações de função</p></div><button class="secondary" id="refresh-users">'+icon('sync')+' Atualizar</button></div>'+
      (list.length?list.map(u=>{const requested=u.requestedRole&&u.requestedRole!==u.role;return '<article class="card"><div class="card-top"><div><span class="pill '+(requested?'amber':'neutral')+'">'+(requested?'Solicitou '+esc(roleLabel(u.requestedRole)):'Perfil '+esc(roleLabel(u.role)))+'</span><h3 style="margin-top:8px">'+esc(u.name||u.username)+'</h3><div class="small muted">@'+esc(u.username)+' · '+esc(roleLabel(u.role))+(u.teamId?' · '+esc(teamName(u.teamId)):'')+'</div></div><button class="secondary" data-user-edit="'+esc(u.username)+'">Permissões</button></div></article>';}).join(''):empty('Lista de usuários indisponível','Toque em atualizar para carregar os perfis autorizados pelo servidor.','users'))+
      '<div class="info-strip">'+icon('shield')+'<span>Atletas e técnicos entram sem aprovação. Solicitações de organização são apenas pedidos. Só uma alteração autorizada pelo servidor aplica uma função.</span></div>';
  }
  function personalTeam() {
    const team=ownTeam(), list=teams();
    const cur=team?'<article class="card"><span class="pill green">Sua equipe</span><h3 style="margin-top:8px">'+esc(team.name)+'</h3><div class="small muted">'+esc(team.sport||'Esporte')+' · Técnico: '+esc(team.coach||'Não definido')+' · '+teamCount(team)+' atleta(s)</div>'+((team.members||[]).length?'<div class="section">'+team.members.map(m=>'<div class="list-row"><div class="row-copy"><strong>'+esc(m.number?'#'+m.number+' · ':'')+esc(m.name)+'</strong><small>'+esc(m.position||'Atleta')+'</small></div></div>').join('')+'</div>':'')+'<div class="card-actions"><button class="secondary danger" id="team-leave">Sair da equipe</button></div></article>':empty('Você ainda não está em uma equipe','Escolha uma equipe abaixo para entrar. Não precisa de aprovação.','users');
    const others=list.filter(t=>!team||String(t.id)!==String(team.id));
    return intro('Equipes','Veja as equipes do evento e entre na sua'+(!isNative?' · demonstração local, nada é enviado':''))+cur+
      '<div class="section-head" style="margin-top:22px"><div><h2>Equipes do evento</h2><p class="small muted">'+others.length+' disponível(is)</p></div></div>'+
      (others.length?others.map(t=>'<article class="card"><div class="card-top"><div><span class="eyebrow">'+esc(t.sport||'Equipe esportiva')+'</span><h3 style="margin-top:7px">'+esc(t.name)+'</h3><div class="small muted">Técnico: '+esc(t.coach||'Não definido')+' · '+teamCount(t)+' atleta(s)</div></div><button class="primary" data-team-join="'+esc(t.id)+'">'+(team?'Trocar para esta':'Entrar')+'</button></div></article>').join(''):empty('Nenhuma outra equipe','Quando técnicos criarem equipes, elas aparecem aqui.','users'));
  }
  function network() {
    const connected=state.online==='connected';
    const account=role()==='guest'?'<button class="primary full" id="account">Entrar ou criar conta</button>':'<button class="secondary full" id="account">Minha conta</button>';
    return intro('Rede e aparelho','Acompanhe o servidor, as informações salvas e os recursos de proximidade.')+
      (!isNative?'<section class="network-card"><span class="demo-watermark">PERFIS DE EXEMPLO</span><p class="connection-copy">Alterne entre interfaces demonstrativas. Não são contas reais nem alteram permissões no servidor.</p><div class="demo-role-select"><button class="secondary" data-demo-role="athlete">Atleta</button><button class="secondary" data-demo-role="coach">Técnico</button><button class="secondary" data-demo-role="organization">Organização</button></div></section>':'')+
      '<div class="stats"><div class="stat"><span class="small muted">Resposta do servidor</span><strong>'+(state.ping===null?'—':esc(state.ping)+' <small>ms</small>')+'</strong><small>'+(connected?'Medição recente':'Sem medição')+'</small></div><div class="stat"><span class="small muted">Participantes próximos</span><strong>'+Number(state.peers||0)+'</strong><small>Visíveis agora no app</small></div></div>'+
      '<section class="network-card"><div class="section-head"><div class="network-title">'+icon('sync')+'<h3>Servidor do evento</h3></div>'+pill(connected?'Conectado':state.online==='unconfigured'?'Não configurado':'Indisponível',connected?'green':'neutral')+'</div><p class="connection-copy">'+(state.server?esc(state.server):'Configure o endereço antes de entrar ou sincronizar.')+'</p><div class="button-row"><button id="sync" class="primary" '+(state.busy?'disabled':'')+'>'+icon('sync')+(state.busy?'Sincronizando…':'Sincronizar agora')+'</button><button id="settings" class="secondary">Configurar servidor</button></div><p class="small muted" style="margin:12px 0 0">'+(state.lastSync?'Última sincronização '+date(state.lastSync)+' às '+fmt(state.lastSync):'Ainda sem sincronização registrada.')+'</p></section>'+
      '<section class="network-card"><div class="section-head"><div class="network-title">'+icon('network')+'<h3>Proximidade</h3></div>'+pill(state.nearby?(state.nearbyAdvertising||state.nearbyDiscovering?'Ativa':'Iniciando / tentando novamente'):'Desligada',state.nearby&&(state.nearbyAdvertising||state.nearbyDiscovering)?'green':'neutral')+'</div><p class="connection-copy">Google Nearby Connections. Mantenha Bluetooth, Wi-Fi, localização e o app abertos, com Google Play Services atualizado. Não precisa de internet nem de estar no mesmo roteador para a troca local. Isso não oferece alcance universal.</p>'+(state.nearby?'<p class="small muted">Anúncio: '+(state.nearbyAdvertising?'ativo':'aguardando')+' · Busca: '+(state.nearbyDiscovering?'ativa':'aguardando')+'. Falhas são exibidas abaixo e geram novas tentativas.</p>':'')+'<div class="button-row"><button id="nearby" class="primary">'+(state.nearby?'Desativar proximidade':'Ativar proximidade')+'</button><button id="peer-ping" class="secondary">Testar ping local</button></div></section>'+
      '<section class="network-card"><div class="section-head"><div class="network-title">'+icon('bell')+'<h3>Notificações</h3></div>'+pill(state.notificationsEnabled?'Permissão concedida':'Não ativadas',state.notificationsEnabled?'green':'neutral')+'</div><p class="connection-copy">A permissão só é solicitada quando você toca no botão. Em segundo plano, atualizações online são periódicas (aproximadamente a cada 15 minutos); proximidade funciona somente com o app aberto.</p><div class="button-row"><button id="notifications" class="secondary">'+(state.notificationsEnabled?'Gerenciar permissão':'Ativar notificações')+'</button><button id="test-notification" class="quiet">Enviar notificação de teste</button></div></section>'+
      '<section class="network-card"><div class="avatar-row"><div class="avatar-large">'+icon('user')+'</div><div><h3>'+esc(state.name||'Visitante')+'</h3><div class="small muted">'+(role()==='guest'?'Sem sessão · conteúdo salvo disponível':esc(roleLabel(role()))+' · @'+esc(state.username))+'</div></div></div><div style="margin-top:14px">'+account+'</div></section>'+
      '<div class="storage">'+icon('storage')+'<div><strong class="small">'+allRecords().length+' registros · '+(state.favorites||[]).length+' favoritos</strong><p class="small muted">'+(state.outbox||[]).length+' publicação(ões) aguardando servidor.</p></div></div>'+
      '<section class="section"><button class="secondary full" id="reopen-onboarding">Rever como o Ping funciona</button></section>'+
      '<div class="noticebar status-box" aria-live="polite">'+esc(state.status||'Aguardando estado do aplicativo.')+'</div>';
  }
  function pageContent() {
    const pages={home,bulletins,notices,agenda:schedule,map:places,network,teams:teamPage,team:role()==='coach'?teamPage:personalTeam,users:usersPage};
    return (pages[page]||home)();
  }
  const navForRole = () => {
    const base=[['home','Início','home'],['agenda','Agenda','agenda'],['map','Locais','map'],['notices','Avisos','bell'],['network','Rede','network']];
    if(role()==='coach'||role()==='athlete') base.splice(4,0,['team','Equipe','users']);
    if(role()==='organization') base.splice(4,0,['teams','Equipes','users']);
    return base;
  };
  function render() {
    if(map){ if(page==='map') mapView={center:map.getCenter(),zoom:map.getZoom()}; map.remove(); map=null; }
    const banner=$('#demo-banner'); banner.hidden=isNative;
    const profile=$('#profile'); profile.textContent=(state.name||'P').split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const chip=$('#connection-chip'); chip.textContent=state.online==='connected'?'Servidor online':state.nearby?'Proximidade':'Conteúdo salvo';chip.classList.toggle('online',state.online==='connected');
    if(!state.onboardingDone || tutorialOpen) {
      $('#main').innerHTML=onboarding();
      $('#nav').hidden=true;$('#fab').hidden=true;return;
    }
    $('#nav').hidden=role()==='guest';
    if(role()==='guest' && !isNative) {
      $('#main').innerHTML=guestLanding();
      $('#nav').hidden=true;$('#fab').hidden=true;return;
    }
    if(role()==='guest' && isNative && !state.onboardingDone) {
      $('#main').innerHTML=onboarding();$('#nav').hidden=true;$('#fab').hidden=true;return;
    }
    if(role()==='guest' && isNative) {
      $('#main').innerHTML=guestLanding();$('#nav').hidden=true;$('#fab').hidden=true;return;
    }
    const emergencies=records('notice').filter(r=>active(r)&&r.priority==='emergency');
    $('#main').innerHTML=(emergencies.length&&page!=='notices'?'<aside class="emergency-banner" role="status"><strong>'+icon('bell')+' Comunicado de emergência</strong><h2>'+esc(emergencies[0].title)+'</h2><p>'+esc(emergencies[0].text)+'</p><button class="secondary" data-go="notices">Consultar avisos e validade</button></aside>':'')+pageContent();
    $('#nav').innerHTML=navForRole().map(([id,label,ico])=>'<button data-go="'+id+'" class="'+(page===id?'active':'')+'" '+(page===id?'aria-current="page"':'')+'>'+icon(ico)+label+'</button>').join('');
    const fab=$('#fab');
    const publishPage=(canManage() && ['home','notices','bulletins','agenda','map'].includes(page)) ||
      (canCoachPublish() && ['home','notices','team','bulletins','agenda'].includes(page));
    fab.hidden=!publishPage;
    if(!fab.hidden) {
      const kind=page==='agenda'?'agenda':page==='bulletins'?'bulletin':page==='map'&&canManage()?'facility':page==='notices'||role()==='coach'?'notice':'bulletin';
      fab.dataset.compose=kind;
      fab.innerHTML=icon('plus')+(kind==='agenda'?'Nova atividade':kind==='facility'?'Cadastrar local':kind==='notice'?'Novo aviso':'Novo boletim');
    }
    if(page==='map') initMap();
  }
  function guestLanding() {
    return '<div class="login"><div class="login-hero"><img class="login-logo" src="logo.jpeg" alt="Passarinho roxo do Ping"><strong class="login-name">Ping</strong><span class="login-tag">Seu evento, por perto</span><svg class="login-rings" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="40"/><circle cx="100" cy="100" r="70"/><circle cx="100" cy="100" r="98"/></svg></div><section class="login-card" aria-labelledby="login-title"><span class="eyebrow">Acesso ao evento</span><h1 id="login-title">Jogos, locais e avisos na palma da mão.</h1><p class="lead">Entre com sua conta para acompanhar agenda, boletins e equipes do evento.</p><div class="login-actions"><button class="primary full" id="login-open">Entrar</button><button class="secondary full" id="register-open">Criar conta</button></div><ul class="login-points"><li><span>'+icon('sync')+'</span>O primeiro acesso precisa do servidor do evento.</li><li><span>'+icon('storage')+'</span>Depois, o conteúdo já recebido fica salvo para consultar offline.</li><li><span>'+icon('shield')+'</span>Ao sair da conta, um novo login é exigido.</li></ul></section><div class="login-links"><button class="secondary full" id="guest-settings">Configurar servidor do evento</button><button class="quiet full" id="reopen-onboarding">Como o Ping funciona</button></div></div>';
  }
  const lessonText = [
    ['people','Perfis com responsabilidades','Atletas e técnicos criam conta sem aprovação: atletas escolhem uma equipe, técnicos criam a sua e publicam avisos para ela. Só organização exige aprovação. A organização mantém a programação, os locais e os boletins oficiais.'],
    ['storage','O que já chegou fica salvo','O Ping guarda no aparelho os registros recebidos. Sem internet, consulte essas informações; novas atualizações ainda precisam chegar por um meio disponível.'],
    ['network','Encontre quem está por perto','Bluetooth e Wi-Fi ajudam a encontrar aparelhos compatíveis e comparar os participantes próximos. A troca depende do alcance, permissões e app aberto — não garante comunicação universal sem internet.'],
    ['bell','Escolha quando receber alertas','Notificações nunca são solicitadas sem sua ação. Você pode autorizar depois na tela Rede; a atualização online em segundo plano é periódica.']
  ];
  function onboarding() {
    const [ico,title,desc]=lessonText[tutorialStep]||lessonText[0];
    return '<div class="onboard"><div class="onboard-mark"><img src="logo.jpeg" alt="Passarinho roxo do Ping"><div><strong>Ping</strong><div class="overline">Seu evento, por perto</div></div></div><div class="onboard-card"><span class="eyebrow">ANTES DE COMEÇAR · '+String(tutorialStep+1).padStart(2,'0')+' / 04</span><div class="steps">'+lessonText.map((_,i)=>'<span class="'+(i<=tutorialStep?'active':'')+'"></span>').join('')+'</div><div class="lesson-icon">'+icon(ico)+'</div><h1>'+title+'</h1><p class="lead">'+desc+'</p>'+(tutorialStep===3?'<div class="info-strip">'+icon('bell')+'<span>A permissão é opcional. Toque para solicitar agora ou configure notificações depois.</span></div><button class="secondary full" style="margin-top:12px" id="onboarding-notifications">'+icon('bell')+' Solicitar permissão de notificações</button>':'')+'<div class="button-row" style="margin-top:22px;justify-content:space-between"><button class="quiet" id="tutorial-back" '+(tutorialStep===0?'disabled':'')+'>Voltar</button><button class="primary" id="tutorial-next">'+(tutorialStep===3?'Entendi, continuar':'Continuar')+icon('chevron')+'</button></div><button class="link-button full" id="tutorial-skip">Pular introdução</button></div></div>';
  }
  function settings() {
    modal('Servidor do evento','<form id="settings-form"><div class="field"><label for="server-event-name">Nome do evento</label><input id="server-event-name" name="eventName" maxlength="60" value="'+esc(state.eventName||'')+'" required></div><div class="field"><label for="server-event-code">Código do evento</label><input id="server-event-code" name="event" maxlength="32" pattern="[A-Za-z0-9-]{3,32}" value="'+esc(state.event||'')+'" required><span class="hint">3–32 caracteres: letras, números ou hífen.</span></div><div class="field"><label for="server-url">Endereço do servidor</label><input id="server-url" name="server" type="url" placeholder="https://evento.exemplo.br" value="'+esc(state.server||'')+'"></div><p class="form-note">Use HTTPS na internet. A configuração real será validada pelo aplicativo e pelo servidor.</p><button class="primary full">Salvar configuração</button></form>');
    $('#settings-form').onsubmit=e=>{e.preventDefault();send('settings',Object.fromEntries(new FormData(e.currentTarget)));closeModal();};
  }
  function account() {
    if(role()!=='guest') {
      modal('Minha conta','<div class="avatar-row"><div class="avatar-large">'+icon('user')+'</div><div><h3>'+esc(state.name)+'</h3><div class="small muted">@'+esc(state.username)+' · '+esc(roleLabel(role()))+'</div></div></div>'+(role()==='coach'?'<p class="small muted" style="margin-top:14px">Equipe: '+esc(ownTeam()?.name||'não vinculada')+'</p>':'')+'<div class="info-strip">'+icon('storage')+'<span>Sair encerra sua sessão. Os dados em cache deste aparelho continuam guardados conforme as regras do app.</span></div><button class="secondary danger full" id="logout" style="margin-top:14px">Sair da conta</button>');
      return;
    }
    authMode='login'; authModal();
  }
  function authModal() {
    const register=authMode==='register';
    modal(register?'Criar conta':'Entrar no Ping','<form id="auth-form">'+(register?'<div class="field"><label for="auth-name">Seu nome</label><input id="auth-name" name="name" autocomplete="name" maxlength="60" required></div>':'')+
      '<div class="field"><label for="auth-username">Usuário</label><input id="auth-username" name="username" autocomplete="username" pattern="[a-zA-Z0-9_.-]{3,40}" maxlength="40" required></div>'+
      '<div class="field"><label for="auth-password">Senha</label><input id="auth-password" name="password" type="password" autocomplete="'+(register?'new-password':'current-password')+'" minlength="10" maxlength="128" required></div>'+
      (register?'<div class="field"><label for="requested-role">Função solicitada</label><select id="requested-role" name="requestedRole"><option value="athlete">Atleta</option><option value="coach">Técnico</option><option value="organization">Organização (aguarda aprovação)</option></select><span class="hint">Atleta e técnico ficam ativos na hora. Organização aguarda aprovação do servidor.</span></div>':'')+
      '<p class="form-note">'+(isNative?'A autenticação é validada pelo servidor. Configure o evento em Rede se necessário.':'Esta é uma demonstração: não use senha real. O acesso não autentica em nenhum servidor.')+'</p><div class="form-error" id="auth-error" role="alert"></div><button class="primary full">'+(register?'Criar conta':'Entrar')+'</button></form><button class="link-button full" id="switch-auth">'+(register?'Já tenho conta':'Criar conta')+'</button>'+
      (!isNative?'<div class="info-strip">'+icon('info')+'<span>Na demonstração, entrar não confirma identidade nem envia dados. Os perfis demonstrativos podem ser alternados na tela Rede.</span></div>':''));
    $('#switch-auth').onclick=()=>{authMode=register?'login':'register';authModal();};
    $('#auth-form').onsubmit=e=>{
      e.preventDefault();
      const data=Object.fromEntries(new FormData(e.currentTarget));
      if(!isNative) {
        $('#auth-error').textContent=register?'A criação de contas não está disponível na demonstração. Use um perfil de exemplo na tela Rede.':'Nenhum servidor de autenticação foi contactado na demonstração.';
        return;
      }
      send(register?'register':'login',data);
    };
  }
  function modal(title,html) {
    focusBeforeModal=document.activeElement;
    $('#modal-title').textContent=title; $('#modal-body').innerHTML=html; $('#modal').hidden=false;
    const first=$('#modal input, #modal select, #modal textarea, #modal button'); if(first)first.focus();
  }
  function closeModal(restore=true) {
    $('#modal').hidden=true; $('#modal-body').replaceChildren();
    if(restore&&focusBeforeModal&&focusBeforeModal.isConnected)focusBeforeModal.focus();
  }
  function composer(kind='bulletin', record=null) {
    const edit=!!record?.id, roleNow=role();
    if(roleNow==='athlete'||roleNow==='guest'){toast('Sua conta pode consultar e favoritar conteúdo.');return;}
    if(roleNow==='coach'&&(!canCoachPublish()||!['notice','agenda','bulletin'].includes(kind))){toast('Técnicos publicam apenas para a própria equipe.');return;}
    if(kind==='facility'&&!canManage()){toast('Somente a organização cadastra locais.');return;}
    if(edit&&!canEdit(record)){toast('Você não pode editar esta publicação.');return;}
    if(!['bulletin','notice','agenda','facility'].includes(kind)){toast('Tipo de publicação inválido.');return;}
    if(isNative)send('clearAttachment');
    const selectedTeam=record?.teamId || (roleNow==='coach'?state.teamId:'');
    const defaultStart=now()+3600000, defaultEnd=now()+7200000;
    let additional='';
    if(kind==='agenda') additional='<div class="two"><div class="field"><label for="rec-start">Início</label><input id="rec-start" name="start" type="datetime-local" value="'+localDate(record?.start||defaultStart)+'" required></div><div class="field"><label for="rec-end">Fim</label><input id="rec-end" name="end" type="datetime-local" value="'+localDate(record?.end||defaultEnd)+'" required></div></div>';
    if(kind==='facility') additional='<div class="field"><label for="rec-category">Tipo de local</label><select id="rec-category" name="category"><option value="gym" '+(record?.category==='gym'?'selected':'')+'>Ginásio</option><option value="lodging" '+(record?.category==='lodging'?'selected':'')+'>Alojamento</option></select></div><div class="two"><div class="field"><label for="rec-lat">Latitude</label><input id="rec-lat" name="lat" type="number" min="-90" max="90" step="any" value="'+esc(record?.lat||'')+'" required></div><div class="field"><label for="rec-lon">Longitude</label><input id="rec-lon" name="lon" type="number" min="-180" max="180" step="any" value="'+esc(record?.lon||'')+'" required></div></div>';
    if(kind==='notice') {
      const teamOptions=roleNow==='coach'?'<option value="'+esc(ownTeam()?.id||'')+'" selected>'+esc(ownTeam()?.name||'Minha equipe')+'</option>':teams().map(t=>'<option value="'+esc(t.id)+'" '+(String(selectedTeam)===String(t.id)?'selected':'')+'>'+esc(t.name)+'</option>').join('');
      additional='<div class="field"><label for="rec-audience">Público</label><select id="rec-audience" name="audience" '+(roleNow==='coach'?'disabled':'')+'><option value="all" '+(!selectedTeam?'selected':'')+'>Todo o evento</option><option value="team" '+(selectedTeam?'selected':'')+'>Uma equipe</option></select></div>'+
        (roleNow==='coach'?'<input type="hidden" name="audience" value="team"><input type="hidden" name="teamId" value="'+esc(ownTeam()?.id||'')+'">':'<div id="team-select-wrap" class="field" '+(!selectedTeam?'hidden':'')+'><label for="rec-team">Equipe</label><select id="rec-team" name="teamId">'+teamOptions+'</select></div>')+
        (roleNow==='organization'?'<div class="field"><label for="rec-priority">Prioridade</label><select id="rec-priority" name="priority"><option value="normal">Normal</option><option value="important" '+(record?.priority==='important'?'selected':'')+'>Importante</option><option value="emergency" '+(record?.priority==='emergency'?'selected':'')+'>Emergência · todo o evento</option></select><span class="hint">Avisos de emergência são enviados a todos.</span></div>':'<input type="hidden" name="priority" value="normal">');
    }
    if(kind==='bulletin') additional='<div class="two"><div class="field"><label for="rec-priority">Destaque</label><select id="rec-priority" name="priority"><option value="normal">Normal</option><option value="important" '+(record?.priority==='important'?'selected':'')+'>Importante</option></select></div><div class="field"><label for="rec-hours">Validade</label><select id="rec-hours" name="hours"><option value="6">6 horas</option><option value="24" selected>24 horas</option><option value="48">48 horas</option></select></div></div>';
    if(kind==='bulletin')additional+='<div class="field"><label for="rec-link">Link (opcional)</label><input id="rec-link" name="link" type="url" maxlength="1500" placeholder="https://…" value="'+esc(record?.link||'')+'"></div><div class="field"><label>PDF ou imagem (opcional)</label><button type="button" class="secondary" id="choose-attachment">Selecionar arquivo</button><span class="hint" id="attachment-label" data-existing="'+esc(record?.attachment?.name||'')+'">'+esc(state.attachment?.name||record?.attachment?.name||'Nenhum arquivo selecionado')+'</span><label><input type="checkbox" name="removeAttachment"> Remover anexo deste boletim</label><span class="hint">PDF, JPG, PNG ou WebP · até 10 MB. O envio precisa do servidor. Após abrir, o arquivo fica salvo no aparelho para consulta offline. Arquivos não são transferidos por proximidade.</span></div>';
    if(roleNow==='coach')additional+='<p class="form-note">Esta publicação será enviada somente à sua equipe.</p>';
    if(edit)additional+='<p class="form-note">O público original é preservado nas alterações.</p>';
    modal(edit?'Editar publicação':({bulletin:'Novo boletim',notice:'Novo aviso',agenda:'Nova atividade',facility:'Cadastrar local'}[kind]),
      '<form id="publish-form" data-kind="'+kind+'">'+
      '<div class="field"><label for="rec-title">'+(kind==='facility'?'Nome do local':'Título')+'</label><input id="rec-title" name="title" maxlength="80" value="'+esc(record?.title||'')+'" required></div>'+
      '<div class="field"><label for="rec-sector">'+(kind==='facility'?'Região / setor':'Local / setor')+'</label><input id="rec-sector" name="sector" maxlength="40" value="'+esc(record?.sector||'')+'" required></div>'+
      '<div class="field"><label for="rec-text">'+(kind==='facility'?'Endereço e orientações':'Descrição')+'</label><textarea id="rec-text" name="text" maxlength="500" required>'+esc(record?.text||'')+'</textarea></div>'+additional+
      (kind==='agenda'?'<p class="form-note">O período deve terminar depois do início e dentro dos próximos 7 dias.</p>':'')+
      '<div id="publish-error" class="form-error" role="alert"></div><button class="primary full">'+(edit?'Salvar alterações':'Publicar')+'</button><p class="form-note">O servidor valida e distribui as publicações. O formulário não confirma entrega.</p></form>');
    const audience=$('#rec-audience');
    if($('#choose-attachment'))$('#choose-attachment').onclick=()=>isNative?send('chooseAttachment'):toast('O envio de arquivos está disponível no aplicativo Android conectado ao servidor.');
    if(audience) audience.onchange=()=>{const wrap=$('#team-select-wrap');if(wrap)wrap.hidden=audience.value!=='team';};
    $('#publish-form').onsubmit=e=>{
      e.preventDefault();
      const data=Object.fromEntries(new FormData(e.currentTarget)); data.kind=kind;
      if(kind==='agenda') {
        data.start=new Date(data.start).getTime();data.end=new Date(data.end).getTime();
        if(!Number.isFinite(data.start)||!Number.isFinite(data.end)||data.end<=data.start||data.end<=now()||data.end>now()+7*86400000){$('#publish-error').textContent='Confira as datas: o fim precisa ser depois do início e em até 7 dias.';return;}
      }
      if(kind==='facility'){data.lat=Number(data.lat);data.lon=Number(data.lon);}
      if(kind==='notice') {
        if(roleNow==='coach'){data.audience='team';data.teamId=String(ownTeam()?.id||'');data.priority='normal';}
        else if(data.priority==='emergency'){data.audience='all';data.teamId='';}
        else if(data.audience!=='team'){data.audience='all';data.teamId='';}
        if(data.audience==='team'&&!data.teamId){$('#publish-error').textContent='Escolha uma equipe para este aviso.';return;}
      } else if(kind!=='notice'){data.audience='all';}
      if(roleNow==='coach'){data.audience='team';data.teamId=String(state.teamId);data.priority='normal';}
      if(kind==='bulletin'){
        if(data.link){try{const link=new URL(data.link);if(!['http:','https:'].includes(link.protocol)||link.username||link.password)throw Error();}catch(_){$('#publish-error').textContent='Informe um link HTTP ou HTTPS válido.';return;}}
        if(!data.removeAttachment){
          data.useAttachment=!!state.attachment;
          if(!state.attachment&&record?.attachment)data.attachment=record.attachment;
        }
        delete data.removeAttachment;
      }
      if(data.hours)data.hours=Number(data.hours);
      if(edit) data.id=record.id;
      if(!isNative) { demoAction('publish',data); closeModal(); return; }
      send('publish',data);
    };
  }
  function teamForm(t=null) {
    const coachOwn=role()==='coach'&&((t&&String(t.id)===String(state.teamId))||(!t&&!state.teamId));
    if(!canManage()&&!coachOwn){toast(role()==='coach'?'Você só pode criar ou editar a sua própria equipe.':'Somente técnicos e a organização gerenciam equipes.');return;}
    modal(t?'Editar equipe':'Nova equipe','<form id="team-form">'+(t?'<input type="hidden" name="id" value="'+esc(t.id)+'">':'')+
      '<div class="field"><label for="team-name">Nome da equipe</label><input id="team-name" name="name" maxlength="80" value="'+esc(t?.name||'')+'" required></div>'+
      '<div class="field"><label for="team-sport">Esporte</label><input id="team-sport" name="sport" maxlength="60" value="'+esc(t?.sport||'')+'" required></div>'+
      (canManage()?'<div class="field"><label for="team-coach">Técnico</label><input id="team-coach" name="coach" maxlength="80" value="'+esc(t?.coach||'')+'"></div>':'')+
      '<p class="form-note">'+(canManage()?'Deixe o técnico vazio para criar sem vínculo; depois selecione a equipe em Contas e permissões. ':'Você será o técnico desta equipe e pode ter apenas uma. ')+(isNative?'As alterações exigem servidor.':'Demonstração: salvo apenas neste navegador.')+'</p><div id="team-error" class="form-error" role="alert"></div><button class="primary full">'+(t?'Salvar equipe':'Criar equipe')+'</button></form>');
    $('#team-form').onsubmit=e=>{e.preventDefault();send('teamSave',Object.fromEntries(new FormData(e.currentTarget)));};
  }
  function memberForm(teamId,member=null) {
    if(!(canManage()||(role()==='coach'&&String(state.teamId)===String(teamId)))){toast('Sem permissão para editar este elenco.');return;}
    const team=teams().find(t=>String(t.id)===String(teamId))||ownTeam();
    modal(member?'Editar atleta':'Adicionar atleta','<form id="member-form"><input type="hidden" name="teamId" value="'+esc(teamId)+'">'+(member?'<input type="hidden" name="id" value="'+esc(member.id)+'">':'')+
      '<div class="field"><label for="member-name">Nome do atleta</label><input id="member-name" name="name" maxlength="60" value="'+esc(member?.name||'')+'" required></div>'+
      '<div class="two"><div class="field"><label for="member-number">Número</label><input id="member-number" name="number" maxlength="8" value="'+esc(member?.number||'')+'"></div><div class="field"><label for="member-position">Posição</label><input id="member-position" name="position" maxlength="40" value="'+esc(member?.position||'')+'"></div></div>'+
      '<div class="field"><label for="member-user">Usuário (opcional)</label><input id="member-user" name="username" maxlength="40" value="'+esc(member?.username||'')+'" placeholder="vincular conta existente"></div><p class="form-note">Equipe: '+esc(team?.name||'')+'. Vincule o usuário para que o atleta receba os avisos desta equipe. A operação exige conexão.</p><div class="form-error" role="alert"></div><button class="primary full">Salvar atleta</button></form>');
    $('#member-form').onsubmit=e=>{e.preventDefault();send('memberSave',Object.fromEntries(new FormData(e.currentTarget)));};
  }
  function roleForm(username) {
    if(!canManage())return;
    const user=(state.users||[]).find(u=>u.username===username)||{username};
    const options=teams().map(t=>'<option value="'+esc(t.id)+'" '+(String(user.teamId)===String(t.id)?'selected':'')+'>'+esc(t.name)+'</option>').join('');
    modal('Permissões da conta','<form id="role-form"><input type="hidden" name="username" value="'+esc(username)+'"><div class="avatar-row"><div class="avatar-large">'+icon('user')+'</div><div><h3>'+esc(user.name||username)+'</h3><div class="small muted">@'+esc(username)+'</div></div></div><div class="field"><label for="account-role">Função autorizada</label><select id="account-role" name="role">'+['athlete','coach','organization'].map(r=>'<option value="'+r+'" '+(user.role===r?'selected':'')+'>'+roleLabel(r)+'</option>').join('')+'</select></div><div class="field"><label for="account-team">Equipe (para técnico)</label><select id="account-team" name="teamId"><option value="">Sem equipe</option>'+options+'</select></div><p class="form-note">O servidor aplica a permissão e valida o vínculo.</p><button class="primary full">Salvar permissões</button></form>');
    $('#role-form').onsubmit=e=>{e.preventDefault();send('roleUpdate',Object.fromEntries(new FormData(e.currentTarget)));};
  }
  function notificationsSettings() {
    modal('Notificações','<div class="network-card"><div class="network-title">'+icon('bell')+'<h3>Notificações no Ping</h3></div><p class="connection-copy">A permissão do sistema só é solicitada após sua ação. Atualizações online em segundo plano são periódicas (aproximadamente 15 minutos); proximidade só opera com o app aberto.</p><button class="primary full" id="notifications">'+(state.notificationsEnabled?'Solicitar / verificar permissão':'Ativar notificações')+'</button><button class="secondary full" id="test-notification" style="margin-top:8px">Enviar notificação de teste</button></div>');
  }
  function initMap() {
    const el=$('#map'); if(!el)return;
    if(!window.L){el.innerHTML=empty('Mapa indisponível','Os locais salvos continuam listados abaixo.','map');return;}
    const points=records('facility').filter(active).filter(r=>mapFilter==='all'||r.category===mapFilter).filter(r=>Number.isFinite(Number(r.lat))&&Number.isFinite(Number(r.lon)));
    map=window.L.map(el,{zoomControl:true,scrollWheelZoom:false,attributionControl:true});
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
    points.forEach(r=>{const node=document.createElement('div');const title=document.createElement('strong');title.textContent=r.title||'Local';const txt=document.createElement('p');txt.textContent=r.text||'';node.append(title,txt);window.L.circleMarker([r.lat,r.lon],{radius:9,color:'#7028bd',fillColor:'#7028bd',fillOpacity:.9,weight:3}).addTo(map).bindPopup(node);});
    if(points.length)map.fitBounds(points.map(r=>[r.lat,r.lon]),{padding:[30,30],maxZoom:15});else map.setView([-14.2,-51.9],3);
    if(mapView)map.setView(mapView.center,mapView.zoom);
    setTimeout(()=>{if(map)map.invalidateSize();},60);
  }
  function runDemoRole(r) {
    const chosen=({athlete:{role:'athlete',name:'Marina Lopes',username:'marina.lopes',teamId:'t1'},coach:{role:'coach',name:'Rafael Costa',username:'rafael.costa',teamId:'t1'},organization:{role:'organization',name:'Equipe Ping',username:'organizacao',teamId:''}})[r];
    if(!chosen)return;
    state={...state,...chosen,demoRole:r};page='home';saveDemo();render();toast('Perfil demonstrativo: '+roleLabel(r)+'. Nenhuma conta real foi autenticada.');
  }
  function seedDemo() {
    const t=now();
    return {...initial,event:'PING-EXEMPLO',eventName:'Festival Esportivo · exemplo',server:'',online:'unconfigured',status:'Demonstração local. Nenhum servidor está conectado.',role:'athlete',name:'Marina Lopes',username:'marina.lopes',teamId:'t1',onboardingDone:false,demoRole:'athlete',
      teams:[{id:'t1',name:'Vôlei Aurora · exemplo',sport:'Vôlei',coach:'Rafael Costa',members:[{id:'m1',name:'Marina Lopes',number:'08',position:'Levantadora',username:'marina.lopes'},{id:'m2',name:'Joana Reis',number:'12',position:'Ponteira',username:'joana.reis'}]},{id:'t2',name:'Atletismo Norte · exemplo',sport:'Atletismo',coach:'Lia Ferreira',members:[{id:'m3',name:'Caio Martins',number:'21',position:'400 m',username:'caio.martins'}]}],
      users:[{username:'marina.lopes',name:'Marina Lopes',role:'athlete',requestedRole:'athlete',teamId:'t1'},{username:'rafael.costa',name:'Rafael Costa',role:'coach',requestedRole:'coach',teamId:'t1'},{username:'sol.organizacao',name:'Sol Andrade',role:'athlete',requestedRole:'organization',teamId:''}],
      records:[
        {id:'ex-b1',kind:'bulletin',title:'Boletim de exemplo · chegada',text:'A organização demonstrativa recomenda conferir o número de inscrição antes da primeira partida.',sector:'Secretaria · exemplo',created:t-840000,expires:t+86400000,priority:'normal',audience:'all',authorName:'Sol Andrade'},
        {id:'ex-n1',kind:'notice',title:'Aviso de demonstração · aquecimento',text:'Exemplo: a quadra está disponível para aquecimento a partir das 08h30.',sector:'Ginásio A · exemplo',created:t-320000,expires:t+43200000,priority:'important',audience:'team',teamId:'t1',authorName:'Rafael Costa'},
        {id:'ex-n2',kind:'notice',title:'Orientação geral · exemplo',text:'Conteúdo fictício para mostrar como os avisos aparecem durante o evento.',sector:'Organização · exemplo',created:t-900000,expires:t+86400000,priority:'normal',audience:'all',authorName:'Sol Andrade'},
        {id:'ex-a1',kind:'agenda',title:'Vôlei · exemplo demonstrativo',text:'Quadra A · atividade fictícia, sem vínculo com evento real.',sector:'Ginásio A · exemplo',start:t+3600000,end:t+7200000,created:t,expires:t+7200000,audience:'all',authorName:'Sol Andrade'},
        {id:'ex-f1',kind:'facility',title:'Alojamento Aurora · exemplo',text:'Endereço fictício, inserido apenas para demonstrar a lista offline.',sector:'Setor norte · exemplo',category:'lodging',lat:-27.5954,lon:-48.548,created:t-1000000,expires:t+7*86400000},
        {id:'ex-f2',kind:'facility',title:'Ginásio municipal · exemplo',text:'Local fictício para demonstração da tela de mapas.',sector:'Centro · exemplo',category:'gym',lat:-27.59,lon:-48.53,created:t-1000000,expires:t+7*86400000}
      ]};
  }
  function saveDemo() {
    if(isNative)return;
    try { localStorage.setItem(demoKey,JSON.stringify(state)); } catch(e) { /* browser storage may be disabled */ }
  }
  function demoAction(action,f) {
    if(isNative)return;
    if(action==='ready')return;
    if(['sync','ping','nearby','settings','notifications','testNotification','refreshTeams','refreshUsers','roleUpdate'].includes(action)) {
      const messages={
        sync:'Demonstração: nenhuma conexão ou sincronização real foi feita.',
        ping:'Demonstração: não houve medição de rede.',
        nearby:'Demonstração: Bluetooth e Wi-Fi não foram acionados.',
        settings:'Configuração apenas demonstrativa; nenhum servidor foi contactado.',
        notifications:'Demonstração: nenhuma permissão real foi solicitada.',
        testNotification:'Demonstração: nenhuma notificação foi enviada.',
        refreshTeams:'Demonstração: as equipes exibidas são exemplos locais.',
        refreshUsers:'Demonstração: os usuários exibidos são exemplos locais.',
        roleUpdate:'Demonstração: permissões não são alteradas no servidor.'
      };
      if(action==='settings'){state.event=f.event;state.eventName=f.eventName;state.server=f.server;}
      toast(messages[action]||'Ação disponível apenas no aplicativo conectado.');
      saveDemo();render();return;
    }
    if(action==='onboardingDone'){state.onboardingDone=true;saveDemo();render();return;}
    if(action==='favorite'){
      state.favorites=state.favorites||[];const i=state.favorites.map(String).indexOf(String(f.id));
      if(i>=0)state.favorites.splice(i,1);else state.favorites.push(f.id);
    } else if(action==='login') {
      toast('Demonstração: o acesso não autentica em um servidor. Escolha um perfil de exemplo na tela Rede.');return;
    } else if(action==='register') {
      toast('Demonstração: criação de conta não está disponível. Nenhuma senha foi enviada.');return;
    } else if(action==='logout') {
      state.role='guest';state.name='';state.username='';state.teamId='';state.demoRole='';
    } else if(action==='publish') {
      const previous=f.id?allRecords().find(r=>r.id===f.id):null;
      const t=now(),rec={...f,id:'demo-'+t,created:t,expires:f.kind==='agenda'?f.end:f.kind==='facility'?t+7*86400000:t+(Number(f.hours)||24)*3600000,author:state.username,authorName:state.name,authorRole:state.role,audience:f.audience||'all',teamId:f.teamId||''};
      if(previous){rec.replaces=previous.replaces||previous.id;rec.original=previous.original||previous;rec.audience=previous.audience;rec.teamId=previous.teamId;}
      if(f.kind==='notice'&&state.role==='coach'){rec.audience='team';rec.teamId=state.teamId;rec.priority='normal';}
      state.records=[rec,...allRecords()];
      toast('Exemplo adicionado somente à demonstração local.');
    } else if(action==='teamJoin') {
      const target=teams().find(t=>String(t.id)===String(f.teamId));
      if(state.role!=='athlete'||!target){toast('Demonstração: equipe indisponível para este perfil.');return;}
      demoDetach();
      target.members=[...(target.members||[]),{id:'demo-member-'+now(),name:state.name,username:state.username,position:'Atleta'}];target.memberCount=target.members.length;
      state.teamId=target.id;toast('Demonstração local: você entrou em '+target.name+'. Nada foi enviado.');
    } else if(action==='teamLeave') {
      if(state.role!=='athlete'||!state.teamId)return;
      demoDetach();state.teamId='';toast('Demonstração local: você saiu da equipe.');
    } else if(action==='teamSave'&&state.role==='coach') {
      state.teams=teams();
      if(f.id){const t=state.teams.find(x=>String(x.id)===String(f.id));if(!t||String(t.id)!==String(state.teamId)){toast('Você só edita a sua equipe.');return;}t.name=f.name;t.sport=f.sport;}
      else if(state.teamId){toast('Cada técnico pode ter apenas uma equipe.');return;}
      else{const id='demo-team-'+now();state.teams.push({id,name:f.name,sport:f.sport,coach:state.name,members:[],memberCount:0});state.teamId=id;}
      closeModal();toast('Demonstração local: equipe salva somente neste navegador.');
    } else if(action==='teamSave') {
      state.teams=teams();const i=state.teams.findIndex(t=>String(t.id)===String(f.id));
      if(i>=0)state.teams[i]={...state.teams[i],...f};else state.teams.push({...f,id:'demo-team-'+now(),members:[]});
      toast('Equipe demonstrativa atualizada neste navegador.');
    } else if(action==='memberSave') {
      const team=teams().find(t=>String(t.id)===String(f.teamId));if(team){team.members=team.members||[];const i=team.members.findIndex(m=>String(m.id)===String(f.id));if(i>=0)team.members[i]={...team.members[i],...f};else team.members.push({...f,id:'demo-member-'+now()});}
      toast('Elenco demonstrativo atualizado localmente.');
    } else if(action==='memberDelete') {
      const team=teams().find(t=>String(t.id)===String(f.teamId));if(team)team.members=(team.members||[]).filter(m=>String(m.id)!==String(f.id));
    } else if(action==='teamDelete') {
      state.teams=teams().filter(t=>String(t.id)!==String(f.teamId));toast('Equipe de exemplo removida deste navegador.');
    }
    saveDemo();render();
  }
  function demoDetach() {
    teams().forEach(t=>{if((t.members||[]).some(m=>m.username===state.username)){t.members=t.members.filter(m=>m.username!==state.username);t.memberCount=t.members.length;}});
  }
  function confirmMutation(text,yes) {
    modal('Confirmar alteração','<p class="lead">'+esc(text)+'</p><div class="button-row" style="margin-top:18px"><button id="confirm-cancel" class="secondary">Cancelar</button><button id="confirm-yes" class="primary danger">Confirmar</button></div>');
    $('#confirm-cancel').onclick=closeModal;
    $('#confirm-yes').onclick=()=>{closeModal();yes();};
  }
  function events() {
    document.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.go){navigate(b.dataset.go);return;}
      if(b.dataset.demoRole&&!isNative){runDemoRole(b.dataset.demoRole);return;}
      if(b.dataset.compose){composer(b.dataset.compose);return;}
      if(b.id==='emergency-compose'){composer('notice',{priority:'emergency',audience:'all'});return;}
      if(b.dataset.favorite){send('favorite',{id:b.dataset.favorite});return;}
      if(b.dataset.editRecord){const r=effectiveRecords().find(x=>x.id===b.dataset.editRecord);if(r&&canEdit(r))composer(r.kind,r);return;}
      if(b.dataset.deleteRecord){
        const r=effectiveRecords().find(x=>x.id===b.dataset.deleteRecord);
        if(r&&canEdit(r))confirmMutation('Excluir “'+r.title+'”? A exclusão será distribuída quando os aparelhos sincronizarem ou se encontrarem.',()=>{
          if(isNative)send('deleteRecord',{id:r.id});
          else {state.records.push({...r,id:'demo-delete-'+now(),created:now(),replaces:r.replaces||r.id,original:r.original||r,deleted:true});saveDemo();render();toast('Publicação excluída nesta demonstração.');}
        });return;
      }
      if(b.dataset.attachment){if(isNative)send('openAttachment',{id:b.dataset.attachment});else toast('No APK, baixa o arquivo autenticado e abre no leitor instalado.');return;}
      if(b.dataset.link){if(isNative)send('openLink',{id:b.dataset.link});else toast('Links externos podem ser abertos no aplicativo Android.');return;}
      if(b.dataset.filter){filter=b.dataset.filter;render();return;}
      if(b.dataset.mapfilter){mapFilter=b.dataset.mapfilter;render();return;}
      if(b.dataset.center){const r=allRecords().find(x=>String(x.id)===String(b.dataset.center));if(map&&r){map.setView([r.lat,r.lon],16);$('#map').scrollIntoView({behavior:'smooth',block:'center'});}return;}
      if(b.dataset.route){const r=allRecords().find(x=>String(x.id)===String(b.dataset.route));if(r){if(isNative)send('route',{lat:Number(r.lat),lon:Number(r.lon),title:r.title});else toast('No APK, abre o aplicativo de mapas instalado. Rotas dependem dos mapas disponíveis.');}return;}
      if(b.id==='tutorial-next'){if(tutorialStep<3){tutorialStep++;render();}else finishOnboarding();return;}
      if(b.id==='tutorial-back'){tutorialStep=Math.max(0,tutorialStep-1);render();return;}
      if(b.id==='tutorial-skip'){finishOnboarding();return;}
      if(b.id==='onboarding-notifications'){send('notifications');return;}
      if(b.id==='login-open'){authMode='login';authModal();return;}
      if(b.id==='register-open'){authMode='register';authModal();return;}
      if(b.id==='guest-settings'){settings();return;}
      if(b.id==='profile'||b.id==='account'){account();return;}
      if(b.id==='logout'){send('logout');closeModal();return;}
      if(b.id==='settings'){settings();return;}
      if(b.id==='sync'){send('sync');return;}
      if(b.id==='nearby'){send('nearby');return;}
      if(b.id==='peer-ping'){send('ping');return;}
      if(b.id==='notifications'){send('notifications');return;}
      if(b.id==='test-notification'){send('testNotification');return;}
      if(b.id==='my-location'){
        if(isNative)send('location');
        else if(navigator.geolocation)navigator.geolocation.getCurrentPosition(p=>window.EventoLocation({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,time:p.timestamp}),()=>toast('Localização não disponível neste navegador.'));
        else toast('Geolocalização não disponível.');
        return;
      }
      if(b.id==='close-modal'){closeModal();return;}
      if(b.id==='fab'){composer(b.dataset.compose||'bulletin');return;}
      if(b.id==='team-add'){teamForm();return;}
      if(b.dataset.teamEdit){teamForm(teams().find(t=>String(t.id)===String(b.dataset.teamEdit)));return;}
      if(b.dataset.teamDelete){confirmMutation('Excluir esta equipe e desvincular seu elenco?',()=>{send('teamDelete',{teamId:b.dataset.teamDelete});});return;}
      if(b.dataset.memberAdd){memberForm(b.dataset.memberAdd);return;}
      if(b.dataset.memberEdit){const team=teams().find(t=>String(t.id)===String(b.dataset.team));const member=(team?.members||[]).find(m=>String(m.id)===String(b.dataset.memberEdit));if(member)memberForm(b.dataset.team,member);return;}
      if(b.dataset.memberDelete){confirmMutation('Remover este atleta do elenco?',()=>{const data={teamId:b.dataset.team,id:b.dataset.memberDelete};send('memberDelete',data);});return;}
      if(b.dataset.teamJoin){const id=b.dataset.teamJoin;const go=()=>send('teamJoin',{teamId:id});
        if(state.teamId&&String(state.teamId)!==String(id))confirmMutation('Você já está em '+(ownTeam()?.name||'uma equipe')+'. Trocar para '+teamName(id)+'? Você sairá da equipe atual.'+(!isNative?' (Demonstração local.)':''),go);else go();return;}
      if(b.id==='team-leave'){confirmMutation('Sair de '+(ownTeam()?.name||'sua equipe')+'?'+(!isNative?' (Demonstração local.)':''),()=>send('teamLeave',{}));return;}
      if(b.dataset.userEdit){roleForm(b.dataset.userEdit);return;}
      if(b.id==='refresh-users'){send('refreshUsers');return;}
      if(b.id==='reopen-onboarding'){tutorialStep=0;tutorialOpen=true;render();return;}
    });
    $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&!$('#modal').hidden)closeModal();
      if(e.key==='Tab'&&!$('#modal').hidden){const items=[...$('#modal').querySelectorAll('button,input,textarea,select')].filter(x=>!x.disabled&&x.offsetParent!==null);if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
  }
  function finishOnboarding() {
    tutorialOpen=false;
    if(isNative){send('onboardingDone',{});state.onboardingDone=true;}
    else {state.onboardingDone=true;saveDemo();}
    if(role()==='guest')page='home';
    render();
  }
  function init() {
    events();
    if(!isNative) {
      try { const saved=localStorage.getItem(demoKey);state=saved?{...seedDemo(),...JSON.parse(saved)}:seedDemo(); }
      catch(e){state=seedDemo();}
      if(new URLSearchParams(window.location.search).get('preview')==='login')state={...state,role:'guest',username:'',name:'',onboardingDone:true};
      $('#demo-banner').hidden=false;
    } else {
      state={...initial};
    }
    render();
    if(isNative) send('ready',{});
  }
  init();
})();
