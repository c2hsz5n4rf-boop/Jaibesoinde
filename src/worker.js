import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { unzipSync, strFromU8 } from 'fflate';

const { transit_realtime } = GtfsRealtimeBindings;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const CATEGORY_RULES = {
  toilettes: ['[amenity=toilets]'],
  laverie: ['[shop=laundry]', '[amenity=lavoir]'],
  eau: ['[amenity=drinking_water]', '[drinking_water=yes]'],
  pharmacie: ['[amenity=pharmacy]'],
  recharge: ['[amenity=charging_station]'],
  parking: ['[amenity=parking]'],
  carburant: ['[amenity=fuel]'],
  supermarche: ['[shop=supermarket]', '[shop=convenience]'],
  veterinaire: ['[amenity=veterinary]'],
  defibrillateur: ['[emergency=defibrillator]'],
  douche: ['[amenity=shower]'],
  recyclage: ['[amenity=recycling]'],
  velo: ['[amenity=bicycle_repair_station]', '[amenity=bicycle_parking]'],
  campingcar: ['[tourism=caravan_site]', '[amenity=sanitary_dump_station]'],
  restaurant: ['[amenity=restaurant]', '[amenity=fast_food]', '[shop=bakery]'],
  banque: ['[amenity=atm]', '[amenity=bank]'],
  poste: ['[amenity=post_office]'],
  bibliotheque: ['[amenity=library]'],
  airejeux: ['[leisure=playground]'],
  wifi: ['[internet_access=wlan]'],
  gare: ['[railway=station]', '[public_transport=station]'],
  centrecommercial: ['[shop=mall]']
};

const TERM_ALIASES = [
  [/toilet|wc|sanitaire/i, 'toilettes'],
  [/laverie|linge|machine.*laver/i, 'laverie'],
  [/eau|fontaine|gourde/i, 'eau'],
  [/pharma/i, 'pharmacie'],
  [/recharg|borne.*élect|voiture électrique|usb/i, 'recharge'],
  [/parking|stationnement/i, 'parking'],
  [/essence|gazole|diesel|carburant|station.service/i, 'carburant'],
  [/supermarch|courses|épicerie|epicerie/i, 'supermarche'],
  [/vétér|veter/i, 'veterinaire'],
  [/défibr|defibr/i, 'defibrillateur'],
  [/douche/i, 'douche'],
  [/recycl|déchet|dechet/i, 'recyclage'],
  [/vélo|velo|gonfl/i, 'velo'],
  [/camping.?car|vidange|cassette wc/i, 'campingcar'],
  [/restaurant|manger|boulanger|repas/i, 'restaurant'],
  [/distributeur|banque|retrait/i, 'banque'],
  [/poste|courrier/i, 'poste'],
  [/biblioth|médiath|mediat/i, 'bibliotheque'],
  [/aire.*jeu|enfant/i, 'airejeux'],
  [/wifi|wi-fi|internet/i, 'wifi'],
  [/gare|station ferroviaire/i, 'gare'],
  [/centre commercial|centre-commercial|galerie marchande|mall/i, 'centrecommercial']
];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function toNum(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function normTerm(v = '') { return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
function slugify(v = '') { return normTerm(v).replace(/ /g, '-').slice(0, 64) || 'nouveau-besoin'; }
function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2-lat1)*Math.PI/180, dl=(lon2-lon1)*Math.PI/180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function detectCategory(q = '') {
  for (const [re, cat] of TERM_ALIASES) if (re.test(q)) return cat;
  const n = normTerm(q);
  return CATEGORY_RULES[n] ? n : null;
}

async function logSearch(env, q, lat, lon, knownCategory) {
  if (!env.DB || !q) return;
  const term = normTerm(q);
  if (!term) return;
  const day = parisDateKey();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO search_terms(term,count,last_lat,last_lon,last_seen,known_category)
      VALUES(?1,1,?2,?3,CURRENT_TIMESTAMP,?4)
      ON CONFLICT(term) DO UPDATE SET count=count+1,last_lat=excluded.last_lat,last_lon=excluded.last_lon,last_seen=CURRENT_TIMESTAMP,known_category=excluded.known_category`)
      .bind(term, lat || null, lon || null, knownCategory ? 1 : 0),
    env.DB.prepare(`INSERT INTO search_daily(day,term,count) VALUES(?1,?2,1)
      ON CONFLICT(day,term) DO UPDATE SET count=count+1`).bind(day, term)
  ]);
}

function overpassQuery(lat, lon, radius, category) {
  const rules = CATEGORY_RULES[category] || [];
  const body = rules.flatMap(rule => [`node${rule}(around:${radius},${lat},${lon});`, `way${rule}(around:${radius},${lat},${lon});`, `relation${rule}(around:${radius},${lat},${lon});`]).join('');
  return `[out:json][timeout:18];(${body});out center tags 80;`;
}


function overpassGenericQuery(lat, lon, radius, q) {
  const safe = normTerm(q).replace(/[\"']/g, '').split(' ').filter(w=>w.length>2).slice(0,4).join('.*');
  if (!safe) return '[out:json];node(0,0,0,0);out;';
  return `[out:json][timeout:18];(node["name"~"${safe}",i](around:${radius},${lat},${lon});way["name"~"${safe}",i](around:${radius},${lat},${lon});relation["name"~"${safe}",i](around:${radius},${lat},${lon});node["brand"~"${safe}",i](around:${radius},${lat},${lon});way["brand"~"${safe}",i](around:${radius},${lat},${lon}););out center tags 80;`;
}
async function fetchOverpass(env, lat, lon, radius, category, q = '') {
  const generic = !CATEGORY_RULES[category] && q.trim();
  if (!CATEGORY_RULES[category] && !generic) return [];
  const roundedLat = lat.toFixed(3), roundedLon = lon.toFixed(3);
  const cacheKey = new Request(`https://cache.local/places/${category||'generic'}/${encodeURIComponent(normTerm(q))}/${roundedLat}/${roundedLon}/${radius}`);
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) return await cached.json();

  const endpoint = env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: generic ? overpassGenericQuery(lat, lon, radius, q) : overpassQuery(lat, lon, radius, category) })
  });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);
  const data = await response.json();
  const places = (data.elements || []).map(el => {
    const pLat = el.lat ?? el.center?.lat, pLon = el.lon ?? el.center?.lon, t = el.tags || {};
    if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) return null;
    return {
      id: `osm-${el.type}-${el.id}`,
      source: 'OpenStreetMap',
      title: t.name || t.brand || labelForCategory(category),
      category: category || 'autre',
      lat: pLat, lon: pLon,
      distance: Math.round(distanceM(lat, lon, pLat, pLon)),
      address: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ') || null,
      opening_hours: t.opening_hours || null,
      wheelchair: t.wheelchair || null,
      fee: t.fee || null,
      website: t.website || t['contact:website'] || null,
      phone: t.phone || t['contact:phone'] || null,
      tags: t
    };
  }).filter(Boolean).sort((a,b)=>a.distance-b.distance).slice(0, 60);

  const res = json(places, 200, { 'cache-control': 'public, max-age=600' });
  await cache.put(cacheKey, res.clone());
  return places;
}

