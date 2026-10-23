# Postbiz mobile

Application Expo (SDK 58, React Native 0.88, expo-router, NativeWind, Zustand), design clair avec le vert fluo du logo (`#C6F432`) branchée sur **Supabase** : connexion,
organisation, calendrier et création de publications, boîte de réception unifiée avec Realtime, notifications push.
Repris de [postiz-mobile](https://github.com/gitroomhq/postiz-mobile) avec l'autorisation de ses auteurs (voir `../../NOTICE.md`).

> ⚠️ **Écrit mais pas encore testé sur un vrai projet Supabase ni sur un appareil.** Vérifié : `npx tsc --noEmit` passe,
> le bundle iOS se construit (`npx expo export --platform ios`), le parseur des liens d'e-mail est testé (`npm test`).
> Non vérifié : les requêtes contre une base réelle, Realtime, l'enregistrement du jeton push, l'affichage sur téléphone.

## Lancer l'application

1. Créez un projet Supabase et appliquez les migrations de `../../supabase/migrations/` dans l'ordre
   (voir le README à la racine, section « Avec un vrai projet Supabase »).
2. Dans *Authentication → URL Configuration → Redirect URLs*, autorisez les liens de retour des e-mails :
   `postbiz://**` (application installée) et, pour le développement avec Expo Go, `exp://**`.
   Sans cela, les liens de confirmation et de « mot de passe oublié » seront refusés par Supabase.
3. Copiez `.env.example` en `.env` et renseignez les deux variables (*Project Settings → API*) :

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...      # clé « anon » uniquement, jamais la clé service_role
   ```

   Ces variables sont intégrées au code de l'application : la clé anon est publique par conception, c'est la RLS de la base qui protège les données.
4. Installez et lancez :

   ```bash
   cd apps/mobile
   npm install        # apps/mobile utilise npm, pas pnpm
   npx expo start -c  # -c : vide le cache pour prendre en compte le .env
   ```

   Sans variables, l'application affiche un écran « Configuration manquante » au lieu de planter.

Pour tester sans e-mail de confirmation (développement uniquement) : *Authentication → Providers → Email* → désactiver « Confirm email ».

### Mode démo (sans compte ni Supabase)

Pour voir l'interface avec des données d'exemple, dans le navigateur (aucune requête réseau, aucun compte) :

```bash
EXPO_PUBLIC_DEMO=1 npx expo start --web
```

À ne pas définir en production : sans cette variable, tout le code de démonstration est inerte.

### Agent : déployer la fonction

L'onglet Agent appelle la fonction `agent-compose` (`../../supabase/functions/agent-compose`). Tant qu'elle n'est pas déployée, l'écran affiche « L'agent n'est pas encore activé sur ce projet ».

```bash
supabase functions deploy agent-compose
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # facultatif : AGENT_MODEL (défaut : claude-sonnet-5-5)
```

La fonction exige un utilisateur connecté, membre (admin ou membre) d'une organisation. Elle n'envoie au modèle que le brief et les consignes de style : aucune donnée de l'organisation.
**Pas de limite d'usage par utilisateur pour l'instant** : chaque génération coûte un appel au modèle, à surveiller avant d'ouvrir l'application à beaucoup de monde.
Sa logique (validation, prompts, lecture de la réponse) est testée avec un faux modèle (`packages/core/test/agent.test.ts`) ; **jamais exécutée sous Deno ni contre l'API réelle**.

### Notifications push et appareil réel

- Les jetons push ne fonctionnent que sur **appareil réel** (ni simulateur ni web) et dans un **build de développement** (`eas build --profile development`), pas dans Expo Go.
- iOS : le certificat/entitlement push est géré par EAS. Android : ajoutez le `google-services.json` de votre projet Firebase (FCM).
- `app.json` contient l'identifiant de projet EAS hérité de postiz-mobile (`extra.eas.projectId`) : remplacez-le par le vôtre (`eas init`) avant de construire.

## Ce qui est branché

| Écran | Source Supabase |
|---|---|
| Connexion, inscription, mot de passe oublié | Supabase Auth (e-mail + mot de passe). Session stockée dans `expo-secure-store` (découpée en morceaux de 1,8 Ko, voir `lib/supabase.ts`) |
| Organisation | `memberships` → `organizations`. À la première connexion, l'organisation est créée avec le nom d'entreprise saisi à l'inscription (RPC `create_organization`) ; sinon un écran la demande |
| **Publier** (accueil) : liste par état (à venir, brouillons, envoyées, échecs), filtre par canal, bande de la semaine, « aller à une date » ; création / modification / suppression (écran de rédaction avec aperçu par réseau) | `posts` : l'application n'écrit que les états `draft` et `queued` (la RLS refuse le reste). « Publier maintenant » = `queued` avec `publish_at = maintenant` : c'est le worker qui envoie |
| Canaux (menu du compte → Canaux) | `integrations`, **lecture seule** (créés par le callback OAuth, côté serveur) |
| **Agent** (onglet) | Edge Function `agent-compose` : un brief → une publication adaptée par réseau (ton au choix), relue et modifiable avant enregistrement en brouillon ou programmation. La clé du modèle reste côté serveur |
| **Insights** (onglet, avec filtre par canal et par période) | Calculées depuis `posts` (publiées, à venir, brouillons, échecs, par réseau et par jour) et `messages` / `conversations` (reçus, réponses envoyées, ouvertes, non lues). **Pas** les métriques des réseaux (abonnés, impressions) |
| **Médias** (menu du compte → Médias) | Table `media` + bucket privé `media` (`{org_id}/{fichier}`, URL signées 1 h). Ajout depuis la photothèque, suppression par appui long |
| **Inbox** (onglet) | `conversations`, `messages`. Une réponse insère un message `out` / `queued` ; le worker l'envoie. Fenêtre de 24 h, ordre et filtres : `lib/inbox/logic.ts` |
| Notifications | `notifications`, marquage lu ; Realtime |
| Push | `push_tokens` (RLS : `user_id = auth.uid()`), jeton Expo enregistré à la connexion et supprimé à la déconnexion |

Realtime (`lib/use-realtime.ts`) écoute `posts`, `conversations`, `messages` et `notifications` (publication `supabase_realtime`, migration `…_engine.sql`)
et recharge la tranche concernée ; un retour au premier plan recharge tout.

### Logique partagée avec le web

`lib/inbox/logic.ts` est une **copie identique** de `../web/src/lib/inbox/logic.ts` (fenêtre de réponse, tri, filtres, validation).
`lib/inbox/types.ts` reprend les types du web. Après une modification côté web : recopiez le fichier, puis `npm run check:inbox-logic` confirme qu'il n'y a pas de dérive.

## Sécurité

- Seule la clé anon est dans l'application. Les jetons des réseaux sociaux ne transitent jamais ici (table sans accès client).
- Les publications dont l'issue est incertaine (`unknown`) et les messages en échec ne sont **jamais renvoyés automatiquement** ; l'écran le dit, et l'utilisateur doit explicitement renvoyer un nouveau message.
- À la déconnexion, tous les stores sont vidés et le jeton push de l'appareil est supprimé.

## Limites connues

- **Médias** : joints aux publications (image, vidéo ; jusqu'à 20), choisis dans la médiathèque ou importés depuis le téléphone, avec les mêmes contrôles de format que le web (nombre, mélange image/vidéo, format d'image d'Instagram, médias obligatoires sur Instagram, TikTok et YouTube). Le worker ne publie des médias que sur Facebook et Instagram pour l'instant ; sur les autres réseaux, la programmation est refusée avec un message. Pas de vignette générée pour les vidéos (une icône est affichée), pas de texte alternatif modifiable sur mobile.
- **Réglages du compositeur sans effet côté serveur** : étiquettes, répétition, délai, relayeurs, carrousel. L'interface les affiche (héritage de postiz-mobile) mais rien n'est enregistré.
- **Connexion d'un canal** : l'OAuth se fait sur le site web. Le bouton « Ajouter un canal » l'ouvre (page « Canaux ») dans un navigateur intégré, à l'adresse `EXPO_PUBLIC_WEB_URL` ; l'utilisateur s'y connecte puis clique « Connecter ». À la fermeture, la liste des canaux est rechargée. Un flux natif (jeton Supabase, retour par lien `postbiz://`) n'existe pas encore.
- **Analytics** : seulement les chiffres de Postbiz ; les métriques des réseaux ne sont pas collectées.
- **Notifications push** : envoyées par l'Edge Function `send-push` (voir le README racine, « Notifications push »), **jamais exécutée contre un vrai projet Supabase ni Expo**.
  Elle pousse chaque ligne de `notifications` et chaque message entrant ; la charge `data` contient `conversation_id` (ouvre `/conversation/<id>`).
  L'enregistrement du jeton passe par le RPC `claim_push_token`, qui reprend aussi un jeton encore lié à un autre compte (appareil prêté).
  Les jetons en `DeviceNotRegistered` sont supprimés côté serveur à l'envoi ; les reçus Expo (envoi différé) ne sont pas relus.
- Les connexions Google/Apple de la maquette d'origine ont été retirées (non branchées).
- Les marques Claude et ChatGPT de l'écran d'accueil sont des **approximations dessinées en SVG** (`components/ui/brand-icon.tsx`) : à remplacer par les fichiers officiels, en respectant leurs chartes, avant toute communication publique.

## Commandes

```bash
npm start                    # expo start
npm run typecheck            # npx tsc --noEmit
npm test                     # tests unitaires (parseur des liens d'authentification)
npm run check:inbox-logic    # lib/inbox/logic.ts identique à celui du web ?
```

## Structure

```
app/            Écrans expo-router : (auth)/ accueil animé, connexion, inscription ; (tabs)/ Publier, Agent, Messages, Insights ; create-post (rédaction) ; post/[id] (aperçu par réseau) ; conversation/[id] ; account, channels, media, notifications
components/     ui/ (kit : pilules, feuilles, barre flottante), home/, post-preview/ ; app-data-sync.tsx charge les données et ouvre Realtime
lib/            supabase.ts (client), push.ts, use-realtime.ts, auth-links.ts, inbox/ (logique partagée avec le web)
store/          Stores Zustand adossés à Supabase : auth, org, channels, posts, inbox, notifications
```

> **SDK 58** : Expo Go sur iOS n'ouvre que le SDK le plus récent, le projet a donc été migré du SDK 55 au SDK 58.
> Les dépendances ont été installées avec `--legacy-peer-deps` (npm signalait un faux conflit de pairs sur `expo-symbols`) ; si `npm install` échoue chez vous, utilisez le même drapeau.
