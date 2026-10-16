> **Mise à jour (octobre 2026) — écarts par rapport au plan ci-dessous**
> - Un seul site Next.js (`apps/web`) regroupe vitrine, connexion et application, dans un style inspiré de Chatbase (clair, titres sans-serif avec mot en serif italique, boutons noirs en pilule, écran de connexion partagé), avec l'identité propre à Postbiz. Il n'y a plus d'`apps/site`.
> - La file de travail utilise `FOR UPDATE SKIP LOCKED` (fonctions `claim_due_posts`, `claim_outbound_messages`) plutôt que pgmq, et le worker interroge la base à intervalle régulier plutôt que pg_cron.
> - Le chiffrement des jetons est applicatif (AES-256-GCM) plutôt que Vault.
> - Un mode démo permet d'essayer l'application sans Supabase.
> - État réel de chaque brique : voir `README.md`.

# Postbiz — Plan MVP

Fork de Postiz (AGPL-3.0) + app mobile (postiz-mobile) + service médias (postiz-uploader) + site vitrine + **Inbox unifiée** (nouvelle fonctionnalité).
Réseaux du MVP : Facebook, Instagram, X, LinkedIn, TikTok, YouTube.

Les durées sont des estimations grossières pour 1 à 2 développeurs. Tout ce qui touche aux API des réseaux (accès, tarifs, validations) est à revérifier dans la doc officielle au moment de l'implémentation : ces règles changent souvent.

---

## 1. Décisions d'architecture

### 1.1 Supabase : oui, mais pas « Supabase seul »

Supabase remplace NestJS pour environ 80 % du backend. Il reste un petit worker Node pour la publication et les médias.

