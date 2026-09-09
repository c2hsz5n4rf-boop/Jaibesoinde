const state = {
  lat: 48.0061,
  lon: 0.1996,
  radius: 2500,
  category: 'toilettes',
  q: '',
  map: null,
  markers: [],
  locationReady: false
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const api = async (url, options) => {
  const r = await fetch(url, options);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Erreur');
  return data;
};

const track = (event_type, label) => {
  const payload=JSON.stringify({event_type,label});
  if(navigator.sendBeacon){
    try{ navigator.sendBeacon('/api/analytics/event',new Blob([payload],{type:'application/json'})); return; }catch{}
  }
  fetch('/api/analytics/event',{method:'POST',headers:{'content-type':'application/json'},body:payload,keepalive:true}).catch(()=>{});
};

const ICONS = {toilettes:'🚻',laverie:'🧺',eau:'💧',pharmacie:'✚',recharge:'⚡',parking:'🅿️',carburant:'⛽',supermarche:'🛒',veterinaire:'🐾',defibrillateur:'❤',douche:'🚿',recyclage:'♻️',velo:'🚲',campingcar:'🚐',restaurant:'🍴',boulangerie:'🥖',banque:'🏧',poste:'✉️',bibliotheque:'📚',airejeux:'🛝',wifi:'◉',gare:'🚉',centrecommercial:'🛍️',medecin:'🩺',dentiste:'🦷',hopital:'🏥',coiffeur:'✂️',cafe:'☕',hotel:'🏨',garage:'🔧',lavageauto:'🚗',opticien:'👓',police:'👮',mairie:'🏛️',cinema:'🎬',musee:'🏛️',parc:'🌳',piscine:'🏊'};

function formatDistance(m){ return m < 1000 ? `${m} m` : `${(m/1000).toFixed(m<10000?1:0)} km`; }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function navUrl(p){
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  return isApple
    ? `https://maps.apple.com/?saddr=${state.lat},${state.lon}&daddr=${p.lat},${p.lon}`
    : `https://www.google.com/maps/dir/?api=1&origin=${state.lat},${state.lon}&destination=${p.lat},${p.lon}&travelmode=walking`;
}

function initMap(){
  state.map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [state.lon,state.lat],
    zoom: 13.7,
    attributionControl: true
  });
  state.map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');
  state.map.on('moveend', () => {
    const c=state.map.getCenter();
    if ($('#followMap')?.checked){ state.lat=c.lat; state.lon=c.lng; }
  });
}

function clearMarkers(){ state.markers.forEach(m=>m.remove()); state.markers=[]; }
function addMarker(p){
  const el=document.createElement('button');
  el.className=`marker-dot ${p.source==='Communauté'?'marker-community':''}`;
  el.title=p.title;
  el.addEventListener('click',()=>focusPlace(p));
  const m=new maplibregl.Marker({element:el}).setLngLat([p.lon,p.lat]).addTo(state.map);
  state.markers.push(m);
}

function fitSearchResults(items){
  if(!state.map || !items.length) return;
  try{
    const bounds=new maplibregl.LngLatBounds([state.lon,state.lat],[state.lon,state.lat]);
    items.slice(0,20).forEach(p=>bounds.extend([p.lon,p.lat]));
    state.map.fitBounds(bounds,{padding:{top:45,bottom:45,left:45,right:390},maxZoom:14,duration:650});
  }catch{}
}

function focusPlace(p){
  track('lieu',String(p.title||'lieu').slice(0,140));
  state.map.flyTo({center:[p.lon,p.lat],zoom:16});
  const url=navUrl(p);
  new maplibregl.Popup({offset:22}).setLngLat([p.lon,p.lat]).setHTML(`<strong>${escapeHtml(p.title)}</strong><br><small>${formatDistance(p.distance)}</small>${p.address?`<br><small>${escapeHtml(p.address)}</small>`:''}<br><a href="${url}" target="_blank" rel="noopener">Itinéraire</a>`).addTo(state.map);
}

