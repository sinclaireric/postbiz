# Postbiz

Planifiez vos publications et répondez à tous vos messages et commentaires depuis une seule boîte de réception
(Facebook, Instagram, X, LinkedIn, TikTok, YouTube). Fork de [Postiz](https://github.com/gitroomhq/postiz-app), AGPL-3.0.

## État du MVP

| Brique | État |
|---|---|
| Site vitrine, tarifs, pages légales (brouillons) | ✅ Fait, en français (`apps/web`) |
| Connexion / inscription / mot de passe oublié (Supabase Auth) | ✅ Écrit ; **à valider sur un projet Supabase réel** |
| Application : boîte de réception, publications, canaux, réglages | ✅ Fonctionne en **mode démo** ; branchement Supabase écrit mais **non testé sur un projet réel** |
| Base Supabase : schéma, RLS multi-organisations, file d'envoi, ingestion des messages | ✅ Migrations testées (49 tests dans PGlite, sans Docker) |
| Webhooks Meta : signature, normalisation, Edge Function `webhook-meta` | ✅ Logique testée ; **fonction non déployée ni exécutée sous Deno** |
| Worker : publication (Facebook, X, LinkedIn : texte), envoi de réponses Messenger/Instagram/commentaires | ✅ Logique testée avec des réseaux simulés ; **jamais exécuté contre les vraies API** |
| Connexion des canaux par OAuth | ❌ Pas encore. Contournement : `pnpm --filter @postbiz/worker add-channel` avec un jeton obtenu à la main |
| Envoi d'images/vidéos, Instagram / TikTok / YouTube en publication | ❌ Pas encore (`apps/uploader` à brancher) |
| Inbox X, LinkedIn (commentaires), TikTok, YouTube (commentaires) | ❌ Pas encore |
| App mobile (`apps/mobile`) | 🟡 Code repris et rebrandé, **toujours sur données factices** ; rien n'est branché à Supabase |
| Facturation (Stripe), invitation de membres, notifications push, statistiques | ❌ Pas encore |

Voir `docs/PLAN-MVP.md` pour le plan complet et `docs/RESEAUX.md` pour les démarches auprès de chaque réseau
(ce sont elles, pas le code, qui fixeront la date de lancement).

## Essayer tout de suite (mode démo, sans Supabase)

```bash
pnpm install
pnpm dev            # http://localhost:3100
```

Sans variables Supabase, l'application tourne avec des données d'exemple : ouvrez `/app` (ou le lien « Ouvrir
l'application de démonstration » sur `/login`). Les réponses envoyées restent en mémoire du serveur, rien ne part aux réseaux.

## Avec un vrai projet Supabase

1. Créez un projet sur [supabase.com](https://supabase.com) (choisissez une région UE si vos utilisateurs sont en Europe).
2. Appliquez les migrations **dans l'ordre** (`supabase/migrations/`), avec la CLI (`supabase link` puis `supabase db push`) ou en collant chaque fichier dans l'éditeur SQL.
3. *Authentication → URL Configuration* : `Site URL` = votre URL, et ajoutez `<URL>/auth/callback` aux URL de redirection.
   Pour tester sans e-mail de confirmation : *Authentication → Providers → Email* → désactiver « Confirm email » (développement uniquement).
4. Copiez `.env.example` en `.env` et renseignez `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (**jamais** côté navigateur) et `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`).
   Le fichier `.env` à la racine est lu par le worker ; pour l'app web, copiez aussi les variables `NEXT_PUBLIC_*` dans `apps/web/.env.local`.
5. `pnpm dev`, créez un compte, puis une organisation.
6. Worker : `pnpm dev:worker` (ajoutez `WORKER_DRY_RUN=1` pour tout essayer sans contacter aucun réseau).
7. Webhooks Meta : `supabase functions deploy webhook-meta --no-verify-jwt`, puis
   `supabase secrets set META_APP_SECRET=… META_WEBHOOK_VERIFY_TOKEN=…` (voir `docs/RESEAUX.md`).

## Tests

```bash
pnpm test           # web, worker, core, base de données
pnpm typecheck
```

## Structure

```
apps/web        Site vitrine, authentification et application (Next.js 16, Tailwind 4, Supabase)
apps/worker     Publication, envoi des réponses, balayage du travail abandonné (Node, tsx)
apps/mobile     Application Expo (repris de postiz-mobile) — à brancher à Supabase
apps/uploader   Normalisation des médias, Python (repris de postiz-uploader) — à brancher
packages/core   Ré-exporte le code partagé de supabase/functions/_shared (chiffrement, webhooks Meta, envoi)
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