function labelForCategory(cat) {
  return ({toilettes:'Toilettes',laverie:'Laverie',eau:'Point d’eau',pharmacie:'Pharmacie',recharge:'Borne de recharge',parking:'Parking',carburant:'Station-service',supermarche:'Supermarché',veterinaire:'Vétérinaire',defibrillateur:'Défibrillateur',douche:'Douche',recyclage:'Point de recyclage',velo:'Service vélo',campingcar:'Service camping-car',restaurant:'Restaurant',banque:'Distributeur / banque',poste:'Bureau de poste',bibliotheque:'Bibliothèque',airejeux:'Aire de jeux',wifi:'Wi-Fi',gare:'Gare',centrecommercial:'Centre commercial'})[cat] || 'Lieu utile';
}

async function communityPlaces(env, lat, lon, radius, category) {
  if (!env.DB) return [];
  const deg = radius / 111000;
  const rows = await env.DB.prepare(`SELECT id,title,category,description,lat,lon,photo_key,proof_status,confirmations,rejections,updated_at
    FROM contributions WHERE lat BETWEEN ?1 AND ?2 AND lon BETWEEN ?3 AND ?4 AND (?5='' OR category=?5)
    ORDER BY confirmations DESC, updated_at DESC LIMIT 80`)
    .bind(lat-deg, lat+deg, lon-deg, lon+deg, category || '').all();
  return (rows.results || []).map(r => ({ ...r, id:`community-${r.id}`, source:'Communauté', distance:Math.round(distanceM(lat,lon,r.lat,r.lon)), photo_url:r.photo_key?`/api/photos/${encodeURIComponent(r.photo_key)}`:null })).filter(r=>r.distance<=radius).sort((a,b)=>a.distance-b.distance);
}

async function placesEndpoint(request, env, url) {
  const lat = toNum(url.searchParams.get('lat')), lon = toNum(url.searchParams.get('lon'));
  if (!lat || !lon) return json({error:'Coordonnées manquantes'},400);
  const radius = clamp(toNum(url.searchParams.get('radius'), 2500), 100, 10000);
  const q = url.searchParams.get('q') || '';
  const explicit = url.searchParams.get('category') || '';
  const category = explicit || detectCategory(q) || '';
  await logSearch(env, q || category, lat, lon, Boolean(category));
  const [osm, communityAll] = await Promise.all([
    fetchOverpass(env,lat,lon,radius,category,q).catch(()=>[]),
    communityPlaces(env,lat,lon,radius,category).catch(()=>[])
  ]);
  const nq=normTerm(q);
  const community = category || !nq ? communityAll : communityAll.filter(p=>normTerm(`${p.title} ${p.description||''} ${p.category||''}`).includes(nq));
  return json({ category:category||'autre', label:category?labelForCategory(category):`Résultats pour « ${q} »`, results:[...community,...osm].sort((a,b)=>a.distance-b.distance).slice(0,70), generated_at:new Date().toISOString() });
}

