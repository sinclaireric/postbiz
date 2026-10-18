# Postbiz mobile

Application Expo (SDK 55, React Native 0.83, expo-router, NativeWind, Zustand) branchée sur **Supabase** : connexion,
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

### Notifications push et appareil réel

- Les jetons push ne fonctionnent que sur **appareil réel** (ni simulateur ni web) et dans un **build de développement** (`eas build --profile development`), pas dans Expo Go.
- iOS : le certificat/entitlement push est géré par EAS. Android : ajoutez le `google-services.json` de votre projet Firebase (FCM).
- `app.json` contient l'identifiant de projet EAS hérité de postiz-mobile (`extra.eas.projectId`) : remplacez-le par le vôtre (`eas init`) avant de construire.

## Ce qui est branché

| Écran | Source Supabase |
|---|---|
| Connexion, inscription, mot de passe oublié | Supabase Auth (e-mail + mot de passe). Session stockée dans `expo-secure-store` (découpée en morceaux de 1,8 Ko, voir `lib/supabase.ts`) |
| Organisation | `memberships` → `organizations`. À la première connexion, l'organisation est créée avec le nom d'entreprise saisi à l'inscription (RPC `create_organization`) ; sinon un écran la demande |
| Calendrier, création / modification / suppression | `posts` : l'application n'écrit que les états `draft` et `queued` (la RLS refuse le reste). « Publier maintenant » = `queued` avec `publish_at = maintenant` : c'est le worker qui envoie |
| Canaux | `integrations`, **lecture seule** (créés par le callback OAuth, côté serveur) |
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

- **Médias** : l'envoi d'images et de vidéos n'est pas branché (Storage + `apps/uploader` à venir) ; l'enregistrement est refusé avec un message si un média est joint.
  La médiathèque du compositeur est encore factice.
- **Réglages du compositeur sans effet côté serveur** : étiquettes, répétition, délai, relayeurs, carrousel. L'interface les affiche (héritage de postiz-mobile) mais rien n'est enregistré.
- **Connexion d'un canal** : impossible depuis l'application (OAuth côté serveur pas encore écrit) ; l'écran renvoie vers le web. Optionnel : `EXPO_PUBLIC_WEB_URL`.
- **Statistiques** : retirées de la navigation, aucune donnée n'existe en base.
- **Notifications push** : envoyées par l'Edge Function `send-push` (voir le README racine, « Notifications push »), **jamais exécutée contre un vrai projet Supabase ni Expo**.
  Elle pousse chaque ligne de `notifications` et chaque message entrant ; la charge `data` contient `conversation_id` (ouvre `/conversation/<id>`).
  L'enregistrement du jeton passe par le RPC `claim_push_token`, qui reprend aussi un jeton encore lié à un autre compte (appareil prêté).
  Les jetons en `DeviceNotRegistered` sont supprimés côté serveur à l'envoi ; les reçus Expo (envoi différé) ne sont pas relus.
- Le sélecteur d'heure du calendrier reste en 12 h (am/pm) ; le reste de l'interface est en 24 h.
- Les connexions Google/Apple de la maquette d'origine ont été retirées (non branchées).

## Commandes

```bash
npm start                    # expo start
npm run typecheck            # npx tsc --noEmit
npm test                     # tests unitaires (parseur des liens d'authentification)
npm run check:inbox-logic    # lib/inbox/logic.ts identique à celui du web ?
```

## Structure

```
app/            Écrans expo-router : (auth)/ connexion, (tabs)/ calendrier, canaux, inbox, réglages ; conversation/[id]
components/     Interface (reprise de postiz-mobile) ; app-data-sync.tsx charge les données et ouvre Realtime
lib/            supabase.ts (client), push.ts, use-realtime.ts, auth-links.ts, inbox/ (logique partagée avec le web)
store/          Stores Zustand adossés à Supabase : auth, org, channels, posts, inbox, notifications
```
