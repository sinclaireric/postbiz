# Espace propriétaire (super admin)

Tableau de bord réservé au propriétaire du SaaS : `https://getpostbiz.com/admin`.

| Page | Contenu |
|---|---|
| `/admin` | Utilisateurs (total, nouveaux, actifs sur 7 jours, e-mails non confirmés), essais en cours et ceux qui se terminent sous 3 jours, abonnés payants, MRR/ARR, essais non convertis, inscriptions des 30 derniers jours, répartition des abonnements, activation (organisations avec un canal / ayant publié), canaux par réseau, publications par état |
| `/admin/utilisateurs` | Liste de tous les comptes : organisation, offre, statut de l'abonnement (avec la date de fin d'essai ou de renouvellement), canaux, publications, inscription, dernière connexion. Recherche et filtre par statut |
| `/admin/utilisateurs/[id]` | Fiche d'un utilisateur (clic sur son nom dans la liste) : compte (inscription, dernière connexion, e-mail confirmé, mode de connexion), chacune de ses organisations avec son rôle, son abonnement (offre, statut, dates, identifiants Stripe), son activité (membres, publications par état, dernière publiée) et ses canaux (réseau, état, jeton valable jusqu'au). **Aucun texte de publication ni de message, aucun jeton** : seulement des métadonnées et des chiffres |
| `/admin/abonnements` | Une ligne par organisation : propriétaire, offre, statut, membres, canaux, publications. Puces de statut avec leur effectif |
| `/admin/support` | **Chat de support** : les conversations des utilisateurs (site et application mobile), avec les messages non lus, un filtre (toutes / non lues / ouvertes / résolues), une recherche (e-mail, nom, espace, texte d'un message), le fil, un champ de réponse et « Marquer comme résolu ». Voir « Support » plus bas |

L'espace est en lecture seule, sauf la suspension d'un compte et le chat de support (voir plus bas) : il ne modifie ni abonnement ni organisation.

## Mise en route

1. **Appliquer les migrations** `supabase/migrations/20261025000001_platform_admin.sql` puis `20261026000001_admin_user_detail.sql`, puis `20261027000001_user_suspension.sql` (éditeur SQL de Supabase, ou `supabase db push`).
   Sans elle, `/admin` répond « page introuvable » pour tout le monde.
2. **Se déclarer propriétaire**, dans l'éditeur SQL (le service_role seul peut écrire dans `platform_admins`) :

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'votre@adresse.com';
   ```

   Pour retirer l'accès : `delete from public.platform_admins where user_id = …`.
3. Se connecter normalement : un lien **Administration** apparaît dans le menu du compte (en haut à droite de l'application).

## Comment c'est protégé

- La liste des administrateurs est dans la base (`platform_admins`), sans aucun droit pour les clients.
- Chaque fonction (`admin_overview`, `admin_users`, `admin_organizations`, `admin_user_detail`, `admin_user_status`, `admin_suspend_user`, `admin_restore_user`) vérifie `is_platform_admin()` elle-même et refuse sinon (erreur `forbidden`) : un utilisateur ordinaire qui appellerait l'API directement n'obtient rien.
- Pour un utilisateur connecté qui n'est pas propriétaire, `/admin` répond « page introuvable » (l'existence de l'espace n'est pas confirmée). Sans session, on est renvoyé vers la connexion. `/admin` est exclu des moteurs de recherche (`robots.txt` et `noindex`).
- Aucune clé `service_role` n'est utilisée côté site pour cet espace.

## Suspendre un utilisateur

Sur la fiche d'un utilisateur : **Suspendre ce compte** (avec un motif facultatif, visible de vous seul), puis **Rétablir le compte**. Un administrateur de la plateforme et soi-même ne peuvent pas être suspendus.

Migration : `supabase/migrations/20261027000001_user_suspension.sql` (à appliquer après les deux précédentes).

Une suspension :
1. refuse la connexion (`auth.users.banned_until`, vérifié par Supabase Auth ; l'écran de connexion affiche « Ce compte est suspendu ») ;
2. ferme ses sessions tout de suite (`auth.sessions`) ;
3. retire tout accès aux données : les politiques d'accès (`is_org_member`, `has_org_role`, `shares_org_with`) répondent « non » à un compte suspendu, même avec un jeton encore valide ;
4. empêche le worker d'envoyer ses publications, ses premiers commentaires et ses réponses de messagerie (`claim_due_posts`, `claim_first_comments`, `claim_outbound_messages`).

Ses données sont conservées. **Au rétablissement, les publications programmées dont l'heure est passée partent aussitôt** : relisez la file avant de rétablir un compte suspendu longtemps. Les organisations dont il est membre continuent d'exister pour leurs autres membres, mais ses propres publications restent en attente.

L'état est dans `user_suspensions` (aucun droit pour les clients). Pour suspendre ou rétablir à la main : `select public.admin_suspend_user('<id>', 'motif')` / `select public.admin_restore_user('<id>')` en étant connecté comme propriétaire, ou, en SQL pur, supprimer la ligne et remettre `auth.users.banned_until` à `null`.

## Abonnements et essais

La table `subscriptions` (une ligne par organisation) est nouvelle : **la facturation n'est pas encore branchée**, rien ne l'alimente à part l'essai automatique.

- **Essai automatique** : le premier espace de travail d'une personne démarre un essai de **14 jours sur l'offre Pro** (trigger `start_trial`). Les espaces qu'elle crée ensuite **reprennent la même date de fin** : pas de nouvel essai (voir `docs/WORKSPACES.md`). Pour changer la durée ou l'offre, modifier cette fonction dans une nouvelle migration. Rien dans l'application ne limite encore les fonctionnalités selon l'offre ou la fin d'essai.
- **Organisations existantes** (créées pendant la bêta gratuite) : pas d'abonnement, comptées à part sous « Sans abonnement ». On ne leur invente pas d'essai.
- **Statuts** : `trialing`, `active`, `past_due`, `canceled` (ceux de Stripe, pour que le futur webhook les recopie). L'espace propriétaire en déduit une phase : `trialing` (essai en cours), `trial_expired` (essai terminé sans abonnement), `paying`, `past_due`, `canceled`, `none`.
- **MRR** : calculé par le site avec les tarifs publiés (`apps/web/src/lib/pricing.ts`) à partir de l'offre et du rythme de facturation des abonnements `active`. Un paiement en retard n'est pas compté tant qu'il n'est pas régularisé. Avec la remise annuelle de 20 %, un abonnement annuel vaut son prix mensuel remisé.
- Les écritures sur `subscriptions` sont réservées au `service_role` : un client ne peut pas s'accorder un abonnement. Pour tester à la main :

  ```sql
  update public.subscriptions
     set status = 'active', plan = 'pro', trial_ends_at = null, current_period_end = now() + interval '30 days'
   where org_id = '…';
  ```

## Support

Chaque utilisateur peut écrire au support depuis le site (bouton **Support** de l'en-tête, page `/app/support`) et depuis l'application mobile (Compte → **Écrire au support**). Vous répondez depuis `/admin/support` ; l'onglet **Support** du menu affiche le nombre de conversations avec des messages non lus.

**Mise en route.** Appliquer `supabase/migrations/20261104000001_support_chat.sql` (après les précédentes), comme les autres migrations. Sans elle, `/admin/support` affiche un message d'installation et le reste de l'espace fonctionne.

**Fonctionnement.**
- Une conversation par utilisateur (tables `support_conversations` et `support_messages`), rattachée à l'espace de travail où il se trouvait à son dernier message. Un nouveau message d'un utilisateur rouvre une conversation résolue.
- Ouvrir une conversation la marque comme lue. Votre réponse la marque aussi comme lue et prévient l'utilisateur : une ligne dans `notifications` (cloche du site, écran Notifications du mobile) que l'Edge Function `send-push` relaie en push (voir le README racine, « Notifications push » : elle doit être déployée et configurée pour que le push parte).
- Vous êtes prévenu de la même façon (cloche, push si vous utilisez l'application mobile) quand une conversation passe de « lue » à « non lue », une fois par série de messages et non à chaque message. Ces notifications ne contiennent pas l'adresse de l'utilisateur.
- Le fil de la page ouverte se rafraîchit toutes les 8 secondes, la liste toutes les 15 secondes (pas de Realtime côté propriétaire : aucune table n'est lisible directement par vous, tout passe par les fonctions `admin_support_*`).
- Texte brut seulement : rien n'est interprété (ni HTML, ni lien cliquable, ni image), pour qu'un message malveillant ne puisse rien faire dans votre navigateur. Ctrl + Entrée envoie une réponse (4 000 caractères au plus).

**Protection.**
- Un utilisateur ne lit et n'écrit que SA conversation (RLS en lecture seule ; l'écriture passe par les fonctions `support_send` et `support_mark_read`). Les autres membres de son espace ne la voient pas.
- Seules les fonctions `admin_support_summary`, `admin_support_conversations`, `admin_support_thread`, `admin_support_reply`, `admin_support_set_status` et `admin_support_mark_read` (qui vérifient chacune `is_platform_admin()`) lisent une autre conversation. Vous y voyez l'adresse e-mail de l'auteur ; aucun autre utilisateur ne voit jamais une adresse, et aucun jeton ni texte de publication n'apparaît.
- Anti-spam, dans la base : 2 000 caractères par message, 5 messages par minute, 20 messages au plus sans réponse de votre part (la réponse libère l'utilisateur). Les caractères de contrôle et les marques de direction du texte (qui permettent de faire passer un texte pour un autre) sont retirés. Un compte suspendu ne peut plus écrire.
- Pour changer ces limites : une nouvelle migration qui remplace `support_send`.

**Pas encore.** Pas de pièces jointes (texte seulement), pas de plusieurs agents de support (les réponses ne gardent pas l'identité de l'administrateur qui les a écrites), pas de réponses types ni d'e-mail (seul Supabase Auth envoie des e-mails aujourd'hui).

**Mode démo.** Sans Supabase, les conversations vivent en mémoire du serveur : trois conversations d'exemple côté propriétaire, et celle de l'utilisateur de démonstration (créée à son premier message) y apparaît aussi, ce qui permet de jouer les deux rôles.

## Mode démo

Sans Supabase configuré (`NEXT_PUBLIC_SUPABASE_URL` vide), `/admin` s'ouvre avec des données d'exemple (`apps/web/src/lib/admin/demo.ts`, et `apps/web/src/lib/support/demo.ts` pour le support), pour voir le rendu sans base.

## Langues

Les textes de l'espace propriétaire (`admin.*`) n'existent qu'en français et en anglais ; les autres langues affichent l'anglais.