async function contributionEndpoint(request, env) {
  if (!env.DB) return json({error:'Base D1 non configurée'},503);
  const form = await request.formData();
  const title = String(form.get('title') || '').trim().slice(0,120);
  const category = String(form.get('category') || '').trim().slice(0,60);
  const description = String(form.get('description') || '').trim().slice(0,1000);
  const lat = toNum(form.get('lat')), lon = toNum(form.get('lon'));
  if (!title || !category || !lat || !lon) return json({error:'Titre, catégorie et position requis'},400);
  let photoKey = null;
  const photo = form.get('photo');
  if (photo && typeof photo === 'object' && photo.size) {
    if (photo.size > 900*1024) return json({error:'La photo doit faire moins de 900 Ko après compression.'},413);
    const type = String(photo.type || 'image/jpeg').startsWith('image/') ? String(photo.type || 'image/jpeg') : 'image/jpeg';
    const ext = type.split('/')[1]?.replace(/[^a-z0-9]/gi,'') || 'jpg';
    photoKey = `${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;
    const bytes = await photo.arrayBuffer();
    if (env.PHOTOS) {
      await env.PHOTOS.put(photoKey, bytes, { httpMetadata:{ contentType:type }, customMetadata:{ source:'community' } });
    } else {
      await env.DB.prepare(`INSERT INTO contribution_photos(photo_key,content_type,data,size) VALUES(?1,?2,?3,?4)`)
        .bind(photoKey,type,bytes,bytes.byteLength).run();
    }
  }
  const result = await env.DB.prepare(`INSERT INTO contributions(title,category,description,lat,lon,photo_key,proof_status) VALUES(?1,?2,?3,?4,?5,?6,?7)`)
    .bind(title,category,description,lat,lon,photoKey,photoKey?'photo':'community').run();
  return json({ok:true,id:result.meta?.last_row_id,photo:photoKey?`/api/photos/${encodeURIComponent(photoKey)}`:null},201);
}

async function photoEndpoint(env, key) {
  if (env.PHOTOS) {
    const obj = await env.PHOTOS.get(key);
    if (obj) {
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag',obj.httpEtag);
      headers.set('cache-control','public, max-age=86400');
      return new Response(obj.body,{headers});
    }
  }
  if (!env.DB) return new Response('Introuvable',{status:404});
  const row = await env.DB.prepare(`SELECT content_type,data,size FROM contribution_photos WHERE photo_key=?1`).bind(key).first();
  if (!row || !row.data) return new Response('Introuvable',{status:404});
  let body = row.data;
  if (Array.isArray(body)) body = new Uint8Array(body);
  else if (body && body.buffer && !(body instanceof ArrayBuffer)) body = body.buffer;
  return new Response(body,{headers:{'content-type':row.content_type||'image/jpeg','cache-control':'public, max-age=86400','content-length':String(row.size||'')}});
}

async function reverseCommune(lat, lon) {
  const u = new URL('https://geo.api.gouv.fr/communes');
  u.searchParams.set('lat',lat); u.searchParams.set('lon',lon); u.searchParams.set('fields','nom,code,codeDepartement,codeRegion,codesPostaux'); u.searchParams.set('format','json'); u.searchParams.set('geometry','centre');
  const r = await fetch(u,{headers:{accept:'application/json'}});
  if (!r.ok) return null;
  const data = await r.json(); return Array.isArray(data)?data[0]:null;
}

function normalizeEventsPayload(payload, lat, lon) {
  const arr = Array.isArray(payload) ? payload : payload?.events || payload?.results || payload?.data || payload?.items || [];
  return arr.map((e,i) => {
    const eLat = toNum(e.latitude ?? e.lat ?? e.location?.latitude ?? e.location?.lat, NaN);
    const eLon = toNum(e.longitude ?? e.lon ?? e.lng ?? e.location?.longitude ?? e.location?.lon ?? e.location?.lng, NaN);
    if (!Number.isFinite(eLat)||!Number.isFinite(eLon)) return null;
    const title = e.label || e.title || e.name || 'Événement';
    const start = e.startdate || e.startDate || e.date_debut || e.starts_at || e.start || e.timings?.[0]?.begin || null;
    return { id:e.id || e.uid || `event-${i}`, title, starts_at:start, ends_at:e.enddate||e.endDate||e.date_fin||e.ends_at||null, lat:eLat, lon:eLon, distance:Math.round(distanceM(lat,lon,eLat,eLon)), place:e.city||e.place_name||e.location?.name||e.location?.city||null, description:e.comment||e.description||e.shortDescription||null, website:e.website||e.site||e.url||null, source:e.source||'Open data' };
  }).filter(Boolean).sort((a,b)=>a.distance-b.distance);
}

function apiSlug(v=''){return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
async function tourismEventsForDepartment(code,lat,lon,days=180){if(!code)return[];const cache=caches.default;const horizon=Math.max(7,Math.min(365,Number(days)||180));const key=new Request(`https://cache.local/tourism-events/${encodeURIComponent(code)}/${horizon}`);const hit=await cache.match(key);if(hit)return hit.json();try{const depRes=await fetch(`https://geo.api.gouv.fr/departements/${encodeURIComponent(code)}`,{headers:{accept:'application/json'}});if(!depRes.ok)return[];const dep=await depRes.json();const slug=apiSlug(dep.nom||'');const [communesRes,eventsRes]=await Promise.all([fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${encodeURIComponent(code)}&fields=nom,code,centre&format=json&geometry=centre`,{headers:{accept:'application/json'}}),fetch(`https://france-evasion-regions.com/api/open/evenements.json?dept=${encodeURIComponent(slug)}&limit=500`,{headers:{accept:'application/json','user-agent':'jai-besoin-de/1.0'}})]);if(!eventsRes.ok)return[];const communes=communesRes.ok?await communesRes.json():[];const coords=new Map(),byName=new Map();for(const c of Array.isArray(communes)?communes:[]){const co=c?.centre?.coordinates;if(Array.isArray(co)&&co.length>=2){const pos={lon:Number(co[0]),lat:Number(co[1])};coords.set(String(c.code),pos);byName.set(normTerm(c.nom),pos);}}const payload=await eventsRes.json();const arr=payload?.evenements||payload?.events||[];const today=new Date();today.setHours(0,0,0,0);const limitDate=new Date(today);limitDate.setDate(limitDate.getDate()+horizon);const out=[];for(const e of arr){const pos=coords.get(String(e.code_insee||''))||byName.get(normTerm(e.ville||''));if(!pos||!Number.isFinite(pos.lat)||!Number.isFinite(pos.lon))continue;const sd=e.date_debut?new Date(`${e.date_debut}T00:00:00`):null,ed=e.date_fin?new Date(`${e.date_fin}T23:59:59`):sd;if(sd&&!Number.isNaN(sd.getTime())&&sd>limitDate)continue;if(ed&&!Number.isNaN(ed.getTime())&&ed<today)continue;out.push({id:e.uuid||crypto.randomUUID(),title:e.nom||'Événement',category:e.categorie||'Événement',starts_at:e.date_debut||null,ends_at:e.date_fin||null,lat:pos.lat,lon:pos.lon,distance:Math.round(distanceM(lat,lon,pos.lat,pos.lon)),place:[e.ville,e.adresse].filter(Boolean).join(' · ')||e.ville||null,description:e.description||null,website:e.url||e.site_web||null,photo:e.photo||null,source:'France Évasion Régions / DATAtourisme'});}out.sort((a,b)=>(a.starts_at||'9999').localeCompare(b.starts_at||'9999')||a.distance-b.distance);const response=json(out,200,{'cache-control':'public,max-age=1800'});await cache.put(key,response.clone());return out;}catch{return[];}}
async function eventsEndpoint(env,url){const lat=toNum(url.searchParams.get('lat')),lon=toNum(url.searchParams.get('lon')),radius=clamp(toNum(url.searchParams.get('radius'),50000),1000,100000),days=clamp(toNum(url.searchParams.get('days'),180),7,365);if(!lat||!lon)return json({error:'Coordonnées manquantes'},400);const commune=await reverseCommune(lat,lon).catch(()=>null);const ext=[];if(env.EVENTS_API_URL){try{const u=new URL(env.EVENTS_API_URL);if(commune?.codeDepartement)u.searchParams.set('departement',commune.codeDepartement);u.searchParams.set('limit','300');const src=await fetch(u,{headers:{accept:'application/json'}});if(src.ok)ext.push(...normalizeEventsPayload(await src.json(),lat,lon));}catch{}}const tourism=await tourismEventsForDepartment(commune?.codeDepartement,lat,lon,days).catch(()=>[]);let community=[];if(env.DB){const deg=radius/111000;const rows=await env.DB.prepare(`SELECT * FROM community_events WHERE status='approved' AND lat BETWEEN ?1 AND ?2 AND lon BETWEEN ?3 AND ?4 AND starts_at >= datetime('now','-1 day') AND starts_at <= datetime('now',?5) ORDER BY starts_at LIMIT 200`).bind(lat-deg,lat+deg,lon-deg,lon+deg,`+${days} day`).all();community=(rows.results||[]).map(e=>({...e,source:'Communauté',distance:Math.round(distanceM(lat,lon,e.lat,e.lon))}));}const seen=new Set();const events=[...community,...tourism,...ext].filter(e=>Number(e.distance)<=radius).filter(e=>{const k=`${normTerm(e.title||'')}|${e.starts_at||''}|${normTerm(e.place||'')}`;if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>(a.starts_at||'9999').localeCompare(b.starts_at||'9999')||a.distance-b.distance).slice(0,120);return json({location:commune,events,days,generated_at:new Date().toISOString(),sources:['Communauté','DATAtourisme']});}

async function eventContributionEndpoint(request,env){
  if(!env.DB)return json({error:'Base D1 non configurée'},503);
  const b=await request.json();
  if(!b.title||!b.starts_at||!b.lat||!b.lon)return json({error:'Informations incomplètes'},400);
  const r=await env.DB.prepare(`INSERT INTO community_events(title,description,starts_at,ends_at,lat,lon,place_name,source_url,status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'pending')`).bind(String(b.title).slice(0,140),String(b.description||'').slice(0,1200),b.starts_at,b.ends_at||null,toNum(b.lat),toNum(b.lon),String(b.place_name||'').slice(0,160),String(b.source_url||'').slice(0,500)).run();
  return json({ok:true,id:r.meta?.last_row_id,status:'pending'},201);
}

async function getTransportCatalog(env){
  const key=new Request('https://cache.local/transport/catalog');
  const c=caches.default;
  let cached=await c.match(key);
  if(cached)return cached.json();
  const r=await fetch('https://transport.data.gouv.fr/api/datasets',{headers:{accept:'application/json'}});
  if(!r.ok)throw new Error('Catalogue transport indisponible');
  const all=await r.json();
  const arr=Array.isArray(all)?all:(all.datasets||all.results||[]);
  const res=json(arr,200,{'cache-control':'public,max-age=21600'});
  await c.put(key,res.clone());
  return arr;
}

async function getTransportDataset(env){
  const slug=env.TRANSPORT_DATASET_SLUG_SETRAM;
  const arr=await getTransportCatalog(env);
  const ds=arr.find(d=>d.slug===slug||d.datagouv_id===slug||d.title?.toLowerCase().includes('setram'));
  if(!ds)throw new Error('Jeu SETRAM introuvable');
  return ds;
}

function collectResources(ds){
  const found=[];
  const walk=(x)=>{ if(!x)return; if(Array.isArray(x))return x.forEach(walk); if(typeof x==='object'){ const maybeUrl=x.url||x.original_url||x.resource_url||x.latest_url; if(maybeUrl&&typeof maybeUrl==='string')found.push({name:String(x.title||x.name||x.filename||x.resource_title||''),url:maybeUrl,format:String(x.format||x.type||'')}); Object.values(x).forEach(v=>{if(v&&typeof v==='object')walk(v)}); }}; walk(ds); return [...new Map(found.map(x=>[x.url,x])).values()];
}

function chooseRealtimeResources(ds){
  const all=collectResources(ds);
  const by=(re)=>all.find(x=>re.test(`${x.name} ${x.url}`));
  return {
    vehicle: by(/vehicle.?position/i),
    trip: by(/trip.?update/i),
    alert: by(/alert|service.?alert/i)
  };
}


function chooseStaticGtfsResource(ds){
  const all=collectResources(ds);
  const ranked=all.map(x=>{
    const t=String(`${x.name} ${x.format} ${x.url}`).toLowerCase();
    let score=0;
    if(/gtfs/.test(t)) score+=80;
    if(/\.zip(?:$|\?)/i.test(x.url)||/zip/.test(String(x.format).toLowerCase())) score+=30;
    if(/theori|horaire|schedule|static|offre/.test(t)) score+=30;
    if(/vehicle.?position|trip.?update|service.?alert|temps.?reel|realtime|protobuf|\.pb(?:$|\?)/.test(t)) score-=180;
    return {x,score};
  }).filter(v=>v.score>40).sort((a,b)=>b.score-a.score);
  return ranked[0]?.x||null;
}

function tinyHash(v=''){
  let h=2166136261;
  for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(36);
}

async function gtfsZipBytes(url){
  const cache=caches.default;
  const key=new Request(`https://cache.local/gtfs-static/${tinyHash(url)}`);
  let hit=await cache.match(key);
  if(!hit){
    const src=await fetch(url,{headers:{accept:'application/zip,application/octet-stream'}});
    if(!src.ok) throw new Error(`GTFS ${src.status}`);
    hit=new Response(await src.arrayBuffer(),{headers:{'cache-control':'public,max-age=21600'}});
    await cache.put(key,hit.clone());
  }
  return new Uint8Array(await hit.arrayBuffer());
}

function parseGtfsCsv(text){
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;} else quoted=!quoted;
    }else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(field);field='';
      if(row.some(v=>v!=='')) rows.push(row);
      row=[];
    }else field+=c;
  }
  if(field||row.length){row.push(field);rows.push(row);}
  if(!rows.length)return [];
  const headers=rows.shift().map((h,i)=>String(h).replace(i===0?/^\uFEFF/:'','').trim());
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}

