INSERT OR IGNORE INTO source_status(source_key, source_url, status) VALUES
('osm-overpass', 'https://overpass-api.de/api/interpreter', 'unknown'),
('transport-data-gouv', 'https://transport.data.gouv.fr/api/datasets', 'unknown'),
('events-france', 'https://france-evasion-regions.com/api/open/evenements.json', 'unknown');

INSERT OR IGNORE INTO category_candidates(slug,label,source_term,score,status) VALUES
('toilettes','Toilettes','toilettes',100,'active'),
('laverie','Laverie','laverie',100,'active'),
('eau','Eau potable','eau potable',100,'active'),
('pharmacie','Pharmacie','pharmacie',100,'active'),
('recharge','Recharge','recharge',100,'active'),
('parking','Parking','parking',100,'active'),
('camping-car','Camping-car','camping car',100,'active'),
('defibrillateur','Défibrillateur','défibrillateur',100,'active'),
('veterinaire','Vétérinaire','vétérinaire',100,'active'),
('supermarche','Supermarché','supermarché',100,'active');
