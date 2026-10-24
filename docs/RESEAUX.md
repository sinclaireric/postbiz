# Démarches par réseau

> Les noms de permissions, produits et délais ci-dessous viennent de la documentation publique et de recherches faites
> pendant la préparation du projet. **Ils changent souvent : vérifiez-les dans la documentation officielle de chaque réseau
> avant de vous lancer.** Rien ici n'a été validé avec de vrais comptes.

## Adresses de retour (redirect URI) à enregistrer

Postbiz utilise une adresse de retour par application de réseau, construite à partir de `NEXT_PUBLIC_SITE_URL` (qui doit être l'adresse publique exacte, sans `/` final) :

| Réseau | Adresse à enregistrer | Variables d'environnement (app web **et** worker pour le rafraîchissement) |
|---|---|---|
| Meta (Facebook + Instagram) | `<SITE>/api/oauth/callback/meta` (« URI de redirection OAuth valides ») | `META_APP_ID`, `META_APP_SECRET` |
| X | `<SITE>/api/oauth/callback/x` | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| LinkedIn | `<SITE>/api/oauth/callback/linkedin` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Google (YouTube) | `<SITE>/api/oauth/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| TikTok | `<SITE>/api/oauth/callback/tiktok` | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |

L'app web a aussi besoin de `SUPABASE_SERVICE_ROLE_KEY` et `TOKEN_ENCRYPTION_KEY` (la **même** clé que le worker, sinon il ne pourra pas relire les jetons).
Tant qu'une de ces variables manque, le bouton « Connecter » du réseau est désactivé et son infobulle indique ce qui manque. Seuls les
**administrateurs** de l'organisation peuvent connecter et déconnecter un canal.

> **Statut : rien de ce flux n'a été exécuté contre les vraies API.** Les URL, scopes et formats ci-dessous viennent de la
> documentation publique et sont vérifiés par des tests avec réseau simulé. Les points marqués « à vérifier » sont les plus
> susceptibles de demander un ajustement à la première connexion réelle.

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
   (`META_APP_SECRET` est le même que celui de la connexion OAuth.)
7. **Connexion dans Postbiz** (Facebook Login). Si l'application utilise « Facebook Login for Business » (cas d'utilisation « Tout gérer sur votre Page », non combinable avec la connexion classique),
   renseigner `META_LOGIN_CONFIG_ID` : Postbiz envoie alors `config_id` à la place de `scope`, et les permissions sont celles de la configuration créée chez Meta (même liste ci-dessous). : permissions demandées — Facebook : `pages_show_list`, `pages_manage_metadata` (nécessaire à l'abonnement
   aux webhooks), `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`, `pages_messaging`, `read_insights` (statistiques de la Page) ; Instagram : celles-ci plus
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_manage_insights` (statistiques du compte). Postbiz échange le code contre un jeton
   longue durée (~60 jours), liste les Pages (`/me/accounts`) et les comptes Instagram professionnels liés, vous laisse cocher ceux à connecter, puis enregistre
   le **jeton de Page** (sans expiration, donc rien à rafraîchir) et abonne la Page aux champs `messages`, `messaging_postbacks`, `feed`.
   Les Pages gérées uniquement via un portefeuille Business Manager peuvent exiger la permission `business_management` (non demandée).
   À vérifier : abonnement des commentaires Instagram (réglé au niveau de l'application, pas de la Page), mode « Développement » (seuls les rôles de l'application peuvent se connecter),
   URL de rappel de désautorisation et de suppression de données (la page `/suppression-des-donnees` existe, le rappel automatique n'est pas écrit).
8. La revue exige des **vidéos** : un testeur écrit à la Page / au compte, Postbiz affiche le message et la réponse repart.
   Meta demande aussi un chemin d'escalade vers un humain : c'est exactement ce que fait l'inbox.

### Instagram Standalone (sans Page Facebook)

1. Application Meta avec le cas d'utilisation **« Gérer les messages et les contenus sur Instagram »**, puis la rubrique **« Configuration de l'API avec la connexion Instagram »**.
2. Y relever l'**ID de l'application Instagram** et sa **clé secrète** (distincts de ceux de l'application Meta) : `INSTAGRAM_APP_ID` et `INSTAGRAM_APP_SECRET`.
3. Y déclarer l'adresse de retour `<site>/api/oauth/callback/instagram_login` et, pour le mode Développement, ajouter les comptes Instagram à tester (rôle « Testeur Instagram »).
4. **Connexion dans Postbiz** : autorisation sur `instagram.com/oauth/authorize` (scopes `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`, `instagram_business_manage_insights` ;
   `instagram_business_content_publish` sera ajouté avec la publication), puis jeton court (1 h) → jeton de **60 jours** (`ig_exchange_token`). Ce jeton se prolonge de lui-même (`ig_refresh_token`, au moins 24 h après sa création,
   avant son expiration) : Postbiz le garde aussi comme « refresh token » pour que le worker le prolonge. Le compte est enregistré comme un canal `instagram` ordinaire
   (`settings.login = 'instagram'`, `settings.graph_host = 'graph.instagram.com'`) : même boîte de réception, mêmes règles. Le compte doit être **professionnel** (Business ou Créateur).
5. **Webhooks** : l'abonnement du compte (`messages`, `comments`, `messaging_postbacks`) est fait à la connexion ; l'URL de rappel de l'objet « Instagram » de l'application doit aussi être déclarée chez Meta
   (même fonction `webhook-meta`). À vérifier en réel : la réception des événements et l'envoi d'une réponse par `graph.instagram.com`.
6. La publication n'existe pas encore (média exigé), comme pour Instagram par Page.

## YouTube (Google)

1. Projet Google Cloud, activer « YouTube Data API v3 ».
2. Écran de consentement OAuth « externe » ; scopes sensibles (envoi de vidéos, gestion des commentaires) → **vérification Google** requise. L'écran demande une page d'accueil, une
   **politique de confidentialité** et des **conditions d'utilisation** : `<SITE>/confidentialite` et `<SITE>/cgu` (elles contiennent la déclaration « utilisation limitée » des données Google et le lien vers les
   conditions de YouTube). Le domaine du site doit être déclaré dans « Domaines autorisés ».
3. Quota par défaut : 10 000 unités par jour. Les applications non auditées peuvent voir leurs vidéos envoyées par API restreintes en privé : demander l'**audit** de l'API.
4. Pas de messages privés : commentaires uniquement.
5. **Connexion dans Postbiz** : OAuth 2.0 avec PKCE, scopes `youtube.upload`, `youtube.force-ssl` et `yt-analytics.readonly` (statistiques de la chaîne), `access_type=offline` + `prompt=consent`. Le jeton d'accès dure 1 h et
   est rafraîchi par le worker. ⚠️ Tant que l'écran de consentement est en mode **« Test »**, Google fait expirer le refresh token au bout de **7 jours** : le canal passera alors
   à « À reconnecter ». Passez en production (et obtenez la vérification) avant d'inviter de vrais utilisateurs.
   La publication YouTube n'est pas écrite (l'envoi de vidéos n'est pas branché) : le canal se connecte et garde un jeton valide.

## TikTok

1. developers.tiktok.com : application avec Login Kit et Content Posting API.
2. Un **audit** est nécessaire : tant qu'il n'est pas passé, les publications sont privées. Les champs « Terms of Service URL » et « Privacy Policy URL » de l'application sont
   `<SITE>/cgu` et `<SITE>/confidentialite` (elles décrivent les données TikTok reçues et l'usage de l'API de publication).
3. **Connexion dans Postbiz** : Login Kit v2, scopes `user.info.basic`, `video.publish`, `video.upload`, `user.info.stats` (nombre d'abonnés). Pas de PKCE (non documenté pour le flux web ; **à vérifier**, TikTok l'exige pour les
   applications bureau/mobiles). Jeton d'accès 24 h, refresh token ~365 jours et **renouvelé à chaque rafraîchissement** : Postbiz enregistre toujours le nouveau. TikTok peut répondre
   `200` avec un champ `error` : géré comme un refus. La publication TikTok n'est pas écrite (vidéo requise).
4. La messagerie (Business Messaging API) est soumise à approbation, réservée aux comptes Business, et d'après un guide tiers indisponible dans l'EEE, en Suisse et au Royaume-Uni : à confirmer avant d'en faire une promesse.

## LinkedIn

1. developer.linkedin.com : application avec « Share on LinkedIn » et « Sign In with LinkedIn using OpenID Connect » (accès immédiat).
2. **Pages LinkedIn** (organisation) et commentaires de Pages : demander la **Community Management API** (approbation par LinkedIn, rôle administrateur de la Page). Tant qu'elle n'est pas accordée,
   le bouton « LinkedIn Page » reste désactivé ; le profil personnel n'est pas touché. **Cette API doit être le seul produit de son application** (LinkedIn refuse sinon la demande) :
   créer une **seconde application LinkedIn** réservée aux Pages, avec `LINKEDIN_PAGE_CLIENT_ID` et `LINKEDIN_PAGE_CLIENT_SECRET`, et y déclarer l'adresse de retour `<site>/api/oauth/callback/linkedin_page`.
3. La messagerie (personnelle et des Pages) n'est **pas ouverte** aux applications tierces, sauf partenaires nommés par LinkedIn.
4. **Connexion dans Postbiz** : profil personnel uniquement (scopes `openid profile w_member_social`) ; l'identifiant du profil devient `settings.author_urn`. **LinkedIn Page** (canal `linkedin_page`, famille OAuth à part, seconde application LinkedIn) : scopes
   `rw_organization_admin w_organization_social r_organization_social` (statistiques de la Page) ; Postbiz liste les Pages dont vous êtes administrateur (`organizationAcls`, rôle `ADMINISTRATOR`), vous laisse cocher celles à connecter, et
   `settings.author_urn` vaut `urn:li:organization:<id>` (le worker publie alors au nom de la Page). Le jeton dure ~60 jours et **LinkedIn ne délivre de refresh token qu'à certains partenaires** :
   pour une application standard, le canal passe à « À reconnecter » à l'expiration (le worker notifie les administrateurs) — il faut reconnecter tous les ~2 mois. Pas de PKCE (non documenté pour ce flux).
5. L'en-tête `LinkedIn-Version` (AAAAMM) doit rester récent : variable `LINKEDIN_API_VERSION`.

## X

1. developer.x.com : projet et application, OAuth 2.0 avec PKCE, scopes `tweet.read tweet.write users.read offline.access` (+ `dm.read dm.write` pour les messages).
2. **Connexion dans Postbiz** : scopes `tweet.read tweet.write users.read offline.access` (les messages privés ne sont pas demandés : l'inbox X n'est pas écrite). Application « confidentielle »
   (secret en authentification Basic), PKCE S256. Jeton d'accès 2 h ; le refresh token de X est **à usage unique** : Postbiz enregistre le nouveau à chaque rafraîchissement,
   un seul worker rafraîchit un jeton à la fois (verrou en base). Si le worker plante entre la réponse de X et l'enregistrement, l'ancien refresh token est perdu et le canal passera à « À reconnecter ».
3. L'accès à l'API est payant et change régulièrement (offres, paiement à l'usage). Les messages privés dépendent de l'offre ; une source signale un plafond de lecture sur l'offre d'entrée. **Vérifiez la grille tarifaire actuelle.**

## Statistiques d'audience (page Analyses)

Le worker relève chaque jour, auprès de chaque réseau, trois chiffres par canal (comme Postiz, mais **enregistrés** : table `channel_metrics_daily`, migration
`20261029000001_channel_metrics.sql`, au lieu d'être relus en direct à chaque affichage) : les **abonnés** (niveau en fin de journée), la **portée** et les **interactions** (quantités du jour).
Le code est dans `apps/worker/src/engine/metrics.ts` (planification) et `apps/worker/src/providers/insights/` (un fichier par réseau).

| Réseau | Ce qui est relevé | Historique au premier passage | Autorisation demandée |
|---|---|---|---|
| Facebook (Page) | portée = `page_total_media_view_unique`, interactions = `page_post_engagements` (par jour) ; abonnés = `followers_count` de la Page | 90 jours (sauf abonnés : du jour) | `read_insights` |
| Instagram (Page ou Instagram Login) | portée = `reach` (par jour) ; interactions = `total_interactions`, lues jour par jour ; abonnés = `followers_count` | 30 jours (limite de Meta) | `instagram_manage_insights` / `instagram_business_manage_insights` |
| Page LinkedIn | impressions et j'aime + commentaires + partages par jour (`organizationalEntityShareStatistics`) ; abonnés de la Page (`networkSizes`) | 90 jours | `r_organization_social` |
| YouTube | vues et j'aime + commentaires + partages par jour (API YouTube Analytics) ; `subscriberCount` | 90 jours (les 1 à 2 derniers jours arrivent avec retard) | `yt-analytics.readonly` |
| TikTok | abonnés seulement (`user/info`) : ni portée ni historique par jour | du jour | `user.info.stats` |
| X | abonnés seulement (`users/me`, `public_metrics`) : impressions et interactions n'existent que par publication | du jour | aucune de plus |
| LinkedIn (profil personnel) | rien : l'API n'en donne pas | n/a | n/a |

- **Rythme** : un passage du worker toutes les 5 minutes (`WORKER_METRICS_INTERVAL_MS`, 300000) réclame au plus 10 canaux (`WORKER_METRICS_BATCH`) dont l'échéance est passée ; un canal est
  relevé **toutes les 6 heures** (le jour en cours se corrige d'un relevé à l'autre ; les 7 derniers jours sont relus à chaque fois). Rien n'est relevé en mode essai (`WORKER_DRY_RUN=1`).
- **Abonnés** : Meta, LinkedIn, TikTok et X ne donnent que le total du jour : la courbe se construit à partir de la connexion du canal (la variation apparaît dès le deuxième jour).
- **Autorisation manquante** : un canal connecté **avant** l'ajout de ces autorisations est refusé par le réseau (403, code Meta 10/200, `scope_not_authorized`…). Le canal passe à l'état de collecte
  `missing_scope` (table `channel_metrics_sync`), la page Analyses demande de le **reconnecter**, et le worker revérifie toutes les 3 heures. Ce qui a pu être lu (les abonnés par exemple) est gardé.
  Un jeton refusé (401) passe le canal à « À reconnecter » ; une panne passagère (5xx, quota, réseau) est réessayée avec un délai croissant, de 15 minutes à 12 heures.
- **Revue des réseaux** : `read_insights`, `instagram_manage_insights`, `r_organization_social` (accès Community Management), `yt-analytics.readonly` (écran de consentement Google) et `user.info.stats`
  doivent être ajoutés à la revue d'application de chaque réseau. Avec « Facebook Login for Business » (`META_LOGIN_CONFIG_ID`), ajouter les deux permissions Meta à la configuration chez Meta.
- ⚠️ **Rien n'a été exécuté contre les vraies API** : les adresses, métriques et formats suivent la documentation et le code de Postiz ; les tests utilisent des réseaux simulés. À valider avec un canal de test
  par réseau avant de promettre ces statistiques (Meta a retiré plusieurs anciennes métriques de Page en juin 2026 : en cas de métrique refusée, le message de l'API est enregistré dans `channel_metrics_sync.error`).

## Fonctionnement et limites de la connexion

- `state` signé (HMAC, clé dérivée de `TOKEN_ENCRYPTION_KEY`), à usage unique, valable 10 min, lié à l'utilisateur **et** à l'organisation ; seul son hachage est en base.
  Le retour doit venir du même utilisateur connecté, toujours administrateur de l'organisation.
- Les jetons sont chiffrés avant d'être écrits (`integration_secrets`, sans aucune policy) ; les comptes en attente de choix (Meta) le sont aussi (`oauth_pending_selections`, 30 min).
- Reconnecter un compte existant met à jour le canal (jeton, nom, photo) et le réactive ; ses réglages sont conservés.
- Déconnecter : le jeton est révoqué chez X, LinkedIn, Google et TikTok, la Page Meta est désabonnée des webhooks (sauf si un autre canal — Facebook/Instagram — utilise la même Page) ; si le réseau
  ne répond pas, la déconnexion locale a lieu quand même et l'interface demande de retirer Postbiz des applications autorisées du compte.
- Non écrit : Pages LinkedIn, comptes Instagram connectés par « Instagram Login » (sans Page Facebook), réception des rappels de désautorisation de Meta, publication Instagram / TikTok / YouTube.

## Tester sans OAuth

Si vous voulez essayer la publication et l'inbox sans créer d'application de réseau, avec un jeton obtenu à la main (par exemple un jeton de Page
dans l'explorateur de l'API Graph), la commande suivante reste disponible :

```bash
pnpm --filter @postbiz/worker add-channel -- \
  --org <uuid de l'organisation> --provider facebook --internal-id <ID_DE_LA_PAGE> \
  --name "Ma Page" --token <JETON_DE_PAGE> --settings '{"human_agent_enabled":false}'
```

Le jeton est chiffré avec `TOKEN_ENCRYPTION_KEY` avant d'être enregistré.


## Médias (images et vidéos)

**Bibliothèque.** Les fichiers sont envoyés depuis le navigateur dans le bucket privé `media` (dossier `<org>/…`, 1 Gio au plus par fichier ; au-delà de 6 Mio, envoi par morceaux reprenable, protocole TUS).
À l'envoi, le navigateur calcule les dimensions et la durée, crée une **vignette** (480 px) — pour une vidéo, une image prise un peu après le début — et, pour toute image qui n'est pas un JPEG,
une **version JPEG** (Instagram n'accepte que le JPEG). Des limites du projet Supabase s'ajoutent à celle du bucket (réglage « Storage » : taille maximale d'un fichier ; 50 Mo sur l'offre gratuite).
La table `media` garde le nom d'origine, le texte alternatif, le type (image / vidéo) et les chemins (`path`, `thumbnail_path`, `normalized_path`). Supprimer un média utilisé par une publication en attente est refusé.

**Publications.** `posts.media` ne garde que des références `[{ media_id, type, alt }]` : le worker relit la bibliothèque au moment de publier et signe des URL temporaires (2 h) que le réseau télécharge.
La base refuse un média d'une autre organisation, et un fichier hors du dossier de l'organisation. Règles par réseau : `apps/web/src/lib/media/rules.ts`.

| Réseau | Publication de médias | Limites appliquées |
|---|---|---|
| Instagram (Page ou Instagram Login) | oui, ⚠️ non validée en réel | 1 image (JPEG), 1 vidéo (Reel) ou un carrousel de 10 images et vidéos ; légende 2200 caractères |
| Facebook (Page) | oui, ⚠️ non validée en réel | 10 photos, ou une vidéo (pas les deux) |
| X, LinkedIn, Page LinkedIn | pas encore | la programmation est refusée avec un message clair |
| TikTok, YouTube | pas encore | idem (vidéo exigée) |

**Instagram, étape par étape.** Un conteneur par média (`/{ig}/media` avec `image_url` ou `video_url`), attente de `FINISHED` (jusqu'à 60 s pour une image, 5 min pour une vidéo), conteneur de carrousel si besoin,
puis `media_publish`. Tant que `media_publish` n'a pas eu lieu rien n'est visible : une panne avant est un refus sûr (on peut reprogrammer) ; une panne pendant `media_publish` est une issue incertaine, jamais rejouée.
**Facebook :** une photo → `/photos` ; plusieurs → chaque photo non publiée, puis un post `attached_media` ; une vidéo → `graph-video.facebook.com/{page}/videos` avec `file_url`.
