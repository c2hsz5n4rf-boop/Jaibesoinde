import app from './worker.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const WEB3FORMS_URL = 'https://api.web3forms.com/submit';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function parisParts(date = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
}

function parisDateKey(date = new Date()) {
  const p = parisParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

async function sendWeb3Forms(env, fields) {
  if (!env.WEB3FORMS_KEY) throw new Error('WEB3FORMS_KEY non configuré');
  const response = await fetch(WEB3FORMS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ access_key: env.WEB3FORMS_KEY, ...fields })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.message || `Web3Forms ${response.status}`);
  return data;
}

async function contactEndpoint(request, env) {
  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'Message invalide' }, 400); }
  if (String(body.website || '').trim()) return json({ ok: true });

  const name = String(body.name || '').trim().slice(0, 100);
  const email = String(body.email || '').trim().slice(0, 180);
  const message = String(body.message || '').trim().slice(0, 5000);
  const page = String(body.page || '/').trim().slice(0, 200);

  if (message.length < 3) return json({ error: 'Écris ta question avant de l’envoyer.' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Adresse e-mail invalide.' }, 400);

  try {
    await sendWeb3Forms(env, {
      subject: `${env.APP_NAME || 'J’ai besoin de...'} | Question visiteur`,
      from_name: env.APP_NAME || 'J’ai besoin de...',
      name: name || 'Visiteur du site',
      email: email || 'noreply@web3forms.com',
      message: `Nouvelle question reçue depuis le site.\n\nNom : ${name || 'Non indiqué'}\nE-mail visiteur : ${email || 'Non indiqué'}\nPage : ${page}\n\nMessage :\n${message}`
    });
    return json({ ok: true });
  } catch (error) {
    return json({ error: 'Le message n’a pas pu être envoyé pour le moment.', details: String(error.message || error) }, 503);
  }
}

async function sendDailyAnalytics(env) {
  if (!env.DB || !env.WEB3FORMS_KEY) return;
  const p = parisParts();
  if (Number(p.hour) !== 20) return;
  const day = parisDateKey();

  try {
    const sent = await env.DB.prepare(`SELECT day FROM analytics_reports WHERE day=?1 AND status='sent'`).bind(day).first();
    if (sent) return;

    const [visitors, pageviews, events, searches, contribs] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(DISTINCT visitor_hash) n FROM analytics_events WHERE day=?1`).bind(day).first(),
      env.DB.prepare(`SELECT COALESCE(SUM(hits),0) n FROM analytics_events WHERE day=?1 AND event_type='pageview'`).bind(day).first(),
      env.DB.prepare(`SELECT event_type,label,SUM(hits) hits,COUNT(DISTINCT visitor_hash) visitors FROM analytics_events WHERE day=?1 GROUP BY event_type,label ORDER BY hits DESC LIMIT 15`).bind(day).all(),
      env.DB.prepare(`SELECT term,count FROM search_daily WHERE day=?1 ORDER BY count DESC,term LIMIT 12`).bind(day).all(),
      env.DB.prepare(`SELECT COUNT(*) n FROM contributions WHERE substr(created_at,1,10)=?1`).bind(day).first()
    ]);

    const topActions = (events.results || []).filter(x => x.event_type !== 'pageview').map(x => `• ${x.label}: ${x.hits} vue(s), ${x.visitors} visiteur(s)`).join('\n') || '• Aucune interaction enregistrée';
    const topSearches = (searches.results || []).map(x => `• ${x.term}: ${x.count}`).join('\n') || '• Aucune recherche enregistrée';
    const message = `Statistiques du ${day}\n\nVisiteurs estimés : ${Number(visitors?.n || 0)}\nPages vues : ${Number(pageviews?.n || 0)}\nContributions : ${Number(contribs?.n || 0)}\n\nRubriques et actions les plus consultées\n${topActions}\n\nRecherches les plus fréquentes\n${topSearches}\n\nLes visiteurs sont estimés sans enregistrer leur adresse IP brute.`;

    await sendWeb3Forms(env, {
      subject: `${env.APP_NAME || 'J’ai besoin de...'} | Statistiques ${day}`,
      from_name: env.APP_NAME || 'J’ai besoin de...',
      name: 'Rapport automatique',
      email: 'noreply@web3forms.com',
      message
    });

    await env.DB.prepare(`INSERT INTO analytics_reports(day,sent_at,status) VALUES(?1,CURRENT_TIMESTAMP,'sent') ON CONFLICT(day) DO UPDATE SET sent_at=CURRENT_TIMESTAMP,status='sent',error=NULL`).bind(day).run();
  } catch (error) {
    try {
      await env.DB.prepare(`INSERT INTO analytics_reports(day,sent_at,status,error) VALUES(?1,CURRENT_TIMESTAMP,'error',?2) ON CONFLICT(day) DO UPDATE SET sent_at=CURRENT_TIMESTAMP,status='error',error=excluded.error`).bind(day, String(error.message || error).slice(0,500)).run();
    } catch {}
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact' && request.method === 'POST') return contactEndpoint(request, env);
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (app.scheduled) await app.scheduled(controller, env, ctx);
    ctx.waitUntil(sendDailyAnalytics(env));
  }
};
