# J’ai besoin de... — V1 Cloudflare

Application web responsive pensée pour toute la France : recherche de services autour de soi, carte, contributions avec photo, événements, démarches, plans et transports en temps réel quand le réseau publie du GTFS-RT.

## Ce qui fonctionne dans cette V1

- Géolocalisation navigateur et recherche par rayon.
- Carte MapLibre avec fond OpenFreeMap / OpenStreetMap.
- Recherche OpenStreetMap à la demande : toilettes, laveries, eau potable, pharmacies, bornes de recharge, parkings, stations-service, supermarchés, vétérinaires, défibrillateurs, douches, recyclage, vélo, camping-car, restaurants, distributeurs, postes, bibliothèques, aires de jeux, Wi-Fi, gares et centres commerciaux.
- Recherche libre sur les noms et marques quand la demande ne correspond pas encore à une catégorie connue.
- Contributions communautaires avec photo, coordonnées et niveau de preuve.
- Stockage des photos dans Cloudflare R2.
- Stockage des contributions, recherches et tendances dans Cloudflare D1.
- Détection des nouvelles demandes : à partir de 5 recherches similaires, elles deviennent une catégorie candidate. À partir de 25, elles sont activées dans le catalogue interne.
- Événements proches via une source Open Data configurable, plus événements communautaires.
- Démarches : recherche vers Service-Public.fr et formulaires Cerfa officiels.
- Transport : détection automatique du réseau dans le catalogue national transport.data.gouv.fr. Si un réseau fournit VehiclePosition/TripUpdate/ServiceAlert en GTFS-RT, le site affiche les véhicules proches, une estimation de passage et les alertes.
- Actualisation transport côté interface toutes les 30 secondes.
- Cron Cloudflare toutes les 15 minutes pour analyser les tendances et vérifier les sources.
- PWA installable sur écran d’accueil.
- Interface adaptative mobile, tablette et ordinateur.
- Formulaire « Une question ? » : chaque message est envoyé directement à l’adresse privée du responsable du site.
- L’adresse privée n’est jamais présente dans le HTML, le JavaScript public ou le ZIP. Elle est enregistrée comme secret Cloudflare `OWNER_EMAIL`.
- Statistiques privées par e-mail : visiteurs estimés, pages vues, rubriques consultées, recherches principales et contributions.
- Rapport automatique une fois par jour vers 20 h, heure de Paris.
- Mesure d’audience sans conservation de l’adresse IP brute : seul un identifiant haché et renouvelé chaque jour est enregistré.

## Sources intégrées

- OpenStreetMap pour les points d’intérêt.
- OpenFreeMap pour le fond cartographique.
- transport.data.gouv.fr pour le catalogue national des réseaux et leurs flux temps réel.
- geo.api.gouv.fr pour identifier la commune et le département depuis une position.
- Service-Public.fr pour les démarches.
- API événements configurable, préconfigurée sur France Évasion Régions / données DATAtourisme.

## Déploiement Cloudflare

Prérequis : Node.js 22 ou plus récent et un compte Cloudflare.

1. Décompresser le ZIP et ouvrir un terminal dans le dossier.

2. Installer les dépendances :

```bash
npm install
```

3. Se connecter à Cloudflare :

```bash
npx wrangler login
```

4. Créer la base D1 :

```bash
npx wrangler d1 create jai-besoin-de-db
```

Cloudflare renvoie un `database_id`. Le copier dans `wrangler.toml` à la place de :

```text
REMPLACE_MOI_APRES_CREATION_D1
```

5. Créer le bucket photo R2 :

```bash
npx wrangler r2 bucket create jai-besoin-de-photos
```

6. Initialiser la base :

```bash
npm run db:init:remote
```

7. Ajouter une clé d’administration privée :

```bash
npx wrangler secret put ADMIN_KEY
```

8. Configurer les e-mails privés.

Le site utilise Cloudflare Email Service. Il faut avoir un nom de domaine géré par Cloudflare DNS. Dans le tableau de bord Cloudflare, activer Email Service / Email Routing, puis ajouter et vérifier l’adresse de destination privée.

Dans `wrangler.toml`, remplacer :

