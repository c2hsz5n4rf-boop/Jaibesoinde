from pathlib import Path

schema = Path('db/schema.sql')
s = schema.read_text()
anchor = "CREATE INDEX IF NOT EXISTS idx_contributions_category ON contributions(category);\n"
addition = anchor + "\nCREATE TABLE IF NOT EXISTS contribution_photos (\n  photo_key TEXT PRIMARY KEY,\n  content_type TEXT NOT NULL,\n  data BLOB NOT NULL,\n  size INTEGER NOT NULL,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\n"
if 'CREATE TABLE IF NOT EXISTS contribution_photos' not in s:
    if anchor not in s:
        raise SystemExit('schema anchor not found')
    s = s.replace(anchor, addition, 1)
    schema.write_text(s)

worker = Path('src/worker.js')
w = worker.read_text()
old_contrib = """async function contributionEndpoint(request, env) {
  if (!env.DB) return json({error:'Base D1 non configurée'},503);
  const form = await request.formData();
  const title = String(form.get('title') || '').trim().slice(0,120);
  const category = String(form.get('category') || '').trim().slice(0,60);
  const description = String(form.get('description') || '').trim().slice(0,1000);
  const lat = toNum(form.get('lat')), lon = toNum(form.get('lon'));
  if (!title || !category || !lat || !lon) return json({error:'Titre, catégorie et position requis'},400);
  let photoKey = null;
  const photo = form.get('photo');
  if (photo && typeof photo === 'object' && photo.size && env.PHOTOS) {
    if (photo.size > 8*1024*1024) return json({error:'Photo limitée à 8 Mo'},413);
    const ext = (photo.type || 'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi,'') || 'jpg';
    photoKey = `${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;
    await env.PHOTOS.put(photoKey, await photo.arrayBuffer(), { httpMetadata:{ contentType:photo.type || 'image/jpeg' }, customMetadata:{ source:'community' } });
  }
  const result = await env.DB.prepare(`INSERT INTO contributions(title,category,description,lat,lon,photo_key,proof_status) VALUES(?1,?2,?3,?4,?5,?6,?7)`)
    .bind(title,category,description,lat,lon,photoKey,photoKey?'photo':'community').run();
  return json({ok:true,id:result.meta?.last_row_id,photo:photoKey?`/api/photos/${encodeURIComponent(photoKey)}`:null},201);
}

async function photoEndpoint(env, key) {
  if (!env.PHOTOS) return new Response('R2 non configuré',{status:404});
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Introuvable',{status:404});
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag',obj.httpEtag);
  headers.set('cache-control','public, max-age=86400');
  return new Response(obj.body,{headers});
}
"""
new_contrib = """async function contributionEndpoint(request, env) {
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
"""
if old_contrib not in w:
    raise SystemExit('worker photo block not found')
w = w.replace(old_contrib, new_contrib, 1)
worker.write_text(w)

app = Path('public/app.js')
a = app.read_text()
old_listener = """$('#contributionForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const status=$('#contributionStatus'); status.textContent='Envoi…';
  const fd=new FormData(e.currentTarget); fd.set('lat',state.lat); fd.set('lon',state.lon);
  try{ const r=await fetch('/api/contributions',{method:'POST',body:fd}); const d=await r.json(); if(!r.ok)throw new Error(d.error||'Erreur'); status.textContent='Information ajoutée. Merci.'; track('contribution','information_ajoutee'); e.currentTarget.reset(); setTimeout(()=>{dialog.close();status.textContent='';searchPlaces(state.q||state.category,!state.q);},900); }
  catch(err){status.textContent=err.message;}
});
"""
new_listener = """async function compressContributionPhoto(file){
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
"""
if old_listener not in a:
    raise SystemExit('app contribution listener not found')
a = a.replace(old_listener, new_listener, 1)
app.write_text(a)

# Trigger marker