function gtfsFileText(files,name){
  const wanted=name.toLowerCase();
  const key=Object.keys(files).find(k=>k.split('/').pop().toLowerCase()===wanted);
  return key?strFromU8(files[key]):'';
}

function gtfsClockMinutes(v=''){
  const m=String(v).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  return m?Number(m[1])*60+Number(m[2]):null;
}

function gtfsServiceDate(offset){
  const now=parisParts();
  const d=new Date(Date.UTC(Number(now.year),Number(now.month)-1,Number(now.day)+offset,12));
  const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),day=String(d.getUTCDate()).padStart(2,'0');
  const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const labels=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  return {key:`${y}${m}${day}`,iso:`${y}-${m}-${day}`,weekday:weekdays[d.getUTCDay()],label:labels[d.getUTCDay()]};
}

function gtfsServiceActive(serviceId,date,calendar,exceptions){
  const ex=exceptions.get(`${date.key}|${serviceId}`);
  if(ex===1)return true;
  if(ex===2)return false;
  const c=calendar.get(serviceId);
  if(!c)return false;
  if(c.start_date&&date.key<c.start_date)return false;
  if(c.end_date&&date.key>c.end_date)return false;
  return String(c[date.weekday]||'0')==='1';
}

async function scheduledGtfsDepartures(dataset,lat,lon,radius=1500){
  const resource=chooseStaticGtfsResource(dataset);
  if(!resource)return [];
  const rounded=`${Number(lat).toFixed(3)}/${Number(lon).toFixed(3)}/${Math.round(radius/250)*250}`;
  const cache=caches.default;
  const cacheKey=new Request(`https://cache.local/gtfs-departures/${tinyHash(resource.url)}/${rounded}`);
  const cached=await cache.match(cacheKey);
  if(cached)return cached.json();

  const bytes=await gtfsZipBytes(resource.url);
  const files=unzipSync(bytes,{filter:f=>/(^|\/)(stops|stop_times|trips|routes|calendar|calendar_dates)\.txt$/i.test(f.name)});
  const stops=parseGtfsCsv(gtfsFileText(files,'stops.txt'));
  const nearby=stops.map(st=>{
    const slat=Number(st.stop_lat),slon=Number(st.stop_lon);
    if(!Number.isFinite(slat)||!Number.isFinite(slon))return null;
    const distance=Math.round(distanceM(lat,lon,slat,slon));
    return {...st,distance};
  }).filter(Boolean).filter(st=>st.distance<=radius&&String(st.location_type||'0')!=='1').sort((a,b)=>a.distance-b.distance).slice(0,35);
  if(!nearby.length)return [];

  const stopMap=new Map(nearby.map(st=>[String(st.stop_id),st]));
  const trips=new Map(parseGtfsCsv(gtfsFileText(files,'trips.txt')).map(t=>[String(t.trip_id),t]));
  const routes=new Map(parseGtfsCsv(gtfsFileText(files,'routes.txt')).map(r=>[String(r.route_id),r]));
  const calendar=new Map(parseGtfsCsv(gtfsFileText(files,'calendar.txt')).map(c=>[String(c.service_id),c]));
  const exceptions=new Map();
  for(const e of parseGtfsCsv(gtfsFileText(files,'calendar_dates.txt'))){
    exceptions.set(`${e.date}|${e.service_id}`,Number(e.exception_type));
  }
  const stopTimes=parseGtfsCsv(gtfsFileText(files,'stop_times.txt')).filter(st=>stopMap.has(String(st.stop_id)));
  const pp=parisParts();
  const nowMinute=Number(pp.hour)*60+Number(pp.minute||0);
  const bestByTripDay=new Map();

  for(let serviceOffset=0;serviceOffset<8;serviceOffset++){
    const date=gtfsServiceDate(serviceOffset);
    for(const st of stopTimes){
      const trip=trips.get(String(st.trip_id));
      if(!trip||!gtfsServiceActive(String(trip.service_id),date,calendar,exceptions))continue;
      const tm=gtfsClockMinutes(st.departure_time||st.arrival_time);
      if(tm==null)continue;
      const absolute=serviceOffset*1440+tm;
      if(absolute<nowMinute||absolute>nowMinute+7*1440)continue;
      const actualDayOffset=Math.floor(absolute/1440);
      const clock=absolute%1440;
      const hh=String(Math.floor(clock/60)).padStart(2,'0'),mm=String(clock%60).padStart(2,'0');
      const stop=stopMap.get(String(st.stop_id));
      const route=routes.get(String(trip.route_id))||{};
      const key=`${trip.trip_id}|${date.key}`;
      const item={
        trip_id:String(trip.trip_id),route_id:String(trip.route_id||''),line:String(route.route_short_name||route.route_long_name||trip.route_id||'?'),
        headsign:String(trip.trip_headsign||route.route_long_name||''),stop_id:String(st.stop_id),stop_name:String(stop.stop_name||'Arrêt proche'),
        stop_distance:Number(stop.distance||0),departure_time:`${hh}:${mm}`,minutes_until:absolute-nowMinute,day_offset:actualDayOffset,
        day_label:actualDayOffset===0?'Aujourd’hui':actualDayOffset===1?'Demain':gtfsServiceDate(actualDayOffset).label,
        service_date:date.iso,scheduled:true
      };
      const prev=bestByTripDay.get(key);
      if(!prev||item.stop_distance<prev.stop_distance)bestByTripDay.set(key,item);
    }
  }
  const departures=[...bestByTripDay.values()].sort((a,b)=>a.minutes_until-b.minutes_until||a.stop_distance-b.stop_distance).slice(0,14);
  const response=json(departures,200,{'cache-control':'public,max-age=300'});
  await cache.put(cacheKey,response.clone());
  return departures;
}

