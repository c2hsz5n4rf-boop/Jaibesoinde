from pathlib import Path

p=Path('src/entry.js')
s=p.read_text()
# Make high-vehicle wording win before the generic parking alias.
s=s.replace("[/parking|stationnement/i, 'parking']", "[/parking(?!.*(?:haut|hauteur|grand gabarit))|stationnement/i, 'parking']")
# Add a compatibility note for explicitly motorhome/caravan/HGV-friendly parking in the camping-car category too.
old="""      if(category==='parkinghaut'){
        results=results.filter(x=>{
          const t=x.tags||{};
          const raw=String(t.maxheight||t['maxheight:physical']||'').replace(',','.').toLowerCase();
          const mh=/none|default|unlimited/.test(raw)?99:(parseFloat(raw)||null);
          const explicit=['yes','designated','permissive'].includes(String(t.motorhome||t.caravan||t.hgv||'').toLowerCase());
          const surface=String(t.parking||'').toLowerCase()==='surface';
          if(mh!=null&&mh<3.0)return false;
          x.height_note=explicit?'Camping-car ou grand gabarit indiqué comme accepté':mh!=null&&mh<90?`Hauteur renseignée : ${mh.toFixed(1)} m`:surface?'Parking extérieur, hauteur à vérifier à l’entrée':'Accès grand gabarit à vérifier';
          return explicit||mh!=null||surface;
        });
      }"""
new="""      if(category==='parkinghaut'){
        results=results.filter(x=>{
          const t=x.tags||{};
          const raw=String(t.maxheight||t['maxheight:physical']||'').replace(',','.').toLowerCase();
          const mh=/none|default|unlimited/.test(raw)?99:(parseFloat(raw)||null);
          const explicit=[t.motorhome,t.caravan,t.hgv].some(v=>['yes','designated','permissive'].includes(String(v||'').toLowerCase()));
          const surface=String(t.parking||'').toLowerCase()==='surface';
          if(mh!=null&&mh<3.0)return false;
          x.height_note=explicit?'Camping-car ou grand gabarit indiqué comme accepté':mh!=null&&mh<90?`Hauteur renseignée : ${mh.toFixed(1)} m`:surface?'Parking extérieur, hauteur à vérifier à l’entrée':'Accès grand gabarit à vérifier';
          return explicit||mh!=null||surface;
        });
      }else if(category==='campingcar'){
        results.forEach(x=>{
          const t=x.tags||{};
          if(String(t.amenity||'')==='parking'&&[t.motorhome,t.caravan,t.hgv].some(v=>['yes','designated','permissive'].includes(String(v||'').toLowerCase()))) x.height_note='Parking indiqué comme compatible camping-car ou grand gabarit';
        });
      }"""
if old in s:s=s.replace(old,new)
p.write_text(s)

p=Path('public/app.js')
s=p.read_text()
s=s.replace("const top=['toilettes','laverie','eau','pharmacie','recharge','campingcar'];", "const top=['toilettes','laverie','eau','pharmacie','recharge','campingcar','parkinghaut'];")
s=s.replace("${escapeHtml(by.get(s)?.label||s)}", "${escapeHtml(by.get(s)?.label||({parkinghaut:'Parking véhicule haut'})[s]||s)}")
p.write_text(s)
