# Postbiz

Planifiez vos publications et répondez à tous vos messages et commentaires depuis une seule boîte de réception
(Facebook, Instagram, X, LinkedIn, TikTok, YouTube). Fork de [Postiz](https://github.com/gitroomhq/postiz-app), AGPL-3.0.

## État du MVP

| Brique | État |
|---|---|
| Site vitrine, tarifs, pages légales (brouillons) | ✅ Fait (`apps/web`) ; pages légales en français et en anglais seulement |
| Internationalisation du site, de l'authentification et de l'application web : 14 langues (en, he, ru, zh, fr, es, pt, de, it, ja, ko, ar, tr, vi), arabe et hébreu en lecture de droite à gauche | ✅ Clés vérifiées par test (mêmes clés, paramètres, balises et formes plurielles que le français) ; **traductions non relues par des locuteurs natifs**. Voir « Langues » ci-dessous |
| Connexion / inscription / mot de passe oublié (Supabase Auth) | ✅ Écrit ; **à valider sur un projet Supabase réel** |
| Application : onboarding en 3 étapes, calendrier (jour/semaine/mois/liste), boîte de réception, médias, canaux, réglages, notifications | ✅ Fonctionne en **mode démo** ; branchement Supabase écrit mais **non testé sur un projet réel** |
| Onboarding « à la Postiz » : organisation créée automatiquement, modale plein écran ouverte par `?onboarding=true` | ✅ Étapes 1 (canaux) et 3 (prise en main) ; l'étape 2 (agents IA, MCP, CLI) est affichée « Bientôt » car ces fonctions n'existent pas encore |
| Page « Analyses » (`/app/analyses`) : tous canaux ou un canal, 7 / 30 / 90 jours, 8 cartes (variation, courbe), détail, publications récentes, file de publication, tableau par canal | 🟡 **Activité** (publications, messages reçus, réponses, échecs) calculée à partir de la base. **Audience** (abonnés, portée, interactions) : le worker la relève chaque jour auprès de Facebook, Instagram, Page LinkedIn, YouTube (abonnés seulement pour TikTok et X), table `channel_metrics_daily`, voir docs/RESEAUX.md ; **jamais exécuté contre les vraies API ni contre un projet Supabase réel** ; les canaux déjà connectés doivent être reconnectés pour accorder les nouvelles autorisations |
| Agent : page `/app/agent` du site et onglet Agent du mobile, **un seul agent** (`apps/web/src/lib/agent/`, route `/api/agent/chat`) | ✅ Chat en flux qui consulte le calendrier et la médiathèque, prépare des publications validées par les règles de chaque réseau (limites, médias, premier commentaire, date) à relire puis enregistrer en brouillon ou programmer ; conversations communes au web et au mobile (`agent_threads`, `agent_messages`, RLS). Même modèle que l'agent de Postiz : **GPT-5.2 d'OpenAI** (`OPENAI_API_KEY`, côté serveur du site uniquement). Logique testée avec un faux modèle ; **jamais exécuté contre l'API OpenAI réelle ni sur un téléphone** ; mode démo simulé. Pas encore : serveur MCP, génération d'images ou de vidéos, modification et suppression de publications par l'agent, fichiers envoyés dans le chat |
| Page « Facturation » du menu | ❌ Affichée grisée « Bientôt disponible » |
| Base Supabase : schéma, RLS multi-organisations, file d'envoi, ingestion des messages | ✅ Migrations testées (88 tests dans PGlite, sans Docker) |
| Webhooks Meta : signature, normalisation, Edge Function `webhook-meta` | ✅ Logique testée ; **fonction non déployée ni exécutée sous Deno** |
| Worker : publication (Facebook, X, LinkedIn : texte), envoi de réponses Messenger/Instagram/commentaires | ✅ Logique testée avec des réseaux simulés ; **jamais exécuté contre les vraies API** |
| Connexion des canaux par OAuth (Meta, X, LinkedIn, YouTube, TikTok), choix des Pages, déconnexion, rafraîchissement des jetons | ✅ Écrit et testé **avec des réseaux simulés uniquement** ; **jamais exécuté contre les vraies API** (aucune application de réseau n'est créée) ; flux non essayé dans un navigateur avec un vrai projet Supabase. Voir ci-dessous |
| Envoi d'images/vidéos, Instagram / TikTok / YouTube en publication | ❌ Pas encore (`apps/uploader` à brancher) |
| Inbox X, LinkedIn (commentaires), TikTok, YouTube (commentaires) | ❌ Pas encore |
| App mobile (`apps/mobile`) | 🟡 Branchée à Supabase (auth, organisation, calendrier, création de posts, inbox + Realtime, enregistrement des jetons push) ; **compile, mais jamais testée sur un vrai projet ni sur appareil**. Pas encore : envoi de médias, connexion de canaux |
| Notifications push (Expo) : Edge Function `send-push`, déclenchée par la base, suppression des jetons morts, reprise d'un jeton par un autre compte | ✅ Logique et SQL testés (Expo simulé, pg_net/Vault émulés) ; **fonction non déployée ni exécutée sous Deno, jamais essayée contre Expo ni sur appareil**. Reçus Expo non relus. Voir ci-dessous |
| Facturation (Stripe), invitation de membres, statistiques | ❌ Pas encore |

Voir `docs/PLAN-MVP.md` pour le plan complet et `docs/RESEAUX.md` pour les démarches auprès de chaque réseau
(ce sont elles, pas le code, qui fixeront la date de lancement).

## Essayer tout de suite (mode démo, sans Supabase)

```bash
pnpm install
pnpm dev            # http://localhost:3100
```

Sans variables Supabase, l'application tourne avec des données d'exemple : ouvrez `/app` (ou le lien « Ouvrir
l'application de démonstration » sur `/login`). Pour voir l'onboarding d'un nouvel inscrit : `/app/calendrier?onboarding=true`.
Les réponses et publications créées restent en mémoire du serveur, rien ne part aux réseaux. En démo, cliquer sur un canal
de l'onboarding « connecte » un compte fictif.

Parcours d'un nouvel inscrit (calqué sur Postiz) : inscription → l'organisation est créée automatiquement
(`ensure_organization`) → arrivée sur le calendrier avec l'onboarding plein écran → « Commencer » ferme l'onboarding.
Une vidéo de présentation peut remplacer la check-list de l'étape 3 via `NEXT_PUBLIC_TUTORIAL_VIDEO_URL` (URL https).

## Avec un vrai projet Supabase

1. Créez un projet sur [supabase.com](https://supabase.com) (choisissez une région UE si vos utilisateurs sont en Europe).
2. Appliquez les migrations **dans l'ordre** (`supabase/migrations/`), avec la CLI (`supabase link` puis `supabase db push`) ou en collant chaque fichier dans l'éditeur SQL.
3. *Authentication → URL Configuration* : `Site URL` = votre URL, et ajoutez `<URL>/auth/callback` aux URL de redirection.
   Pour tester sans e-mail de confirmation : *Authentication → Providers → Email* → désactiver « Confirm email » (développement uniquement).
4. Copiez `.env.example` en `.env` et renseignez `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (**jamais** côté navigateur) et `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`).
   Le fichier `.env` à la racine est lu par le worker ; pour l'app web, copiez les variables nécessaires dans `apps/web/.env.local` (`NEXT_PUBLIC_*`, et pour connecter des canaux : `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY` et les clés des réseaux, voir `apps/web/.env.example`).
5. `pnpm dev`, créez un compte, puis une organisation.
6. Worker : `pnpm dev:worker` (ajoutez `WORKER_DRY_RUN=1` pour tout essayer sans contacter aucun réseau).
7. Webhooks Meta : `supabase functions deploy webhook-meta --no-verify-jwt`, puis
   `supabase secrets set META_APP_SECRET=… META_WEBHOOK_VERIFY_TOKEN=…` (voir `docs/RESEAUX.md`).

## Notifications push

L'application mobile enregistre un jeton Expo par appareil (`claim_push_token`). L'Edge Function `send-push` l'utilise pour prévenir :

- l'auteur ou les administrateurs visés par une ligne de `notifications` (écrite par le worker : réponse non envoyée, publication en erreur, canal à reconnecter) ;
- à chaque **message entrant** (`messages.direction = 'in'`) : l'agent assigné à la conversation, ou à défaut tous les administrateurs et membres de l'organisation (pas les lecteurs).

La charge `data` contient `conversation_id` quand la notification concerne une conversation (l'app ouvre `/conversation/<id>`, sinon `/notifications`).
Le worker écrit `conversationId` dans `notifications.data` : la fonction le normalise.

**Pourquoi un déclenchement par la base (triggers + `pg_net`) plutôt qu'un appel depuis le worker** : les messages entrants sont écrits par l'Edge Function
`webhook-meta` (RPC `ingest_message`), pas par le worker ; seule la base voit à la fois les messages et les notifications, quelle que soit l'origine de l'écriture
(worker, fonctions, futurs écrivains), sans coupler le worker au push. Contrepartie : `pg_net` est asynchrone et ne rejoue pas, un push peut donc se perdre
(la notification et le message restent en base et dans l'application) ; le trigger n'empêche jamais l'écriture qui l'a déclenché.

Mise en route (après les migrations, dont `20261019000001_push.sql`) :

```bash
supabase functions deploy send-push --no-verify-jwt
supabase secrets set PUSH_WEBHOOK_SECRET=<chaîne aléatoire, ex. openssl rand -hex 32>
# facultatif, si « Enhanced Security for Push Notifications » est activé chez Expo : supabase secrets set EXPO_ACCESS_TOKEN=…
```

Puis, dans l'éditeur SQL (extensions `pg_net` et Vault activées : *Database → Extensions*), avec **la même** valeur de secret :

```sql
select vault.create_secret('https://<ref-projet>.supabase.co/functions/v1/send-push', 'push_function_url');
select vault.create_secret('<le même secret>', 'push_function_secret');
```

Tant que ces deux secrets n'existent pas, les triggers ne font rien. Les jetons qu'Expo déclare en `DeviceNotRegistered` sont supprimés de `push_tokens`.

> ⚠️ **Non exécuté** : aucune Edge Function n'a été lancée sous Deno ni déployée, `pg_net` et le Vault ne sont qu'émulés dans les tests, et rien n'a été envoyé
> à l'API Expo ni reçu sur un appareil. Les **reçus** Expo (`getReceipts`, où apparaît la plupart des `DeviceNotRegistered` en pratique) ne sont pas relus : seuls
> les refus immédiats suppriment un jeton ; une tâche planifiée qui relit les reçus reste à écrire. Pas de préférences de notification par utilisateur ni de mise en sourdine.

## Connexion des canaux (OAuth)

Page *Canaux* → « Connecter » (administrateur de l'organisation uniquement). Un bouton reste **désactivé** tant que le
serveur n'a pas toutes les variables du réseau (`.env.example`) ni `SUPABASE_SERVICE_ROLE_KEY` / `TOKEN_ENCRYPTION_KEY`.

- `POST /api/oauth/start/<réseau>` : crée un `state` signé (HMAC) et, pour X et Google, un PKCE S256. Seul le hachage du `state`
  et le `code_verifier` chiffré sont stockés (`oauth_states`, fermée aux clients), liés à l'utilisateur et à l'organisation.
  Meta, LinkedIn et TikTok n'ont pas de PKCE dans leur flux web documenté : ils reposent sur le `state` lié à l'utilisateur.
- `GET /api/oauth/callback/<meta|x|linkedin|google|tiktok>` : consomme le `state` (usage unique, 10 min), échange le code, lit le profil,
  puis écrit `integrations` + `integration_secrets` en une seule opération SQL (`connect_integration`). Les jetons sont chiffrés
  (AES-256-GCM) et **ne sont jamais renvoyés au navigateur**.
- Meta : jeton longue durée → liste des Pages (Facebook) ou comptes Instagram professionnels liés → l'utilisateur coche ceux à connecter
  (`/app/canaux/connecter/<id>`) → jeton de Page (sans expiration) enregistré, abonnement de la Page aux webhooks.
- Déconnexion : révocation du jeton / désabonnement chez le réseau (au mieux), jetons supprimés, canal marqué supprimé,
  publications en attente passées en erreur.
- Worker : rafraîchit les jetons de X, LinkedIn, YouTube et TikTok qui expirent dans moins de 30 min (verrou en base : un seul worker par
  jeton) ; refus définitif ou jeton échu sans refresh token → canal « À reconnecter » + notification aux administrateurs.

> ⚠️ **Rien de ceci n'a été exécuté contre les vraies API Meta, X, LinkedIn, Google ou TikTok.** Les URL, scopes et formats suivent la
> documentation publique et sont vérifiés uniquement par des tests avec un réseau simulé (`pnpm test`). Les applications des réseaux
> n'existent pas encore (voir `docs/RESEAUX.md`) ; attendez-vous à des ajustements à la première vraie connexion, en particulier pour
> TikTok, Instagram et l'abonnement aux webhooks Meta.

## Domaines

`NEXT_PUBLIC_SITE_URL` est le domaine principal : il sert aux liens des e-mails, aux adresses de retour OAuth et au contrôle d'origine.
Les domaines secondaires (par défaut `getpostbiz.com`, `trypostiz.com`, `postizz.com`, `post-iz.com`, et leur `www.`) redirigent en 308 vers lui,
chemin et paramètres conservés (`apps/web/src/lib/alias-domains.ts`, testé). Changer la liste : variable `SITE_ALIAS_DOMAINS`.

- Les redirections sont **calculées au build** : définir `NEXT_PUBLIC_SITE_URL` (et éventuellement `SITE_ALIAS_DOMAINS`) avant `next build`. Tant que le
  domaine principal est une adresse locale ou absent, rien ne redirige.
- Ce code **n'achète ni ne configure aucun domaine** : chacun doit être enregistré, pointer vers l'hébergement (DNS) et avoir un certificat TLS, sinon
  la redirection n'est jamais atteinte. Le domaine principal doit rester celui déclaré dans l'URL de retour OAuth de chaque réseau
  et dans Supabase (*Authentication → URL Configuration*) ; les secondaires n'y figurent pas.

## Langues

14 langues pour le site, l'authentification et l'application web (sélecteur dans l'en-tête, le pied de page et l'application).

- **Choix de la langue** : cookie `postbiz_locale` (posé par le sélecteur) → en-tête `Accept-Language` → anglais. Le français est la
  langue source ; une clé absente d'une langue retombe sur l'anglais puis sur le français. Pas de préfixe d'URL (`/fr/…`) : une même
  adresse sert toutes les langues.
- **Fichiers** : `apps/web/src/i18n/messages/<langue>.json` (un arbre de messages par langue). Les clés sont typées à partir de `fr.json`.
  Pluriels : suffixes `_zero`, `_one`, `_two`, `_few`, `_many`, `_other` selon `Intl.PluralRules` (`_other` est obligatoire). Texte enrichi :
  balises `<accent>…</accent>`, `<link>…</link>`, etc., rendues par `RichText`.
- **Ajouter une langue** : ajouter son code dans `LOCALES` et `LOCALE_META` (`i18n/config.ts`, avec son sens d'écriture), un drapeau dans
  `components/flags.tsx`, son chargeur dans `i18n/messages/index.ts`, puis copier `en.json` en `<langue>.json` et traduire.
  `pnpm --filter @postbiz/web test` signale toute clé manquante ou en trop, tout paramètre `{…}` ou balise modifié, tout pluriel sans `_other`.
- **Droite à gauche** (arabe, hébreu) : `dir` posé sur `<html>`, classes Tailwind logiques (`ms-`, `pe-`, `start-`, `rounded-ee-`…) et
  `rtl:rotate-180` pour les chevrons. Le texte saisi par les utilisateurs (messages, notes) porte `dir="auto"`.
- **Dates, heures, nombres, tailles de fichiers, prix** : `Intl`, selon la langue active.
- **Limites** : textes juridiques (CGU, confidentialité, suppression des données) seulement en français et en anglais (autres langues :
  version anglaise avec un avis) ; le portugais est celui du Brésil ; texte du mode démo, du worker, des notifications poussées et de
  l'application mobile **non traduits** ; polices : Jakarta pour le latin, polices système pour le cyrillique, l'arabe, l'hébreu et le CJK ;
  les traductions ont été rédigées sans relecture native et devront être relues avant un lancement dans ces langues.

## Blog, pages d'agents et pages de canaux

- **Blog** (`/blog`, mise en page du blog de Chatbase) : un article = un dossier `apps/web/content/blog/<identifiant>/` avec `fr.md` et `en.md`
  (en-tête `title`, `description`, `date`, `category` parmi `agents|guides|product`, `cover` parmi `forest|lime|ink`, `coverTitle` court).
  Les couvertures sont dessinées en CSS. Markdown rendu en éléments React (jamais de HTML brut). Un article absent dans une langue s'affiche dans
  l'autre ; toutes les langues autres que le français affichent l'anglais. Flux RSS : `/blog/rss.xml` (`?lang=fr`). `sitemap.xml` et `robots.txt` sont
  générés. Le test `lib/blog/blog.test.ts` valide tous les articles du dépôt (en-têtes, langues, liens internes).
- **Agents IA** (`/<agent>`, `/agent`, `/mcp`) : 20 agents décrits dans `lib/agents.ts`, une même page pour tous (hero en dégradé avec mascotte en boucle, étapes, ce que
  l'agent pourra faire, questions). **Le serveur MCP, la ligne de commande et l'API publique de Postbiz n'existent pas encore** : chaque page l'affiche (« Bientôt »,
  conversation d'exemple marquée « Aperçu »). Ne rien y écrire sur l'installation tant que ces accès n'existent pas.
- **Canaux** (`/canaux/<réseau>`) : une page par réseau géré (Facebook, Instagram, X, LinkedIn, TikTok, YouTube), alimentée par `lib/networks.ts` : si l'état d'un réseau y change,
  la page change avec lui. Pas de page pour les réseaux que Postbiz ne gère pas.
- Les vidéos de mascotte, les logos d'agents et de réseaux viennent de postiz.com : voir `NOTICE.md`.

## Tests

```bash
pnpm test           # web, worker, core, base de données
pnpm typecheck
```

## Structure

```
apps/web        Site vitrine, authentification et application (Next.js 16, Tailwind 4, Supabase)
apps/worker     Publication, envoi des réponses, balayage du travail abandonné (Node, tsx)
apps/mobile     Application Expo (repris de postiz-mobile), branchée à Supabase — voir son README
apps/uploader   Normalisation des médias, Python (repris de postiz-uploader) — à brancher
packages/core   Chiffrement, webhooks Meta, envoi (ré-exportés de supabase/functions/_shared) et flux OAuth des réseaux (src/oauth)
packages/db     Tests de la base dans PGlite
supabase/       Migrations, Edge Functions, code partagé Deno/Node
```

## Principes de fiabilité (repris de Postiz)

- Une publication ou une réponse dont **l'issue est incertaine** (délai, 5xx, coupure) n'est **jamais rejouée automatiquement** :
  elle passe en `unknown` / `failed` avec un message, pour éviter les doublons chez le réseau.
- Les jetons des réseaux sont chiffrés (AES-256-GCM) et stockés dans une table sans aucun accès client.
- L'isolation entre organisations est appliquée par la base (RLS), pas par l'interface.

## Licence

AGPL-3.0, voir `LICENSE` et `NOTICE.md` (origine des composants repris et autorisations).