function textFold(v=''){ return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

async function findRealtimeDataset(env, lat, lon){
  const commune=await reverseCommune(lat,lon).catch(()=>null);
  const arr=await getTransportCatalog(env);
  const communeName=textFold(commune?.nom||'');
  const insee=String(commune?.code||'');
  const nearLeMans=distanceM(lat,lon,48.0061,0.1996)<50000;
  const scored=[];
  for(const ds of arr){
    const resources=chooseRealtimeResources(ds);
    const staticGtfs=chooseStaticGtfsResource(ds);
    if(!resources.vehicle && !staticGtfs) continue;
    const hay=textFold(JSON.stringify({title:ds.title,slug:ds.slug,covered_area:ds.covered_area,territory:ds.territory,aom:ds.aom}));
    let score=0;
    if(communeName.length>2 && hay.includes(communeName)) score+=120;
    if(insee && new RegExp(`(^|\D)${insee}(\D|$)`).test(hay)) score+=180;
    if(nearLeMans && /setram|le mans/.test(hay)) score+=300;
    if(staticGtfs) score+=25;
    if(score>0) scored.push({ds,score});
  }
  scored.sort((a,b)=>b.score-a.score);
  const best=scored[0];
  return {commune,dataset:best&&best.score>=100?best.ds:null};
}

async function decodeGtfsRt(url){
  if(!url)return null;
  const cacheKey=new Request(`https://cache.local/rt/${tinyHash(String(url))}`);
  const c=caches.default;
  let rr=await c.match(cacheKey);
  if(!rr){
    const src=await fetch(url,{headers:{accept:'application/x-protobuf,application/octet-stream'}});
    if(!src.ok)throw new Error(`GTFS-RT ${src.status}`);
    rr=new Response(await src.arrayBuffer(),{headers:{'cache-control':'public,max-age=15'}});
    await c.put(cacheKey,rr.clone());
  }
  const bytes=new Uint8Array(await rr.arrayBuffer());
  return transit_realtime.FeedMessage.decode(bytes);
}

function epochSeconds(v){ if(v==null)return null; if(typeof v==='number')return v; if(typeof v==='bigint')return Number(v); if(typeof v==='object'&&typeof v.toNumber==='function')return v.toNumber(); return Number(v)||null; }

async function transportEndpoint(env,url){
  const lat=toNum(url.searchParams.get('lat')),lon=toNum(url.searchParams.get('lon')),radius=clamp(toNum(url.searchParams.get('radius'),1500),500,5000);
  if(!lat||!lon)return json({error:'Coordonnées manquantes'},400);
  try{
    const found=await findRealtimeDataset(env,lat,lon);
    if(!found.dataset)return json({network:null,message:'Aucun réseau local compatible détecté pour cette zone.',vehicles:[],departures:[],alerts:[],coverage:'catalogue-only',location:found.commune});
    const resources=chooseRealtimeResources(found.dataset);
    const [vf,tf,af,departures]=await Promise.all([
      decodeGtfsRt(resources.vehicle?.url).catch(()=>null),
      decodeGtfsRt(resources.trip?.url).catch(()=>null),
      decodeGtfsRt(resources.alert?.url).catch(()=>null),
      scheduledGtfsDepartures(found.dataset,lat,lon,Math.min(radius,1500)).catch(()=>[])
    ]);
    const trips=new Map();
    for(const e of tf?.entity||[]) if(e.tripUpdate?.trip?.tripId) trips.set(e.tripUpdate.trip.tripId,e.tripUpdate);
    const now=Date.now()/1000;
    const vehicles=[];
    for(const e of vf?.entity||[]){
      const vp=e.vehicle;
      if(!vp?.position)continue;
      const vlat=Number(vp.position.latitude),vlon=Number(vp.position.longitude);
      const dist=Math.round(distanceM(lat,lon,vlat,vlon));
      if(dist>radius)continue;
      const tripId=vp.trip?.tripId||null, routeId=vp.trip?.routeId||null, tu=tripId?trips.get(tripId):null;
      let nextTime=null,nextStopId=vp.stopId||null;
      if(tu?.stopTimeUpdate?.length){
        const seq=vp.currentStopSequence||0;
        const st=tu.stopTimeUpdate.find(x=>!seq||Number(x.stopSequence)>=Number(seq))||tu.stopTimeUpdate[0];
        nextTime=epochSeconds(st?.arrival?.time)||epochSeconds(st?.departure?.time)||null;
        nextStopId=st?.stopId||nextStopId;
      }
      vehicles.push({id:e.id||vp.vehicle?.id||tripId||crypto.randomUUID(),line:routeId||'?',trip_id:tripId,vehicle:vp.vehicle?.label||vp.vehicle?.id||null,lat:vlat,lon:vlon,distance:dist,next_stop_id:nextStopId,eta_minutes:nextTime?Math.max(0,Math.round((nextTime-now)/60)):null,status:vp.currentStatus||null,timestamp:epochSeconds(vp.timestamp)});
    }
    vehicles.sort((a,b)=>a.distance-b.distance);
    const alerts=(af?.entity||[]).filter(e=>e.alert).slice(0,30).map(e=>({
      id:e.id,title:e.alert.headerText?.translation?.[0]?.text||'Information trafic',description:e.alert.descriptionText?.translation?.[0]?.text||'',effect:e.alert.effect||null,
      route_ids:[...new Set((e.alert.informedEntity||[]).map(x=>x.routeId).filter(Boolean))]
    }));
    return json({network:found.dataset.title||found.dataset.slug||'Réseau local',coverage:resources.vehicle?'realtime+schedule':'schedule',location:found.commune,vehicles:vehicles.slice(0,20),departures,alerts,resources:{vehicle:Boolean(resources.vehicle),trip:Boolean(resources.trip),alert:Boolean(resources.alert),static:Boolean(chooseStaticGtfsResource(found.dataset))},generated_at:new Date().toISOString()});
  }catch(err){
    return json({network:null,coverage:'degraded',vehicles:[],departures:[],alerts:[],message:'Les données transport sont momentanément indisponibles.',details:String(err.message||err)},200);
  }
}

function parisParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((a,p)=>(a[p.type]=p.value,a),{});
  return parts;
}

