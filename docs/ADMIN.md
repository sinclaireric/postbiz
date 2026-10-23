# Espace propriétaire (super admin)

Tableau de bord réservé au propriétaire du SaaS : `https://getpostbiz.com/admin`.

| Page | Contenu |
|---|---|
| `/admin` | Utilisateurs (total, nouveaux, actifs sur 7 jours, e-mails non confirmés), essais en cours et ceux qui se terminent sous 3 jours, abonnés payants, MRR/ARR, essais non convertis, inscriptions des 30 derniers jours, répartition des abonnements, activation (organisations avec un canal / ayant publié), canaux par réseau, publications par état |
| `/admin/utilisateurs` | Liste de tous les comptes : organisation, offre, statut de l'abonnement (avec la date de fin d'essai ou de renouvellement), canaux, publications, inscription, dernière connexion. Recherche et filtre par statut |
| `/admin/utilisateurs/[id]` | Fiche d'un utilisateur (clic sur son nom dans la liste) : compte (inscription, dernière connexion, e-mail confirmé, mode de connexion), chacune de ses organisations avec son rôle, son abonnement (offre, statut, dates, identifiants Stripe), son activité (membres, publications par état, dernière publiée) et ses canaux (réseau, état, jeton valable jusqu'au). **Aucun texte de publication ni de message, aucun jeton** : seulement des métadonnées et des chiffres |
| `/admin/abonnements` | Une ligne par organisation : propriétaire, offre, statut, membres, canaux, publications. Puces de statut avec leur effectif |

L'espace est en lecture seule : il ne modifie ni abonnement ni compte.

## Mise en route

1. **Appliquer les migrations** `supabase/migrations/20261025000001_platform_admin.sql` puis `20261026000001_admin_user_detail.sql` (éditeur SQL de Supabase, ou `supabase db push`).
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
- Chaque fonction (`admin_overview`, `admin_users`, `admin_organizations`, `admin_user_detail`) vérifie `is_platform_admin()` elle-même et refuse sinon (erreur `forbidden`) : un utilisateur ordinaire qui appellerait l'API directement n'obtient rien.
- Pour un utilisateur connecté qui n'est pas propriétaire, `/admin` répond « page introuvable » (l'existence de l'espace n'est pas confirmée). Sans session, on est renvoyé vers la connexion. `/admin` est exclu des moteurs de recherche (`robots.txt` et `noindex`).
- Aucune clé `service_role` n'est utilisée côté site pour cet espace.

## Abonnements et essais

La table `subscriptions` (une ligne par organisation) est nouvelle : **la facturation n'est pas encore branchée**, rien ne l'alimente à part l'essai automatique.

- **Essai automatique** : chaque nouvelle organisation démarre un essai de **14 jours sur l'offre Pro** (trigger `start_trial`). Pour changer la durée ou l'offre, modifier cette fonction dans une nouvelle migration. Rien dans l'application ne limite encore les fonctionnalités selon l'offre ou la fin d'essai.
- **Organisations existantes** (créées pendant la bêta gratuite) : pas d'abonnement, comptées à part sous « Sans abonnement ». On ne leur invente pas d'essai.
- **Statuts** : `trialing`, `active`, `past_due`, `canceled` (ceux de Stripe, pour que le futur webhook les recopie). L'espace propriétaire en déduit une phase : `trialing` (essai en cours), `trial_expired` (essai terminé sans abonnement), `paying`, `past_due`, `canceled`, `none`.
- **MRR** : calculé par le site avec les tarifs publiés (`apps/web/src/lib/pricing.ts`) à partir de l'offre et du rythme de facturation des abonnements `active`. Un paiement en retard n'est pas compté tant qu'il n'est pas régularisé. Avec la remise annuelle de 20 %, un abonnement annuel vaut son prix mensuel remisé.
- Les écritures sur `subscriptions` sont réservées au `service_role` : un client ne peut pas s'accorder un abonnement. Pour tester à la main :

  ```sql
  update public.subscriptions
     set status = 'active', plan = 'pro', trial_ends_at = null, current_period_end = now() + interval '30 days'
   where org_id = '…';
  ```

## Mode démo

Sans Supabase configuré (`NEXT_PUBLIC_SUPABASE_URL` vide), `/admin` s'ouvre avec des données d'exemple (`apps/web/src/lib/admin/demo.ts`), pour voir le rendu sans base.

## Langues

Les textes de l'espace propriétaire (`admin.*`) n'existent qu'en français et en anglais ; les autres langues affichent l'anglais.