```text
MAIL_FROM = "notifications@VOTRE-DOMAINE.fr"
```

par une adresse technique du domaine, par exemple `notifications@ton-domaine.fr`. Cette adresse peut être publique. Elle n’est pas ton adresse personnelle.

Enregistrer ensuite l’adresse personnelle comme secret Cloudflare :

```bash
npx wrangler secret put OWNER_EMAIL
```

Wrangler te demandera la valeur. Saisis l’adresse personnelle uniquement dans cette invite. Elle n’est pas enregistrée dans le code du site.

Créer aussi un sel privé pour le compteur de visiteurs :

```bash
npx wrangler secret put ANALYTICS_SALT
```

Tu peux utiliser une longue suite aléatoire d’au moins 32 caractères.

9. Initialiser ou mettre à jour les nouvelles tables D1 :

```bash
npm run db:init:remote
```

Cette commande peut être relancée sur une base déjà créée. Les nouvelles tables utilisent `CREATE TABLE IF NOT EXISTS`.

10. Déployer :

```bash
npm run deploy
```

Cloudflare fournira une adresse `*.workers.dev`. Un nom de domaine peut ensuite être relié depuis le tableau de bord Cloudflare.

## Développement local

```bash
npm run db:init:local
npm run dev
```

## Comment le site se met à jour

Les lieux OpenStreetMap sont interrogés au moment de la recherche et mis en cache quelques minutes. Les contributions des internautes apparaissent dans la base communautaire immédiatement. Les flux GTFS-RT sont récupérés avec un cache très court. Le catalogue transport est rafraîchi périodiquement. Les recherches inconnues sont comptabilisées et promues automatiquement selon leur fréquence.

## Questions reçues par e-mail

Le bouton « Une question ? » ouvre un formulaire. Le navigateur envoie uniquement le nom facultatif, l’e-mail facultatif du visiteur, son message et la page depuis laquelle il écrit. Le Worker envoie ensuite le message à `OWNER_EMAIL`. Cette variable est un secret serveur et n’est jamais renvoyée au navigateur.

L’objet reçu est : `J’ai besoin de... | Question visiteur`.

Si le visiteur indique son adresse, elle apparaît uniquement dans le contenu du message reçu. Le site ne la place volontairement pas en `Reply-To`, afin d’éviter qu’un clic sur « Répondre » depuis ta boîte personnelle révèle accidentellement ton adresse. Pour répondre à un visiteur sans exposer ton adresse personnelle, utilise une adresse publique du site du type `contact@ton-domaine.fr`.

## Rapport de fréquentation par e-mail

Le site enregistre des compteurs anonymisés dans D1 : pages vues, grandes rubriques, catégories, démarches, plans, contributions et recherches. L’adresse IP brute n’est pas enregistrée. Elle sert uniquement en mémoire à créer un identifiant haché renouvelé chaque jour.

Vers 20 h, heure de Paris, le Worker envoie un seul rapport pour la journée avec :

- visiteurs estimés ;
- pages vues ;
- rubriques et actions les plus consultées ;
- recherches les plus fréquentes ;
- nombre de contributions.

Les données détaillées de mesure d’audience sont automatiquement supprimées après 90 jours.

## Pour passer de V1 à une très grosse audience

La V1 utilise une instance publique Overpass pour les recherches OSM. Pour une audience nationale importante, remplacer cette dépendance par un import OSM national dans PostgreSQL/PostGIS ou par un fournisseur disposant d’un SLA. Le reste de l’architecture Cloudflare peut rester identique.

Les plans intérieurs détaillés de toutes les gares et centres commerciaux demandent une phase supplémentaire : import des données indoor OSM quand elles existent, intégration des données ouvertes des exploitants, puis contributions communautaires pour compléter les bâtiments manquants.

## Fichiers importants

- `public/index.html` : interface.
- `public/app.css` : design responsive.
- `public/app.js` : carte, géolocalisation et interactions.
- `src/worker.js` : API Cloudflare Worker et logique temps réel.
- `db/schema.sql` : base D1.
- `db/seed.sql` : données initiales.
- `wrangler.toml` : configuration Cloudflare.