function parisDateKey(date = new Date()) {
  const p = parisParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function escapeEmailHtml(value='') {
  return String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
}

async function visitorHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';
  const salt = env.ANALYTICS_SALT || env.APP_NAME || 'jai-besoin-de';
  const raw = `${parisDateKey()}|${ip}|${ua}|${salt}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function logAnalytics(request, env, eventType, label) {
  if (!env.DB) return;
  const type = normTerm(eventType || 'interaction').replace(/ /g,'_').slice(0,40) || 'interaction';
  const cleanLabel = String(label || 'site').trim().slice(0,160) || 'site';
  const visitor = await visitorHash(request, env);
  const day = parisDateKey();
  await env.DB.prepare(`INSERT INTO analytics_events(day,visitor_hash,event_type,label,hits,last_seen)
    VALUES(?1,?2,?3,?4,1,CURRENT_TIMESTAMP)
    ON CONFLICT(day,visitor_hash,event_type,label) DO UPDATE SET hits=hits+1,last_seen=CURRENT_TIMESTAMP`)
    .bind(day,visitor,type,cleanLabel).run();
}

async function analyticsEventEndpoint(request, env) {
  let body={};
  try { body=await request.json(); } catch { return json({error:'Données invalides'},400); }
  await logAnalytics(request, env, body.event_type || 'interaction', body.label || 'site');
  return json({ok:true});
}

async function sendOwnerEmail(env, {subject, text, html, replyTo}) {
  if (!env.EMAIL) throw new Error('Binding EMAIL non configuré');
  if (!env.OWNER_EMAIL) throw new Error('Secret OWNER_EMAIL non configuré');
  if (!env.MAIL_FROM || env.MAIL_FROM.includes('VOTRE-DOMAINE')) throw new Error('MAIL_FROM non configuré');
  const message = {
    from: { email: env.MAIL_FROM, name: env.APP_NAME || 'J’ai besoin de...' },
    to: env.OWNER_EMAIL,
    subject,
    text,
    html
  };
  if (replyTo) message.replyTo = replyTo;
  return env.EMAIL.send(message);
}

async function contactEndpoint(request, env) {
  let b={};
  try { b=await request.json(); } catch { return json({error:'Message invalide'},400); }
  if (String(b.website||'').trim()) return json({ok:true});
  const name=String(b.name||'').trim().slice(0,100);
  const email=String(b.email||'').trim().slice(0,180);
  const message=String(b.message||'').trim().slice(0,5000);
  const page=String(b.page||'/').trim().slice(0,200);
  if(message.length<3)return json({error:'Écris ta question avant de l’envoyer.'},400);
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:'Adresse e-mail invalide.'},400);
  const subject=`${env.APP_NAME||'J’ai besoin de...'} | Question visiteur`;
  const text=[
    'Nouvelle question reçue depuis le site.', '',
    `Nom : ${name||'Non indiqué'}`,
    `E-mail visiteur : ${email||'Non indiqué'}`,
    `Page : ${page}`, '',
    'Message :', message
  ].join('\n');
  const html=`<h2>Nouvelle question reçue depuis le site</h2><p><strong>Nom :</strong> ${escapeEmailHtml(name||'Non indiqué')}<br><strong>E-mail visiteur :</strong> ${escapeEmailHtml(email||'Non indiqué')}<br><strong>Page :</strong> ${escapeEmailHtml(page)}</p><p><strong>Message :</strong></p><p style="white-space:pre-wrap">${escapeEmailHtml(message)}</p>`;
  try {
    await sendOwnerEmail(env,{subject,text,html});
    await logAnalytics(request, env, 'contact', 'question_envoyee').catch(()=>{});
    return json({ok:true});
  } catch(e) {
    return json({error:'Le message n’a pas pu être envoyé pour le moment.',details:String(e.message||e)},503);
  }
}

async function buildAnalyticsReport(env, day) {
  if(!env.DB) return null;
  const [visitors,pageviews,events,searches,contribs] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(DISTINCT visitor_hash) n FROM analytics_events WHERE day=?1`).bind(day).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(hits),0) n FROM analytics_events WHERE day=?1 AND event_type='pageview'`).bind(day).first(),
    env.DB.prepare(`SELECT event_type,label,SUM(hits) hits,COUNT(DISTINCT visitor_hash) visitors FROM analytics_events WHERE day=?1 GROUP BY event_type,label ORDER BY hits DESC LIMIT 20`).bind(day).all(),
    env.DB.prepare(`SELECT term,count FROM search_daily WHERE day=?1 ORDER BY count DESC,term LIMIT 15`).bind(day).all(),
    env.DB.prepare(`SELECT COUNT(*) n FROM contributions WHERE substr(created_at,1,10)=?1`).bind(day).first()
  ]);
  return {day,visitors:Number(visitors?.n||0),pageviews:Number(pageviews?.n||0),events:events.results||[],searches:searches.results||[],contributions:Number(contribs?.n||0)};
}

function reportEmail(report, appName) {
  const topEvents=report.events.filter(x=>x.event_type!=='pageview').slice(0,12);
  const textEvents=topEvents.length?topEvents.map(x=>`• ${x.label}: ${x.hits} consultation(s), ${x.visitors} visiteur(s)`).join('\n'):'• Aucune interaction enregistrée';
  const textSearch=report.searches.length?report.searches.map(x=>`• ${x.term}: ${x.count}`).join('\n'):'• Aucune recherche enregistrée';
  const text=`Statistiques du ${report.day}\n\nVisiteurs estimés : ${report.visitors}\nPages vues : ${report.pageviews}\nContributions : ${report.contributions}\n\nRubriques et actions les plus consultées\n${textEvents}\n\nRecherches les plus fréquentes\n${textSearch}\n\nLes visiteurs sont estimés sans enregistrer leur adresse IP brute.`;
  const rows=topEvents.map(x=>`<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeEmailHtml(x.label)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${x.hits}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${x.visitors}</td></tr>`).join('')||'<tr><td colspan="3">Aucune interaction enregistrée</td></tr>';
  const searches=report.searches.map(x=>`<li>${escapeEmailHtml(x.term)} : <strong>${x.count}</strong></li>`).join('')||'<li>Aucune recherche enregistrée</li>';
  const html=`<div style="font-family:Arial,sans-serif;max-width:700px"><h2>${escapeEmailHtml(appName)} : statistiques du ${report.day}</h2><p><strong>${report.visitors}</strong> visiteur(s) estimé(s) · <strong>${report.pageviews}</strong> page(s) vue(s) · <strong>${report.contributions}</strong> contribution(s)</p><h3>Rubriques et actions les plus consultées</h3><table style="border-collapse:collapse;width:100%"><thead><tr><th style="text-align:left">Rubrique</th><th>Vues</th><th>Visiteurs</th></tr></thead><tbody>${rows}</tbody></table><h3>Recherches les plus fréquentes</h3><ul>${searches}</ul><p style="color:#666;font-size:12px">Les visiteurs sont estimés avec un identifiant technique renouvelé chaque jour. L’adresse IP brute n’est pas enregistrée dans la base.</p></div>`;
  return {text,html};
}

async function maybeSendDailyAnalytics(env) {
  if(!env.DB || !env.EMAIL || !env.OWNER_EMAIL) return;
  const p=parisParts();
  if(Number(p.hour)!==20) return;
  const day=parisDateKey();
  const exists=await env.DB.prepare(`SELECT day FROM analytics_reports WHERE day=?1 AND status='sent'`).bind(day).first();
  if(exists) return;
  const report=await buildAnalyticsReport(env,day);
  const mail=reportEmail(report,env.APP_NAME||'J’ai besoin de...');
  try{
    await sendOwnerEmail(env,{subject:`${env.APP_NAME||'J’ai besoin de...'} | Statistiques ${day}`,text:mail.text,html:mail.html});
    await env.DB.prepare(`INSERT INTO analytics_reports(day,sent_at,status) VALUES(?1,CURRENT_TIMESTAMP,'sent') ON CONFLICT(day) DO UPDATE SET sent_at=CURRENT_TIMESTAMP,status='sent'`).bind(day).run();
  }catch(e){
    await env.DB.prepare(`INSERT INTO analytics_reports(day,sent_at,status,error) VALUES(?1,CURRENT_TIMESTAMP,'error',?2) ON CONFLICT(day) DO UPDATE SET sent_at=CURRENT_TIMESTAMP,status='error',error=excluded.error`).bind(day,String(e.message||e).slice(0,500)).run();
  }
}

async function cleanupAnalytics(env) {
  if(!env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM analytics_events WHERE day < date('now','-90 day')`),
    env.DB.prepare(`DELETE FROM search_daily WHERE day < date('now','-90 day')`),
    env.DB.prepare(`DELETE FROM analytics_reports WHERE day < date('now','-180 day')`)
  ]);
}

