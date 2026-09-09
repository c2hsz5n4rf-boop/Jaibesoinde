import app from './worker.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const WEB3FORMS_URL = 'https://api.web3forms.com/submit';
const PHOTON_URL = 'https://photon.komoot.io';

const SEARCH_RULES = {
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
  restaurant: ['[amenity=restaurant]', '[amenity=fast_food]'],
  boulangerie: ['[shop=bakery]'],
  banque: ['[amenity=atm]', '[amenity=bank]'],
  poste: ['[amenity=post_office]'],
  bibliotheque: ['[amenity=library]'],
  airejeux: ['[leisure=playground]'],
  wifi: ['[internet_access=wlan]'],
  gare: ['[railway=station]', '[public_transport=station]'],
  centrecommercial: ['[shop=mall]'],
  medecin: ['[amenity=doctors]'],
  dentiste: ['[amenity=dentist]'],
  hopital: ['[amenity=hospital]'],
  coiffeur: ['[shop=hairdresser]'],
  cafe: ['[amenity=cafe]'],
  hotel: ['[tourism=hotel]'],
  garage: ['[shop=car_repair]'],
  lavageauto: ['[amenity=car_wash]'],
  opticien: ['[shop=optician]'],
  police: ['[amenity=police]'],
  mairie: ['[amenity=townhall]'],
  cinema: ['[amenity=cinema]'],
  musee: ['[tourism=museum]'],
  parc: ['[leisure=park]'],
  piscine: ['[leisure=swimming_pool]']
};

const PHOTON_TAGS = {
  toilettes: 'amenity:toilets', laverie: 'shop:laundry', eau: 'amenity:drinking_water', pharmacie: 'amenity:pharmacy',
  recharge: 'amenity:charging_station', parking: 'amenity:parking', carburant: 'amenity:fuel', supermarche: 'shop:supermarket',
  veterinaire: 'amenity:veterinary', defibrillateur: 'emergency:defibrillator', douche: 'amenity:shower', recyclage: 'amenity:recycling',
  velo: 'amenity:bicycle_repair_station', campingcar: 'tourism:caravan_site', restaurant: 'amenity:restaurant', boulangerie: 'shop:bakery',
  banque: 'amenity:bank', poste: 'amenity:post_office', bibliotheque: 'amenity:library', airejeux: 'leisure:playground', gare: 'railway:station',
  centrecommercial: 'shop:mall', medecin: 'amenity:doctors', dentiste: 'amenity:dentist', hopital: 'amenity:hospital', coiffeur: 'shop:hairdresser',
  cafe: 'amenity:cafe', hotel: 'tourism:hotel', garage: 'shop:car_repair', lavageauto: 'amenity:car_wash', opticien: 'shop:optician',
  police: 'amenity:police', mairie: 'amenity:townhall', cinema: 'amenity:cinema', musee: 'tourism:museum', parc: 'leisure:park', piscine: 'leisure:swimming_pool'
};