| Besoin | Postiz (aujourd'hui) | Postbiz |
|---|---|---|
| Auth | JWT maison, bcrypt, OAuth maison | **Supabase Auth** (email, Google, Apple) |
| API CRUD (241 endpoints) | NestJS + Prisma | **PostgREST + RLS** (supabase-js) |
| Permissions | CASL | **RLS** (Row Level Security) par organisation |
| Temps réel | aucun | **Supabase Realtime** (idéal pour l'inbox) |
| Fichiers | R2 / disque local | **Supabase Storage** (URL signées, TUS) |
| Cron | `@nestjs/schedule` | **pg_cron** |
| File de jobs | Temporal + Redis | **pgmq** (Supabase Queues) |
| Webhooks entrants, callbacks OAuth | contrôleurs NestJS | **Edge Functions** |
| Secrets (tokens des réseaux) | colonne `token` en base | **Vault** ou chiffrement applicatif, table sans accès client |
| Publication, upload vidéo en morceaux, ffmpeg | workflows Temporal | **Worker Node** (1 service, sans état) |

Ce qui ne rentre pas dans Supabase seul :
- **Les connecteurs sociaux.** Ils utilisent des librairies Node (`twitter-api-v2`, `googleapis`, `sharp`, `canvas`) et envoient des vidéos de 64 Mo et plus en plusieurs morceaux. Les Edge Functions (Deno) ont des limites de durée, de mémoire et de CPU : à vérifier dans la doc Supabase actuelle, mais ce n'est pas l'endroit pour ça.
- **L'orchestration.** Temporal garantit la reprise après panne. Sans lui, il faut une machine à états explicite, que Postiz a déjà éprouvée (voir 1.3).

### 1.2 Architecture cible

```
 Web (Next.js)      Mobile (Expo)      Site vitrine (Next.js/Astro)
      │                   │
      └──── supabase-js ──┘  (Auth, RLS, Realtime, Storage)
                 │
        ┌────────▼─────────────── Supabase ───────────────────┐
        │ Postgres + RLS │ Auth │ Storage │ Realtime │ Vault   │
        │ pg_cron ──► pgmq (queues)                            │
        │ Edge Functions : oauth-start/callback, webhooks Meta,│
        │                  ingestion d'événements, push        │
        └────────┬──────────────────────────────┬──────────────┘
                 │ consomme pgmq                │ URLs signées
        ┌────────▼────────┐             ┌───────▼────────────┐
        │ Worker Node/TS  │             │ postiz-uploader    │
        │ publish, refresh│ ───────────►│ (Python, ffmpeg)   │
        │ token, polling  │   jobs      │ RunPod ou conteneur│
        └────────┬────────┘             └────────────────────┘
                 ▼
        API Meta / X / LinkedIn / TikTok / YouTube
```

### 1.3 Règles reprises de Postiz (à garder)

- Un appel de **publication ne se rejoue jamais automatiquement** : s'il expire, le post passe en état « résultat inconnu » pour éviter un doublon.
- Les publications asynchrones (TikTok, Instagram vidéo) sont suivies par **polling** (état `pending` → `ready` → `completed`).
- Les tokens ne sont **jamais** renvoyés au client : table `integration_secrets` sans aucune policy RLS, lisible uniquement par `service_role`.
- Les connecteurs sont **génériques** derrière une interface commune. Pas de `if (facebook)` dans le code commun.
- Code des webhooks de paiement (Stripe) : ne doit jamais lever d'exception.

### 1.4 Monorepo

```
postbiz/
  apps/web          # fork du frontend Postiz, allégé
  apps/mobile       # fork de postiz-mobile
  apps/site         # site vitrine
  apps/worker       # Node/TS : publication, refresh, polling
  apps/uploader     # fork de postiz-uploader (Python)
  packages/providers  # connecteurs sociaux, sans NestJS ni Prisma
  packages/db-types   # types générés par Supabase
  supabase/
    migrations/  functions/  seed.sql  tests/ (pgTAP)
```

---

## 2. Inbox : ce qui est réellement faisable

« Voir tous ses inbox dans Postbiz » n'est **pas faisable à l'identique sur les 6 réseaux** : certains n'ouvrent pas leurs messages aux apps tierces. Voici l'état d'après la recherche faite pour ce plan.

| Réseau | Messages privés (DM) | Commentaires | Réception temps réel | Verdict |
|---|---|---|---|---|
| **Facebook** | Messenger Platform. Permissions `pages_messaging` etc. Fenêtre de réponse de 24 h, extensible via le tag `human_agent` (jusqu'à 7 jours, à demander à Meta). | Oui (Pages) | Webhooks | **MVP** |
| **Instagram** | Instagram Messaging API (compte professionnel). Permissions `instagram_business_manage_messages` + `human_agent`. Même fenêtre de 24 h. | Oui | Webhooks | **MVP** |
| **YouTube** | Aucun DM dans l'API | Oui (Data API v3) | Non : polling via cron, quota à surveiller (10 000 unités/jour par défaut) | **MVP (commentaires)** |
| **X** | API v2 (`dm_events`, envoi de DM), scopes `dm.read`/`dm.write`. Accès payant. Les sources trouvées parlent de pay-per-use depuis février 2026, et d'un plafond de lecture sur le palier Basic ; **non confirmé**, à vérifier sur le portail X. | Mentions et réponses via l'API de posts | Polling (le temps réel est réservé aux paliers hauts) | **Phase 2** (coût à valider) |
| **LinkedIn** | **Pas d'API de messagerie ouverte.** L'accès à la messagerie des Pages passe par des partenaires nommés (Hootsuite, Sprinklr, etc.). Aucune API pour la messagerie personnelle. | Commentaires de Pages via Community Management API (accès sur approbation, rôle administrateur de la Page) | Polling | **Phase 2, commentaires seulement** |
| **TikTok** | Business Messaging API **sur approbation**, comptes Business uniquement, et d'après un guide tiers **indisponible dans l'EEE, en Suisse et au Royaume-Uni** : à confirmer. | Via API Business, sur approbation | Webhooks | **Phase 2, conditionnel** |

Conséquence : **l'inbox du MVP couvre Messenger, Instagram (DM + commentaires), Facebook (commentaires) et YouTube (commentaires)**. X, LinkedIn et TikTok arrivent ensuite, selon les accès obtenus. L'interface doit être conçue dès le départ pour accueillir ces canaux (champ `kind`, `provider`).

À savoir pour Meta : l'app doit avoir un **chemin d'escalade vers un humain** et une inbox capable de recevoir et d'afficher les messages. C'est exactement ce que fait Postbiz. La revue exige un screencast montrant un testeur qui écrit et l'app qui répond.

Référence utile : **Chatwoot** (inbox open source, MIT, Ruby on Rails) a déjà des canaux Facebook, Instagram et TikTok. Ne pas reprendre le code, mais s'en servir pour voir les cas limites (fenêtre de 24 h, pièces jointes, doublons de webhooks).

### 2.1 Modèle de données de l'inbox (esquisse)

```sql
contacts            (id, org_id, integration_id, platform_user_id, name, username, avatar_url, unique(integration_id, platform_user_id))
conversations       (id, org_id, integration_id, contact_id, kind ('dm'|'comment_thread'),
                     external_id, status ('open'|'pending'|'snoozed'|'closed'),
                     assignee_id, unread_count, last_message_at, last_inbound_at,
                     reply_window_expires_at, post_id nullable, unique(integration_id, external_id))
messages            (id, conversation_id, direction ('in'|'out'), external_id, body,
                     attachments jsonb, sent_by (user_id nullable), delivery_status,
                     created_at, raw jsonb, unique(conversation_id, external_id))
conversation_notes  (id, conversation_id, author_id, body, created_at)
canned_replies      (id, org_id, title, body)
inbox_events_raw    (id, provider, payload jsonb, received_at, processed_at, error)  -- idempotence + rejeu
```

- RLS sur toutes les tables via `is_org_member(org_id)` (fonction `SECURITY DEFINER`).
- `conversations` et `messages` ajoutées à la publication Realtime.
- Index `(org_id, status, last_message_at desc)` ; recherche plein texte (`tsvector`) sur `messages.body`.

### 2.2 Flux d'un message entrant

1. Meta appelle l'Edge Function `webhook-meta` : vérification de la signature `X-Hub-Signature-256`, écriture dans `inbox_events_raw`, réponse 200 immédiate.
2. Un trigger ou un message pgmq déclenche la normalisation (worker ou Edge Function) : upsert du contact, de la conversation, du message.
3. Realtime pousse la mise à jour au web et au mobile ; une Edge Function envoie la notification push.
4. L'utilisateur répond depuis Postbiz ; le worker appelle l'API du réseau et met à jour `delivery_status`.

---

## 3. Démarches externes (chemin critique, à lancer en semaine 1)

Ce sont elles qui fixent la date de lancement, pas le code.

| Réseau | À faire | Délai à anticiper |
|---|---|---|
| **Meta** (Facebook, Instagram) | App Meta, **Business Verification**, Advanced Access pour les permissions de publication, messagerie et commentaires, `human_agent`, screencasts de revue, URL de suppression des données, politique de confidentialité | Plusieurs semaines, avec des allers-retours probables |
| **Google / YouTube** | Écran de consentement OAuth, **vérification** des scopes sensibles, audit de l'API YouTube pour lever la restriction des vidéos en privé et augmenter le quota | Plusieurs semaines |
| **TikTok** | App développeur (Login Kit, Content Posting API) et **audit** (sans audit, les posts sont privés) ; demande Business API pour les commentaires et la messagerie | Plusieurs semaines |
| **LinkedIn** | App avec « Share on LinkedIn » (self-serve) ; demande **Community Management API** pour les commentaires de Pages | Variable, souvent long |
| **X** | Compte développeur et palier payant adapté | Immédiat, mais coût à budgéter |

Prérequis communs : nom de domaine, **CGU**, **politique de confidentialité**, page de suppression des données, email professionnel, vidéos de démonstration. Le site vitrine doit donc exister tôt (phase 6).

Les messages privés sont des données personnelles : prévoir dès le départ chiffrement, durée de conservation, suppression à la déconnexion d'un compte, et conformité RGPD.

---

## 4. Plan de développement par phases

### Phase 0 — Cadrage et démarches (semaine 0-1)
- Lancer toutes les démarches du §3.
- Créer les projets Supabase (dev, staging, prod) et le monorepo.
- Fork de Postiz : conserver les mentions AGPL et de copyright, retirer le nom et le logo Postiz, renommer Postbiz.
- Archiver la preuve écrite de l'autorisation pour `postiz-mobile` et `postiz-uploader` (email ou issue GitHub), et demander qu'une licence soit ajoutée aux repos.
- **Fin de phase :** apps de dev créées chez chaque réseau, domaine et pages légales en ligne.

### Phase 1 — Fondations Supabase (semaines 1-3)
- Schéma SQL minimal (≈ 12 tables au lieu des ~40 de Postiz) : `profiles`, `organizations`, `memberships` (rôles admin/member/viewer), `integrations`, `integration_secrets`, `posts`, `media`, `notifications`, `tags` + tables inbox du §2.1.
- RLS multi-tenant, tests pgTAP sur chaque policy, types TypeScript générés.
- Auth (email, Google ; Apple prévu pour le mobile), Storage (buckets, URL signées).
- Fork de `apps/frontend` : ne garder que calendrier (`launches`), éditeur (`new-launch`), médias, paramètres, auth.
  Postiz appelle son backend dans **99 fichiers** du frontend, pour **148 routes** distinctes ; seule une petite partie sert au MVP. Remplacer `useFetch` par supabase-js ou des RPC, module par module.
- Retirer pour le MVP : Polotno, CopilotKit/Mastra, plugs, marketplace, web3, clipping, admin, facturation complexe.
- Langues : fr et en d'abord (Postiz en a 16).
- **Fin de phase :** inscription, création d'organisation, isolation vérifiée entre deux organisations par des tests.

### Phase 2 — Connexion des canaux et publication (semaines 3-7)
Ordre de développement (de la validation la plus simple à la plus lourde) :
1. **LinkedIn** : self-serve, texte et images.
2. **X** : texte, threads, médias (upload par segments de 1 Mo dans Postiz).
3. **Facebook Pages** : en mode développeur avec comptes de test pendant la revue.
4. **Instagram** : posts, reels, stories ; publication asynchrone.
5. **YouTube** : upload « resumable », quotas.
6. **TikTok** : `FILE_UPLOAD` par morceaux de 5 à 64 Mo ; tant que l'audit n'est pas passé, les posts restent privés.

Pour chacun : OAuth dans `oauth-start` / `oauth-callback` (Edge Functions), connecteur dans `packages/providers` (porté depuis `libraries/nestjs-libraries/src/integrations/social/`, en retirant les décorateurs NestJS et les types Prisma), règles de validation (longueur, médias).

Moteur de publication :
- `posts.state` : `QUEUE → PUBLISHING → PUBLISHED | ERROR | UNKNOWN`.
- `pg_cron` (chaque minute) sélectionne les posts dus et les met dans pgmq ; le worker les consomme avec un verrou (`locked_until`) et une clé d'idempotence.
- Re-planification des vérifications d'état par délai de visibilité pgmq (équivalent des timers Temporal).
- Cron de rafraîchissement des tokens ; marquage `refreshNeeded` et notification en cas de déconnexion.
- **Fin de phase :** un post programmé est publié à l'heure sur chacun des 6 réseaux (en mode test pour ceux dont la revue est en cours), sans doublon après redémarrage forcé du worker.

### Phase 3 — Médias et postiz-uploader (semaines 6-8)
- Envoi vers Supabase Storage (TUS pour les gros fichiers).
- À l'insertion dans `media`, un job part vers l'uploader avec des **URL signées** en entrée et en sortie (l'uploader ne connaît ni base ni identifiants, c'est voulu par son auteur). Résultat (métadonnées, miniature) renvoyé par Edge Function.
- Déploiement : RunPod Serverless (GPU L4) ou conteneur CPU pour démarrer.
- **À ne pas activer :** les modules `ytdlp.py`, `oxylabs.py` et `pot.py` (téléchargement de vidéos YouTube via proxy), et les jobs `ingest` / `clip`. Le clipping est hors MVP, et télécharger des vidéos YouTube pose un problème de conditions d'utilisation.
- À vérifier : que l'uploader sait écrire vers une URL signée Supabase (PUT) ; sinon, ajouter un adaptateur S3 (Supabase Storage expose aussi un protocole S3).
- **Fin de phase :** une vidéo 4K déposée ressort conforme aux règles de chaque réseau.

### Phase 4 — Inbox (semaines 7-12) — la fonctionnalité différenciante
1. **4.1** Tables, RLS, Realtime (§2.1).
2. **4.2** Edge Function `webhook-meta` + abonnement aux champs `messages`, `comments`, `feed`.
3. **4.3** Messenger et Instagram DM : lecture, réponse, pièces jointes, **indicateur de fenêtre de 24 h** (réponse bloquée ou signalée une fois dépassée, option `human_agent` après approbation).
4. **4.4** Commentaires Facebook et Instagram : lire, répondre, masquer, supprimer.
5. **4.5** Commentaires YouTube : polling par cron avec gestion du quota.
6. **4.6** Interface en trois colonnes : liste (filtres par réseau, compte, type, non lus, assigné), conversation, contexte (contact, notes). Statuts, assignation, notes internes, réponses rapides, recherche, mises à jour en temps réel.
7. **4.7** Notifications push (voir phase 5).
8. **4.8** Ensuite, selon les accès obtenus : X (DM + mentions), commentaires de Pages LinkedIn, TikTok.
- Hors MVP : réponses automatiques par IA, flows façon ManyChat. Une suggestion de réponse validée par l'humain peut venir en phase suivante.
- **Fin de phase :** un message envoyé à une Page Facebook, un compte Instagram et un commentaire YouTube apparaît en moins de quelques secondes dans le web et le mobile ; une réponse repart sur le bon réseau.

### Phase 5 — Mobile postbiz-mobile (semaines 8-13, en parallèle)
État du code `postiz-mobile` (lu dans le repo) : Expo 55, React Native 0.83, expo-router, NativeWind, Zustand. Écrans présents : auth (connexion, inscription, mot de passe oublié, OTP), calendrier, création de post, analytics, ajout de canal, notifications. **Il ne contient aucun appel réseau** : les données viennent de fichiers `data/mock-*.ts`. Il faut donc brancher toute la couche données.
- Brancher Supabase : auth avec `expo-secure-store`, stores Zustand → requêtes supabase-js, Realtime.
- Ajouter l'onglet **Inbox** (liste, conversation, réponse, pièces jointes).
- Notifications push : Expo Notifications (APNs / FCM), envoyées par Edge Function.
- Si la connexion Google est proposée, prévoir « Se connecter avec Apple » pour la revue de l'App Store.
- Build avec EAS, TestFlight puis soumission aux stores.
- **Fin de phase :** application en test interne iOS et Android avec calendrier, création de post et inbox.

### Phase 6 — Site vitrine (semaines 2-10, en parallèle)
Voir §5. Il doit être en ligne avant les soumissions de revue (pages légales, description du produit).

### Phase 7 — Durcissement et lancement (semaines 11-14)
- Soumission finale des revues (Meta, Google, TikTok, LinkedIn) avec screencasts à jour.
- Facturation : bêta gratuite d'abord ; Stripe plus tard (en reprenant les règles de Postiz sur les webhooks).
- Sentry, sauvegardes Supabase, tests de charge du worker, revue de sécurité des policies RLS.
- **Fin de phase :** bêta fermée avec de vrais utilisateurs.

---

## 5. Site vitrine

### 5.1 Structure
Stack : Next.js (ou Astro) dans `apps/site`, hébergement Vercel ou Cloudflare Pages, fr et en.

Pages : Accueil · Produit/Inbox · Planification · Canaux (6 pages) · Tarifs · Blog · Docs · Contact · CGU · Confidentialité · Suppression des données.

Sections de l'accueil (structure inspirée de postiz.com, texte entièrement réécrit) :
1. Hero : promesse + bouton d'inscription. L'accroche porte sur l'**Inbox** : « tous vos messages et commentaires, au même endroit ».
2. Pour qui (créateurs, équipes marketing, agences).
3. Fonctionnalités : planification, inbox, médias, équipe, analytics.
4. Les 6 canaux.
5. Tarifs et FAQ.
6. Appel à l'action final.

### 5.2 Design : « style ManyChat », pas un clone
Ce que j'ai relevé sur manychat.com/product/ai : fond sombre ; titres géants en police grasse très compacte ; boutons « pilule » avec contour et libellés en capitales ; petits intitulés en majuscules au-dessus des sections ; maquettes de téléphone et de bulles de chat ; halo dégradé autour du téléphone ; section avant/après sur deux colonnes ; FAQ en accordéon ; ton humoristique.

À reproduire : **ce langage visuel et cette structure de page**.
À ne pas reproduire : leur police, leurs illustrations, leur mascotte, leur logo, leurs textes, leurs couleurs exactes. Une copie quasi identique expose à des réclamations pour contrefaçon ou parasitisme, et elle abîmerait la marque Postbiz. Le site doit avoir sa propre identité : palette, typographie libre de droits (par exemple Bricolage Grotesque ou Archivo), icônes et maquettes dessinées pour Postbiz.

Même règle pour le contenu de postiz.com : réutiliser la structure et les idées, **réécrire les textes**, ne pas reprendre les témoignages (ce sont des personnes réelles) ni les visuels.

Ne promettre sur le site que ce qui existe. ManyChat vend de l'automatisation (réponses IA, flows, intentions) ; Postbiz vend l'inbox unifiée et la planification.

---

## 6. Hors MVP
IA (agents, MCP, génération d'images et de vidéos), clipping, éditeur de design Polotno, plugs (auto-like, auto-commentaire), marketplace, web3, white-label et agences, API publique et SDK, n8n/Make, analytics avancés, facturation complète, les ~30 autres réseaux de Postiz.

## 7. Risques principaux

| Risque | Parade |
|---|---|
| Revues Meta/TikTok/Google longues ou refusées | Lancer en semaine 1 ; fournir des screencasts clairs ; avoir le site et les pages légales prêts |
| Inbox X, LinkedIn, TikTok non disponibles ou trop chers | Les marquer « bientôt » ; n'engager le développement qu'après accès confirmé |
| Doublon de publication sans Temporal | Machine à états, clé d'idempotence, état `UNKNOWN`, pas de retry automatique des mutations |
| Limites des Edge Functions | Les garder pour les appels courts (OAuth, webhooks) ; le reste dans le worker |
| Port du frontend plus long que prévu (99 fichiers couplés au backend) | Porter module par module ; réduire le périmètre de l'UI |
| Licences | AGPL pour le fork et les parties reprises de Postiz ; autorisations écrites pour le mobile et l'uploader |
| Données personnelles des messages | Chiffrement, durée de conservation, suppression à la déconnexion, RGPD |