async function categoriesEndpoint(env){
  const base=Object.keys(CATEGORY_RULES).map(slug=>({slug,label:labelForCategory(slug),status:'active'}));
  if(!env.DB)return json({categories:base,trending:[]});
  const rows=await env.DB.prepare(`SELECT slug,label,score,status FROM category_candidates WHERE status IN ('active','candidate') ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, score DESC LIMIT 80`).all();
  const trend=await env.DB.prepare(`SELECT term,count FROM search_terms WHERE known_category=0 ORDER BY count DESC,last_seen DESC LIMIT 12`).all();
  return json({categories:[...base,...(rows.results||[])].filter((x,i,a)=>a.findIndex(y=>y.slug===x.slug)===i),trending:trend.results||[]});
}

async function sourceHealth(env){
  if(!env.DB)return;
  const rows=await env.DB.prepare('SELECT source_key,source_url FROM source_status').all();
  for(const s of rows.results||[]){
    try{ const r=await fetch(s.source_url,{method:'HEAD'}); await env.DB.prepare(`UPDATE source_status SET status=?2,checked_at=CURRENT_TIMESTAMP,details=?3 WHERE source_key=?1`).bind(s.source_key,r.ok?'ok':`http-${r.status}`,r.statusText||'').run(); }
    catch(e){ await env.DB.prepare(`UPDATE source_status SET status='error',checked_at=CURRENT_TIMESTAMP,details=?2 WHERE source_key=?1`).bind(s.source_key,String(e.message||e).slice(0,500)).run(); }
  }
}