const SEARCH_ALIASES = [
  [/toilet|wc|sanitaire/i, 'toilettes'], [/laverie|linge|machine.*laver/i, 'laverie'],
  [/eau|fontaine|gourde/i, 'eau'], [/pharma/i, 'pharmacie'], [/recharg|borne.*elect|voiture electrique|usb/i, 'recharge'],
  [/parking|stationnement/i, 'parking'], [/essence|gazole|diesel|carburant|station.service/i, 'carburant'],
  [/supermarch|courses|epicerie/i, 'supermarche'], [/veter/i, 'veterinaire'], [/defibr/i, 'defibrillateur'],
  [/douche/i, 'douche'], [/recycl|dechet/i, 'recyclage'], [/velo|gonfl/i, 'velo'],
  [/camping.?car|vidange|cassette wc/i, 'campingcar'], [/boulanger|pain/i, 'boulangerie'], [/restaurant|manger|repas/i, 'restaurant'],
  [/distributeur|banque|retrait/i, 'banque'], [/poste|courrier/i, 'poste'], [/biblioth|mediat/i, 'bibliotheque'],
  [/aire.*jeu|enfant/i, 'airejeux'], [/wifi|wi-fi|internet/i, 'wifi'], [/gare|station ferroviaire/i, 'gare'],
  [/centre commercial|centre-commercial|galerie marchande|mall/i, 'centrecommercial'], [/medecin|docteur|generaliste/i, 'medecin'],
  [/dentiste/i, 'dentiste'], [/hopital|urgence|clinique/i, 'hopital'], [/coiffeur|coiffure/i, 'coiffeur'], [/cafe|coffee/i, 'cafe'],
  [/hotel|hebergement/i, 'hotel'], [/garage|reparation.*voiture|mecanicien/i, 'garage'], [/lavage.*auto|station.*lavage/i, 'lavageauto'],
  [/opticien|lunettes/i, 'opticien'], [/commissariat|police/i, 'police'], [/mairie|hotel de ville/i, 'mairie'], [/cinema/i, 'cinema'],
  [/musee/i, 'musee'], [/parc|jardin public/i, 'parc'], [/piscine/i, 'piscine']
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fold(v = '') {
  return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectCategory(q = '') {
  const n = fold(q);
  if (SEARCH_RULES[n]) return n;
  for (const [re, cat] of SEARCH_ALIASES) if (re.test(n)) return cat;
  return '';
}

function categoryLabel(cat) {
  return ({toilettes:'Toilettes',laverie:'Laverie',eau:'Point d’eau',pharmacie:'Pharmacie',recharge:'Borne de recharge',parking:'Parking',carburant:'Station-service',supermarche:'Supermarché',veterinaire:'Vétérinaire',defibrillateur:'Défibrillateur',douche:'Douche',recyclage:'Point de recyclage',velo:'Service vélo',campingcar:'Service camping-car',restaurant:'Restaurant',boulangerie:'Boulangerie',banque:'Distributeur / banque',poste:'Bureau de poste',bibliotheque:'Bibliothèque',airejeux:'Aire de jeux',wifi:'Wi-Fi',gare:'Gare',centrecommercial:'Centre commercial',medecin:'Médecin',dentiste:'Dentiste',hopital:'Hôpital / clinique',coiffeur:'Coiffeur',cafe:'Café',hotel:'Hôtel',garage:'Garage automobile',lavageauto:'Lavage automobile',opticien:'Opticien',police:'Police / commissariat',mairie:'Mairie',cinema:'Cinéma',musee:'Musée',parc:'Parc',piscine:'Piscine'})[cat] || 'Lieu utile';
}

function distanceM(lat1, lon1, lat2, lon2) {
  const R=6371000, p1=lat1*Math.PI/180, p2=lat2*Math.PI/180;
  const dp=(lat2-lat1)*Math.PI/180, dl=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function simplifyQuestion(q='') {
  return fold(q)
    .replace(/\b(ou|comment|je|j|nous|on|peut|peux|pourrais|voudrais|veux|cherche|chercher|trouver|besoin|avoir|aller|faire|pres|proche|autour|moi|ici|maintenant|ouvert|ouverte|ouvertes|le|la|les|un|une|des|du|de|mon|ma|mes|svp|s il vous plait)\b/g,' ')
    .replace(/\s+/g,' ').trim();
}

function overpassBody(lat, lon, radius, category, q) {
  const rules=SEARCH_RULES[category] || [];
  if (rules.length) {
    const body=rules.flatMap(rule=>[`node${rule}(around:${radius},${lat},${lon});`,`way${rule}(around:${radius},${lat},${lon});`,`relation${rule}(around:${radius},${lat},${lon});`]).join('');
    return `[out:json][timeout:10];(${body});out center tags 100;`;
  }
  const safe=(simplifyQuestion(q)||fold(q)).split(' ').filter(w=>w.length>2).slice(0,4).join('.*').replace(/[\"']/g,'');
  if(!safe) return '';
  return `[out:json][timeout:10];(node["name"~"${safe}",i](around:${radius},${lat},${lon});way["name"~"${safe}",i](around:${radius},${lat},${lon});relation["name"~"${safe}",i](around:${radius},${lat},${lon});node["brand"~"${safe}",i](around:${radius},${lat},${lon});way["brand"~"${safe}",i](around:${radius},${lat},${lon}););out center tags 100;`;
}

function normalizeOverpass(data, lat, lon, category) {
  return (data?.elements||[]).map(el=>{
    const pLat=el.lat ?? el.center?.lat, pLon=el.lon ?? el.center?.lon, t=el.tags||{};
    if(!Number.isFinite(pLat)||!Number.isFinite(pLon)) return null;
    return {id:`osm-${el.type}-${el.id}`,source:'OpenStreetMap',title:t.name||t.brand||categoryLabel(category),category:category||'autre',lat:pLat,lon:pLon,distance:Math.round(distanceM(lat,lon,pLat,pLon)),address:[t['addr:housenumber'],t['addr:street'],t['addr:postcode'],t['addr:city']].filter(Boolean).join(' ')||null,opening_hours:t.opening_hours||null,wheelchair:t.wheelchair||null,fee:t.fee||null,website:t.website||t['contact:website']||null,phone:t.phone||t['contact:phone']||null,tags:t};
  }).filter(Boolean);
}

async function queryOverpass(lat,lon,radius,category,q,env) {
  const body=overpassBody(lat,lon,radius,category,q);
  if(!body) return [];
  const endpoints=[env.OVERPASS_URL,'https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'].filter(Boolean);
  for(const endpoint of [...new Set(endpoints)]) {
    try {
      const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8','accept':'application/json','user-agent':'jai-besoin-de/1.0'},body:new URLSearchParams({data:body}),signal:AbortSignal.timeout(3500)});
      if(!r.ok) continue;
      const data=await r.json();
      const results=normalizeOverpass(data,lat,lon,category).filter(x=>x.distance<=radius);
      if(results.length) return results;
    } catch {}
  }
  return [];
}

function photonAddress(p={}) {
  return [p.housenumber,p.street,p.postcode,p.city||p.town||p.village||p.county].filter(Boolean).join(' ') || null;
}

function normalizePhoton(data,lat,lon,category,radius) {
  return (data?.features||[]).map((f,i)=>{
    const coords=f?.geometry?.coordinates||[], p=f?.properties||{};
    const pLon=Number(coords[0]),pLat=Number(coords[1]);
    if(!Number.isFinite(pLat)||!Number.isFinite(pLon)) return null;
    const distance=Math.round(distanceM(lat,lon,pLat,pLon));
    if(distance>radius) return null;
    return {id:`photon-${p.osm_type||'x'}-${p.osm_id||i}`,source:'OpenStreetMap',title:p.name||p.street||p.city||categoryLabel(category),category:category||'autre',lat:pLat,lon:pLon,distance,address:photonAddress(p),opening_hours:null,wheelchair:null,fee:null,website:null,phone:null,tags:{osm_key:p.osm_key,osm_value:p.osm_value}};
  }).filter(Boolean);
}

function bboxAround(lat,lon,radius) {
  const dLat=radius/111000;
  const dLon=radius/(111000*Math.max(.25,Math.cos(lat*Math.PI/180)));
  return `${lon-dLon},${lat-dLat},${lon+dLon},${lat+dLat}`;
}

async function queryPhoton(lat,lon,radius,category,q) {
  try {
    const tag=PHOTON_TAGS[category];
    let u;
    if(tag) {
      u=new URL(`${PHOTON_URL}/reverse`);
      u.searchParams.set('lon',String(lon)); u.searchParams.set('lat',String(lat));
      u.searchParams.set('radius',String(Math.max(1,Math.ceil(radius/1000))));
      u.searchParams.set('limit','30'); u.searchParams.set('lang','fr'); u.searchParams.set('osm_tag',tag);
    } else {
      const cleaned=simplifyQuestion(q)||fold(q);
      if(!cleaned) return [];
      u=new URL(`${PHOTON_URL}/api/`);
      u.searchParams.set('q',cleaned); u.searchParams.set('lat',String(lat)); u.searchParams.set('lon',String(lon));
      u.searchParams.set('bbox',bboxAround(lat,lon,radius)); u.searchParams.set('limit','30'); u.searchParams.set('lang','fr'); u.searchParams.set('countrycode','FR');
    }
    const r=await fetch(u,{headers:{accept:'application/json','user-agent':'jai-besoin-de/1.0'},signal:AbortSignal.timeout(3500)});
    if(!r.ok) return [];
    return normalizePhoton(await r.json(),lat,lon,category,radius);
  } catch { return []; }
}

function dedupeResults(items=[]) {
  const seen=new Set();
  return items.filter(x=>{
    const key=`${fold(x.title)}|${Number(x.lat).toFixed(4)}|${Number(x.lon).toFixed(4)}`;
    if(seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a.distance-b.distance);
}

async function searchFallback(url, env) {
  const lat=Number(url.searchParams.get('lat')), lon=Number(url.searchParams.get('lon'));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!lat||!lon) return json({error:'Coordonnées manquantes'},400);
  const requested=Math.max(100,Math.min(25000,Number(url.searchParams.get('radius'))||2500));
  const q=url.searchParams.get('q') || '';
  const category=url.searchParams.get('category') || detectCategory(q);
  const radii=[requested];

  for(const radius of radii) {
  const [photon,overpass]=await Promise.all([
    queryPhoton(lat,lon,radius,category,q),
    queryOverpass(lat,lon,radius,category,q,env)
  ]);
  const results=dedupeResults([...(photon||[]),...(overpass||[])]).slice(0,70);
  if(results.length) return json({category:category||'autre',label:category?categoryLabel(category):`Résultats pour « ${q} »`,results,generated_at:new Date().toISOString(),fallback:true,source:'OpenStreetMap',effective_radius:radius,auto_expanded:false});
}

  return json({category:category||'autre',label:category?categoryLabel(category):`Résultats pour « ${q} »`,results:[],generated_at:new Date().toISOString(),source_degraded:false,effective_radius:requested,message:`Aucun résultat trouvé dans un rayon de ${requested>=1000?(requested/1000)+' km':requested+' m'}. Essaie une distance plus grande.`});
}

function parisParts(date = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', {timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).reduce((a,p)=>(a[p.type]=p.value,a),{});
}

function parisDateKey(date = new Date()) {
  const p=parisParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

async function sendWeb3Forms(env, fields) {
  if (!env.WEB3FORMS_KEY) throw new Error('WEB3FORMS_KEY non configuré');
  const response=await fetch(WEB3FORMS_URL,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({access_key:env.WEB3FORMS_KEY,...fields})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.success===false) throw new Error(data.message||`Web3Forms ${response.status}`);
  return data;
}

async function contactEndpoint(request, env) {
  let body={};
  try{body=await request.json();}catch{return json({error:'Message invalide'},400);}
  if(String(body.website||'').trim()) return json({ok:true});
  const name=String(body.name||'').trim().slice(0,100), email=String(body.email||'').trim().slice(0,180), message=String(body.message||'').trim().slice(0,5000), page=String(body.page||'/').trim().slice(0,200);
  if(message.length<3) return json({error:'Écris ta question avant de l’envoyer.'},400);
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:'Adresse e-mail invalide.'},400);
  try{
    await sendWeb3Forms(env,{subject:`${env.APP_NAME||'J’ai besoin de...'} | Question visiteur`,from_name:env.APP_NAME||'J’ai besoin de...',name:name||'Visiteur du site',email:email||'noreply@web3forms.com',message:`Nouvelle question reçue depuis le site.\n\nNom : ${name||'Non indiqué'}\nE-mail visiteur : ${email||'Non indiqué'}\nPage : ${page}\n\nMessage :\n${message}`});
    return json({ok:true});
  }catch(error){return json({error:'Le message n’a pas pu être envoyé pour le moment.',details:String(error.message||error)},503);}
}

async function sendDailyAnalytics(env) {
  if(!env.DB||!env.WEB3FORMS_KEY) return;
  const p=parisParts();
  if(Number(p.hour)!==20) return;
  const day=parisDateKey();
  try{
    const sent=await env.DB.prepare(`SELECT day FROM analytics_reports WHERE day=?1 AND status='sent'`).bind(day).first();
    if(sent) return;
    const [visitors,pageviews,events,searches,contribs]=await Promise.all([
      env.DB.prepare(`SELECT COUNT(DISTINCT visitor_hash) n FROM analytics_events WHERE day=?1`).bind(day).first(),
      env.DB.prepare(`SELECT COALESCE(SUM(hits),0) n FROM analytics_events WHERE day=?1 AND event_type='pageview'`).bind(day).first(),
      env.DB.prepare(`SELECT event_type,label,SUM(hits) hits,COUNT(DISTINCT visitor_hash) visitors FROM analytics_events WHERE day=?1 GROUP BY event_type,label ORDER BY hits DESC LIMIT 15`).bind(day).all(),
      env.DB.prepare(`SELECT term,count FROM search_daily WHERE day=?1 ORDER BY count DESC,term LIMIT 12`).bind(day).all(),
      env.DB.prepare(`SELECT COUNT(*) n FROM contributions WHERE substr(created_at,1,10)=?1`).bind(day).first()
    ]);
    const topActions=(events.results||[]).filter(x=>x.event_type!=='pageview').map(x=>`• ${x.label}: ${x.hits} vue(s), ${x.visitors} visiteur(s)`).join('\n')||'• Aucune interaction enregistrée';
    const topSearches=(searches.results||[]).map(x=>`• ${x.term}: ${x.count}`).join('\n')||'• Aucune recherche enregistrée';
    const message=`Statistiques du ${day}\n\nVisiteurs estimés : ${Number(visitors?.n||0)}\nPages vues : ${Number(pageviews?.n||0)}\nContributions : ${Number(contribs?.n||0)}\n\nRubriques et actions les plus consultées\n${topActions}\n\nRecherches les plus fréquentes\n${topSearches}\n\nLes visiteurs sont estimés sans enregistrer leur adresse IP brute.`;
    await sendWeb3Forms(env,{subject:`${env.APP_NAME||'J’ai besoin de...'} | Statistiques ${day}`,from_name:env.APP_NAME||'J’ai besoin de...',name:'Rapport automatique',email:'noreply@web3forms.com',message});
    await env.DB.prepare(`INSERT INTO analytics_reports(day,sent_at,status) VALUES(?1,CURRENT_TIMESTAMP,'sent') ON CONFLICT(day) DO UPDATE SET sent_at=CURRENT_TIMESTAMP,status='sent',error=NULL`).bind(day).run();
  }catch(error){
    try{await env.DB.prepare(`INSERT INTO analytics_reports(day,sent_at,status,error) VALUES(?1,CURRENT_TIMESTAMP,'error',?2) ON CONFLICT(day) DO UPDATE SET sent_at=CURRENT_TIMESTAMP,status='error',error=excluded.error`).bind(day,String(error.message||error).slice(0,500)).run();}catch{}
  }
}

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    if(url.pathname==='/api/contact'&&request.method==='POST') return contactEndpoint(request,env);
    if(url.pathname==='/api/places'&&request.method==='GET') {
    const fallbackPromise=searchFallback(url,env);
    const primaryPromise=(async()=>{
      try {
        const primary=await app.fetch(request,env,ctx);
        if(!primary.ok) return null;
        const data=await primary.clone().json().catch(()=>null);
        return Array.isArray(data?.results)&&data.results.length>0?primary:null;
      } catch { return null; }
    })();
    const first=await Promise.race([
      fallbackPromise.then(r=>({kind:'fallback',r})),
      primaryPromise.then(r=>({kind:'primary',r}))
    ]);
    if(first.kind==='primary'&&first.r) return first.r;
    if(first.kind==='fallback') return first.r;
    return fallbackPromise;
  }
    return app.fetch(request,env,ctx);
  },
  async scheduled(controller, env, ctx) {
    if(app.scheduled) await app.scheduled(controller,env,ctx);
    ctx.waitUntil(sendDailyAnalytics(env));
  }
};