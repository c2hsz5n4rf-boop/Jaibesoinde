import app from './worker.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const WEB3FORMS_URL = 'https://api.web3forms.com/submit';

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
  restaurant: ['[amenity=restaurant]', '[amenity=fast_food]', '[shop=bakery]'],
  banque: ['[amenity=atm]', '[amenity=bank]'],
  poste: ['[amenity=post_office]'],
  bibliotheque: ['[amenity=library]'],
  airejeux: ['[leisure=playground]'],
  wifi: ['[internet_access=wlan]'],
  gare: ['[railway=station]', '[public_transport=station]'],
  centrecommercial: ['[shop=mall]']
};

const SEARCH_ALIASES = [
  [/toilet|wc|sanitaire/i, 'toilettes'], [/laverie|linge|machine.*laver/i, 'laverie'],
  [/eau|fontaine|gourde/i, 'eau'], [/pharma/i, 'pharmacie'], [/recharg|borne.*elect|voiture electrique|usb/i, 'recharge'],
  [/parking|stationnement/i, 'parking'], [/essence|gazole|diesel|carburant|station.service/i, 'carburant'],
  [/supermarch|courses|epicerie/i, 'supermarche'], [/veter/i, 'veterinaire'], [/defibr/i, 'defibrillateur'],
  [/douche/i, 'douche'], [/recycl|dechet/i, 'recyclage'], [/velo|gonfl/i, 'velo'],
  [/camping.?car|vidange|cassette wc/i, 'campingcar'], [/restaurant|manger|boulanger|repas/i, 'restaurant'],
  [/distributeur|banque|retrait/i, 'banque'], [/poste|courrier/i, 'poste'], [/biblioth|mediat/i, 'bibliotheque'],
  [/aire.*jeu|enfant/i, 'airejeux'], [/wifi|wi-fi|internet/i, 'wifi'], [/gare|station ferroviaire/i, 'gare'],
  [/centre commercial|centre-commercial|galerie marchande|mall/i, 'centrecommercial']
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
  return ({toilettes:'Toilettes',laverie:'Laverie',eau:'Point d’eau',pharmacie:'Pharmacie',recharge:'Borne de recharge',parking:'Parking',carburant:'Station-service',supermarche:'Supermarché',veterinaire:'Vétérinaire',defibrillateur:'Défibrillateur',douche:'Douche',recyclage:'Point de recyclage',velo:'Service vélo',campingcar:'Service camping-car',restaurant:'Restaurant',banque:'Distributeur / banque',poste:'Bureau de poste',bibliotheque:'Bibliothèque',airejeux:'Aire de jeux',wifi:'Wi-Fi',gare:'Gare',centrecommercial:'Centre commercial'})[cat] || 'Lieu utile';
}

function distanceM(lat1, lon1, lat2, lon2) {
  const R=6371000, p1=lat1*Math.PI/180, p2=lat2*Math.PI/180;
  const dp=(lat2-lat1)*Math.PI/180, dl=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function overpassBody(lat, lon, radius, category, q) {
  const rules=SEARCH_RULES[category] || [];
  if (rules.length) {
    const body=rules.flatMap(rule=>[`node${rule}(around:${radius},${lat},${lon});`,`way${rule}(around:${radius},${lat},${lon});`,`relation${rule}(around:${radius},${lat},${lon});`]).join('');
    return `[out:json][timeout:15];(${body});out center tags 100;`;
  }
  const safe=fold(q).split(' ').filter(w=>w.length>2).slice(0,4).join('.*').replace(/[\"']/g,'');
  if(!safe) return '';
  return `[out:json][timeout:15];(node["name"~"${safe}",i](around:${radius},${lat},${lon});way["name"~"${safe}",i](around:${radius},${lat},${lon});relation["name"~"${safe}",i](around:${radius},${lat},${lon});node["brand"~"${safe}",i](around:${radius},${lat},${lon});way["brand"~"${safe}",i](around:${radius},${lat},${lon}););out center tags 100;`;
}

async function searchFallback(url, env) {
  const lat=Number(url.searchParams.get('lat')), lon=Number(url.searchParams.get('lon'));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!lat||!lon) return json({error:'Coordonnées manquantes'},400);
  const radius=Math.max(100,Math.min(10000,Number(url.searchParams.get('radius'))||2500));
  const q=url.searchParams.get('q') || '';
  const category=url.searchParams.get('category') || detectCategory(q);
  const body=overpassBody(lat,lon,radius,category,q);
  if(!body) return json({category:'autre',label:`Résultats pour « ${q} »`,results:[],generated_at:new Date().toISOString()});

  const endpoints=[env.OVERPASS_URL,'https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.nchc.org.tw/api/interpreter'].filter(Boolean);
  let data=null;
  for(const endpoint of [...new Set(endpoints)]) {
    try {
      const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8','accept':'application/json'},body:new URLSearchParams({data:body}),signal:AbortSignal.timeout(12000)});
      if(!r.ok) continue;
      const candidate=await r.json();
      if(Array.isArray(candidate?.elements)){data=candidate;break;}
    } catch {}
  }
  if(!data) return json({category:category||'autre',label:category?categoryLabel(category):`Résultats pour « ${q} »`,results:[],generated_at:new Date().toISOString(),source_degraded:true});

  const results=(data.elements||[]).map(el=>{
    const pLat=el.lat ?? el.center?.lat, pLon=el.lon ?? el.center?.lon, t=el.tags||{};
    if(!Number.isFinite(pLat)||!Number.isFinite(pLon)) return null;
    return {id:`osm-${el.type}-${el.id}`,source:'OpenStreetMap',title:t.name||t.brand||categoryLabel(category),category:category||'autre',lat:pLat,lon:pLon,distance:Math.round(distanceM(lat,lon,pLat,pLon)),address:[t['addr:housenumber'],t['addr:street'],t['addr:city']].filter(Boolean).join(' ')||null,opening_hours:t.opening_hours||null,wheelchair:t.wheelchair||null,fee:t.fee||null,website:t.website||t['contact:website']||null,phone:t.phone||t['contact:phone']||null,tags:t};
  }).filter(Boolean).sort((a,b)=>a.distance-b.distance).slice(0,70);

  return json({category:category||'autre',label:category?categoryLabel(category):`Résultats pour « ${q} »`,results,generated_at:new Date().toISOString(),fallback:true});
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
      try {
        const primary=await app.fetch(request,env,ctx);
        if(primary.ok) {
          try {
            const data=await primary.clone().json();
            if(Array.isArray(data?.results)&&data.results.length>0) return primary;
          } catch { return primary; }
        }
      } catch {}
      return searchFallback(url,env);
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(controller, env, ctx) {
    if(app.scheduled) await app.scheduled(controller,env,ctx);
    ctx.waitUntil(sendDailyAnalytics(env));
  }
};