async function searchPlaces(qOrCat, isCategory=false){
  const q=isCategory?'':qOrCat;
  track(isCategory?'categorie':'recherche', isCategory?String(qOrCat):String(qOrCat).slice(0,120));
  const category=isCategory?qOrCat:'';
  state.q=q; if(category) state.category=category;
  $('#placeResults').innerHTML='<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  $('#resultCount').textContent='Recherche…';
  try{
    const params=new URLSearchParams({lat:state.lat,lon:state.lon,radius:state.radius,q});
    if(category) params.set('category',category);
    const data=await api(`/api/places?${params}`);
    state.category=data.category;
    $('#resultTitle').textContent=data.label;
    $('#resultCount').textContent=`${data.results.length} résultat${data.results.length>1?'s':''}`;
    renderPlaces(data.results,data);
  }catch(e){
    $('#resultCount').textContent='Indisponible';
    $('#placeResults').innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

function renderPlaces(items,meta={}){
  clearMarkers();
  if(!items.length){
    $('#placeResults').innerHTML=`<div class="empty">${escapeHtml(meta.message||'Aucun résultat trouvé. Essaie un autre mot ou augmente la distance.')}</div>`;
    return;
  }
  $('#placeResults').innerHTML=items.map((p,i)=>`<div class="list-item" data-place="${i}"><div class="list-icon">${ICONS[p.category]||'●'}</div><div class="list-main"><b>${escapeHtml(p.title)}</b><small>${formatDistance(p.distance)} · ${escapeHtml(p.source||'Donnée ouverte')}${p.address?`<br>${escapeHtml(p.address)}`:''}${p.opening_hours?`<br>${escapeHtml(p.opening_hours)}`:''}</small></div><a class="list-action" href="${navUrl(p)}" target="_blank" rel="noopener">Y aller</a></div>`).join('');
  items.forEach(addMarker);
  fitSearchResults(items);
  $$('#placeResults [data-place]').forEach(el=>el.addEventListener('click',e=>{ const p=items[Number(el.dataset.place)]; if(e.target.tagName==='A') track('itineraire',String(p.title||'lieu').slice(0,140)); else focusPlace(p); }));
}

async function loadTransport(){
  $('#transportBody').innerHTML='<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try{
    const d=await api(`/api/transport/nearby?lat=${state.lat}&lon=${state.lon}&radius=7000`);
    const chunks=[];
    if(d.message) chunks.push(`<div class="empty">${escapeHtml(d.message)}</div>`);
    for(const v of d.vehicles||[]){ chunks.push(`<div class="realtime-row"><div class="line-badge">${escapeHtml(v.line||'?')}</div><div><b>${v.vehicle?`Véhicule ${escapeHtml(v.vehicle)}`:'Transport en approche'}</b><small>${formatDistance(v.distance)}${v.next_stop_id?` · prochain arrêt ${escapeHtml(v.next_stop_id)}`:''}</small></div><div class="eta">${v.eta_minutes!=null?`${v.eta_minutes} min`:'Direct'}<small>${escapeHtml(d.network||'')}</small></div></div>`); }
    for(const a of d.alerts||[]){ chunks.push(`<div class="alert"><b>${escapeHtml(a.title)}</b>${a.description?`<br>${escapeHtml(a.description).slice(0,260)}`:''}</div>`); }
    $('#transportBody').innerHTML=chunks.join('')||'<div class="empty">Aucun véhicule temps réel détecté à proximité.</div>';
  }catch(e){ $('#transportBody').innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`; }
}

async function loadEvents(){
  try{
    const d=await api(`/api/events?lat=${state.lat}&lon=${state.lon}&radius=30000`);
    const ev=(d.events||[]).slice(0,8);
    $('#eventsBody').innerHTML=ev.length?ev.map(e=>`<div class="event-row"><span class="event-date">${e.starts_at?new Date(e.starts_at).toLocaleString('fr-FR',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'À venir'}</span><b>${escapeHtml(e.title)}</b><small>${escapeHtml(e.place||'À proximité')} · ${formatDistance(e.distance)}</small></div>`).join(''):'<div class="empty">Pas d’événement trouvé pour le moment.</div>';
  }catch(e){ $('#eventsBody').innerHTML='<div class="empty">Événements momentanément indisponibles.</div>'; }
}

async function loadCategories(){
  try{
    const d=await api('/api/categories');
    const top=['toilettes','laverie','eau','pharmacie','recharge','campingcar'];
    const by=new Map(d.categories.map(c=>[c.slug,c]));
    $('#suggestions').innerHTML=top.map(s=>`<button data-suggest-cat="${s}">${escapeHtml(by.get(s)?.label||s)}</button>`).join('');
    const trends=(d.trending||[]).slice(0,6);
    $('#trendBox').innerHTML=trends.length?`<h3>Demandes qui montent</h3><div class="trend-tags">${trends.map(t=>`<button data-trend="${escapeHtml(t.term)}">${escapeHtml(t.term)} · ${t.count}</button>`).join('')}</div>`:'<h3>Les nouvelles demandes fréquentes apparaîtront ici.</h3>';
    $$('[data-suggest-cat]').forEach(b=>b.addEventListener('click',()=>searchPlaces(b.dataset.suggestCat,true)));
    $$('[data-trend]').forEach(b=>b.addEventListener('click',()=>{ $('#searchInput').value=b.dataset.trend; searchPlaces(b.dataset.trend,false); }));
  }catch{}
}

function requestLocation(){
  return new Promise(resolve=>{
    if(!navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(pos=>{
      state.lat=pos.coords.latitude; state.lon=pos.coords.longitude; state.locationReady=true;
      if(state.map) state.map.flyTo({center:[state.lon,state.lat],zoom:14});
      resolve(true);
    },()=>resolve(false),{enableHighAccuracy:true,timeout:7000,maximumAge:60000});
  });
}

async function refreshAll(){ await Promise.all([searchPlaces(state.category,true),loadTransport(),loadEvents()]); }

$('#searchForm').addEventListener('submit',e=>{e.preventDefault();const q=$('#searchInput').value.trim();if(q)searchPlaces(q,false);});
$$('.desktop-nav a,.mobile-nav a').forEach(a=>a.addEventListener('click',()=>track('rubrique',(a.getAttribute('href')||'#accueil').replace('#',''))));
$$('[data-cat]').forEach(b=>b.addEventListener('click',()=>searchPlaces(b.dataset.cat,true)));
$$('[data-scroll]').forEach(b=>b.addEventListener('click',()=>{track('rubrique',b.dataset.scroll.replace('#',''));$(b.dataset.scroll)?.scrollIntoView({behavior:'smooth'});}));
$('#radiusSelect').addEventListener('change',e=>{state.radius=Number(e.target.value);searchPlaces(state.q||state.category,!state.q);});
$('#locateBtn').addEventListener('click',async()=>{await requestLocation();refreshAll();});
$('#refreshTransport').addEventListener('click',()=>{track('rubrique','transport_temps_reel');loadTransport();});
$('#procedureForm').addEventListener('submit',e=>{e.preventDefault();const q=$('#procedureInput').value.trim();if(!q)return;track('demarche',q.slice(0,120));fetch('/api/search/log',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({q:`démarche ${q}`,lat:state.lat,lon:state.lon})});window.open(`https://www.service-public.fr/particuliers/recherche?keyword=${encodeURIComponent(q)}`,'_blank','noopener');});
$('#findStation').addEventListener('click',()=>{track('plan','gare');searchPlaces('gare',false);});
$('#findMall').addEventListener('click',()=>{track('plan','centre_commercial');searchPlaces('centre commercial',false);});

const dialog=$('#contributionDialog');
$$('[data-open-contribution]').forEach(b=>b.addEventListener('click',()=>{track('rubrique','contribution');dialog.showModal();}));
$('[data-close-dialog]').addEventListener('click',()=>dialog.close());
$('#refreshContribPosition').addEventListener('click',async()=>{const ok=await requestLocation();$('#contribPosition').textContent=ok?'Position actualisée':'Position actuelle conservée';});
async function compressContributionPhoto(file){
  if(!(file instanceof File) || !file.size || !String(file.type||'').startsWith('image/')) return file;
  if(file.size <= 350*1024) return file;
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    const maxDim=1200;
    const scale=Math.min(1,maxDim/Math.max(img.naturalWidth||1,img.naturalHeight||1));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    let quality=.74, blob=null;
    const makeBlob=q=>new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',q));
    blob=await makeBlob(quality);
    while(blob && blob.size>350*1024 && quality>.42){quality-=.08;blob=await makeBlob(quality);}
    if(!blob) return file;
    return new File([blob],'preuve.jpg',{type:'image/jpeg',lastModified:Date.now()});
  } finally { URL.revokeObjectURL(url); }
}

$('#contributionForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const status=$('#contributionStatus');
  const fd=new FormData(e.currentTarget); fd.set('lat',state.lat); fd.set('lon',state.lon);
  try{
    const original=fd.get('photo');
    if(original instanceof File && original.size){
      status.textContent='Compression de la photo…';
      const compressed=await compressContributionPhoto(original);
      if(compressed.size>900*1024) throw new Error('Photo trop volumineuse. Choisis une autre photo.');
      fd.set('photo',compressed,compressed.name||'preuve.jpg');
    }
    status.textContent='Envoi…';
    const r=await fetch('/api/contributions',{method:'POST',body:fd});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Erreur');
    status.textContent='Information ajoutée. Merci.';
    track('contribution','information_ajoutee');
    e.currentTarget.reset();
    setTimeout(()=>{dialog.close();status.textContent='';searchPlaces(state.q||state.category,!state.q);},900);
  } catch(err){status.textContent=err.message;}
});

const contactDialog=$('#contactDialog');
$$('[data-open-contact]').forEach(b=>b.addEventListener('click',()=>{track('rubrique','contact');contactDialog.showModal();}));
$('[data-close-contact]').addEventListener('click',()=>contactDialog.close());
$('#contactForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const status=$('#contactStatus'); status.textContent='Envoi…';
  const fd=new FormData(e.currentTarget);
  const payload={name:fd.get('name')||'',email:fd.get('email')||'',message:fd.get('message')||'',website:fd.get('website')||'',page:location.pathname+location.hash};
  try{
    await api('/api/contact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    status.textContent='Ta question a bien été envoyée.';
    e.currentTarget.reset();
    setTimeout(()=>{contactDialog.close();status.textContent='';},1200);
  }catch(err){status.textContent=err.message;}
});

track('pageview','accueil');

if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

initMap();
loadCategories();
requestLocation().then(refreshAll);
setInterval(loadTransport,30000);