async function promoteSearchTrends(env){
  if(!env.DB)return;
  const rows=await env.DB.prepare(`SELECT term,count FROM search_terms WHERE known_category=0 AND count>=5 ORDER BY count DESC LIMIT 50`).all();
  for(const r of rows.results||[]){
    const slug=slugify(r.term); await env.DB.prepare(`INSERT INTO category_candidates(slug,label,source_term,score,status,updated_at) VALUES(?1,?2,?3,?4,CASE WHEN ?4>=25 THEN 'active' ELSE 'candidate' END,CURRENT_TIMESTAMP)
      ON CONFLICT(slug) DO UPDATE SET score=excluded.score,status=CASE WHEN excluded.score>=25 THEN 'active' ELSE category_candidates.status END,updated_at=CURRENT_TIMESTAMP`).bind(slug,r.term.replace(/\b\w/g,c=>c.toUpperCase()),r.term,r.count).run();
  }
}

async function statusEndpoint(env){
  if(!env.DB)return json({sources:[]});
  const rows=await env.DB.prepare('SELECT * FROM source_status ORDER BY source_key').all(); return json({sources:rows.results||[]});
}

function isAdmin(request,env){ const key=request.headers.get('x-admin-key')||new URL(request.url).searchParams.get('key'); return Boolean(env.ADMIN_KEY)&&key===env.ADMIN_KEY; }

async function handleApi(request,env,url){
  if(url.pathname==='/api/health')return json({ok:true,name:env.APP_NAME||'J’ai besoin de...',time:new Date().toISOString()});
  if(url.pathname==='/api/places'&&request.method==='GET')return placesEndpoint(request,env,url);
  if(url.pathname==='/api/contributions'&&request.method==='POST')return contributionEndpoint(request,env);
  if(url.pathname.startsWith('/api/photos/')&&request.method==='GET')return photoEndpoint(env,decodeURIComponent(url.pathname.slice('/api/photos/'.length)));
  if(url.pathname==='/api/events'&&request.method==='GET')return eventsEndpoint(env,url);
  if(url.pathname==='/api/events/contribute'&&request.method==='POST')return eventContributionEndpoint(request,env);
  if(url.pathname==='/api/transport/nearby'&&request.method==='GET')return transportEndpoint(env,url);
  if(url.pathname==='/api/categories'&&request.method==='GET')return categoriesEndpoint(env);
  if(url.pathname==='/api/status'&&request.method==='GET')return statusEndpoint(env);
  if(url.pathname==='/api/contact'&&request.method==='POST')return contactEndpoint(request,env);
  if(url.pathname==='/api/analytics/event'&&request.method==='POST')return analyticsEventEndpoint(request,env);
  if(url.pathname==='/api/search/log'&&request.method==='POST'){ const b=await request.json(); const c=detectCategory(b.q||''); await logSearch(env,b.q||'',toNum(b.lat),toNum(b.lon),Boolean(c)); return json({ok:true,category:c}); }
  if(url.pathname==='/api/admin/promote'&&request.method==='POST'){ if(!isAdmin(request,env))return json({error:'Accès refusé'},403); await promoteSearchTrends(env); return json({ok:true}); }
  if(url.pathname==='/api/admin/check-sources'&&request.method==='POST'){ if(!isAdmin(request,env))return json({error:'Accès refusé'},403); await sourceHealth(env); return json({ok:true}); }
  return json({error:'Route API inconnue'},404);
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(url.pathname.startsWith('/api/'))return await handleApi(request,env,url);
      return env.ASSETS.fetch(request);
    }catch(err){ return json({error:'Erreur interne',details:String(err.message||err)},500); }
  },
  async scheduled(controller,env,ctx){
    ctx.waitUntil(promoteSearchTrends(env));
    ctx.waitUntil(sourceHealth(env));
    ctx.waitUntil(maybeSendDailyAnalytics(env));
    ctx.waitUntil(cleanupAnalytics(env));
  }
};
