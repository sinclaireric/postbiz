# Démarches par réseau

> Les noms de permissions, produits et délais ci-dessous viennent de la documentation publique et de recherches faites
> pendant la préparation du projet. **Ils changent souvent : vérifiez-les dans la documentation officielle de chaque réseau
> avant de vous lancer.** Rien ici n'a été validé avec de vrais comptes.

Pour tous les réseaux : prévoyez d'abord un domaine, les pages `/cgu`, `/confidentialite` et `/suppression-des-donnees`
(à faire relire par un juriste), un e-mail de contact et des vidéos de démonstration de l'application.

## Meta (Facebook et Instagram)

1. Créer une application « Business » sur developers.facebook.com, puis lancer la **vérification d'entreprise** (Business Verification).
2. Ajouter les produits : Facebook Login, Messenger, Instagram, Webhooks.
3. Demander l'accès avancé (App Review) aux permissions utiles, par exemple :
   `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`, `pages_messaging`,
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_messages`, `instagram_manage_comments`
   (selon le mode de connexion Instagram, les noms sont préfixés `instagram_business_`).
4. Demander la fonctionnalité **`human_agent`** pour répondre jusqu'à 7 jours après le dernier message (sinon : 24 h).
5. Webhooks :
   - URL de rappel : `https://<projet>.supabase.co/functions/v1/webhook-meta`
   - Jeton de vérification : la valeur de `META_WEBHOOK_VERIFY_TOKEN`
   - Page : champs `messages` et `feed` ; Instagram : `messages` et `comments`.
6. Secrets de la fonction : `supabase secrets set META_APP_SECRET=… META_WEBHOOK_VERIFY_TOKEN=…`
7. La revue exige des **vidéos** : un testeur écrit à la Page / au compte, Postbiz affiche le message et la réponse repart.
   Meta demande aussi un chemin d'escalade vers un humain : c'est exactement ce que fait l'inbox.

## YouTube (Google)

1. Projet Google Cloud, activer « YouTube Data API v3 ».
2. Écran de consentement OAuth « externe » ; scopes sensibles (envoi de vidéos, gestion des commentaires) → **vérification Google** requise.
3. Quota par défaut : 10 000 unités par jour. Les applications non auditées peuvent voir leurs vidéos envoyées par API restreintes en privé : demander l'**audit** de l'API.
4. Pas de messages privés : commentaires uniquement.

## TikTok

1. developers.tiktok.com : application avec Login Kit et Content Posting API.
2. Un **audit** est nécessaire : tant qu'il n'est pas passé, les publications sont privées.
3. La messagerie (Business Messaging API) est soumise à approbation, réservée aux comptes Business, et d'après un guide tiers indisponible dans l'EEE, en Suisse et au Royaume-Uni : à confirmer avant d'en faire une promesse.

## LinkedIn

1. developer.linkedin.com : application avec « Share on LinkedIn » et « Sign In with LinkedIn using OpenID Connect » (accès immédiat).
2. Commentaires de Pages : demander la **Community Management API** (approbation, rôle administrateur de la Page).
3. La messagerie (personnelle et des Pages) n'est **pas ouverte** aux applications tierces, sauf partenaires nommés par LinkedIn.
4. L'en-tête `LinkedIn-Version` (AAAAMM) doit rester récent : variable `LINKEDIN_API_VERSION`.

## X

1. developer.x.com : projet et application, OAuth 2.0 avec PKCE, scopes `tweet.read tweet.write users.read offline.access` (+ `dm.read dm.write` pour les messages).
2. L'accès à l'API est payant et change régulièrement (offres, paiement à l'usage). Les messages privés dépendent de l'offre ; une source signale un plafond de lecture sur l'offre d'entrée. **Vérifiez la grille tarifaire actuelle.**

## Tester sans OAuth

Le flux OAuth de connexion des canaux n'est pas encore écrit dans l'application. Pour essayer la publication et l'inbox
avec un jeton obtenu à la main (par exemple un jeton de Page dans l'explorateur de l'API Graph) :

```bash
pnpm --filter @postbiz/worker add-channel -- \
  --org <uuid de l'organisation> --provider facebook --internal-id <ID_DE_LA_PAGE> \
  --name "Ma Page" --token <JETON_DE_PAGE> --settings '{"human_agent_enabled":false}'
```

Le jeton est chiffré avec `TOKEN_ENCRYPTION_KEY` avant d'être enregistré.
