# Contact privé et statistiques par e-mail

Cette version ne contient aucune adresse e-mail personnelle dans le HTML, le JavaScript, `wrangler.toml` ou les fichiers publics.

## À configurer une seule fois

1. Utiliser un domaine géré par Cloudflare DNS.
2. Activer Cloudflare Email Service / Email Routing.
3. Ajouter l’adresse personnelle comme destination vérifiée dans Cloudflare.
4. Dans `wrangler.toml`, remplacer `notifications@VOTRE-DOMAINE.fr` par une adresse technique de ton domaine.
5. Enregistrer l’adresse personnelle uniquement comme secret serveur :

```bash
npx wrangler secret put OWNER_EMAIL
```

6. Créer un sel privé pour les statistiques :

```bash
npx wrangler secret put ANALYTICS_SALT
```

7. Mettre à jour la base puis redéployer :

```bash
npm run db:init:remote
npm run deploy
```

## Ce qui arrive par e-mail

Les questions sont envoyées immédiatement avec l’objet `J’ai besoin de... | Question visiteur`.

Un rapport de fréquentation est envoyé une fois par jour vers 20 h, heure de Paris. Il contient les visiteurs estimés, pages vues, rubriques et lieux consultés, recherches principales et contributions.

L’adresse IP brute des visiteurs n’est pas enregistrée dans D1. Elle sert uniquement à produire un identifiant haché renouvelé chaque jour.
