# Espaces de travail (workspaces)

Un espace de travail **est** une organisation (`organizations`). Une personne peut en avoir plusieurs, dans chacun avec son propre rôle (`admin`, `member` ou `viewer`), et choisit celui qu'elle ouvre. Chaque espace garde ses propres canaux, publications, messages, médias, connaissances, statistiques et conversations de l'agent : tout est déjà rattaché à `org_id` et protégé par la RLS, rien n'a été migré.

Migration : `supabase/migrations/20261102000001_workspaces.sql` (à appliquer après les précédentes). Tests : `packages/db/test/workspaces.test.ts`.

## Dans l'application

- **Sélecteur** dans l'en-tête et dans le menu du compte : liste des espaces, « Nouvel espace de travail », « Gérer mes espaces », invitations en attente.
- **Réglages** : mes espaces (ouvrir, créer), nom de l'espace, équipe (rôle de chacun, retirer, quitter), invitations (en attente, lien à copier, révoquer), suppression de l'espace.
- **Espace courant** : cookie `postbiz_org` (httpOnly), posé par une action serveur. Il n'est jamais cru sur parole : à chaque requête, `getSession` lit les appartenances de la personne (sous la RLS) et n'ouvre l'espace du cookie que s'il y figure ; sinon c'est son plus ancien espace. Un cookie forgé, périmé (espace quitté ou supprimé) ou vers l'espace de quelqu'un d'autre ne donne donc rien de plus.
- **Application mobile / API** : le client sans cookie envoie l'en-tête `x-postbiz-org: <id de l'espace>` avec son jeton ; il est vérifié de la même façon (`getSessionForToken`). Le mobile lui-même (`apps/mobile`) n'a pas encore de sélecteur.
- **Retour des canaux** (OAuth) : la connexion est enregistrée dans l'espace où elle a été lancée (le `state`), et la page de retour s'ouvre dans cet espace.
- **Notifications** : celles de l'espace courant, plus celles qui ne sont rattachées à aucun espace.

## Règles (appliquées par la base, pas seulement par l'interface)

| Règle | Où |
|---|---|
| Un espace se crée avec `create_organization(p_name, p_copy_members_from)` : nom nettoyé et limité à 120 caractères, compte non suspendu, administrateur d'au moins un espace (ou aucun), **10 espaces créés au plus par personne** (supprimer en libère un) | `create_organization` |
| Reprise facultative des membres d'un autre espace (avec leur rôle), réservée à ses administrateurs | `create_organization` |
| Un espace garde toujours **au moins un administrateur** : le dernier ne peut ni partir ni être rétrogradé (la suppression de l'espace ou du compte passe) | trigger `memberships_keep_admin` |
| **Un seul essai gratuit par personne** : le premier espace démarre l'essai de 14 jours, les suivants reprennent la même date de fin (passée, ils apparaissent « essai terminé »). La date de début est dans `user_trials` et ne bouge plus, même si l'on supprime ses espaces | `start_trial`, `user_trials` |
| Invitation par adresse e-mail : lien à usage unique, valable **7 jours**, jeton aléatoire stocké **haché** (jamais en clair), 50 invitations en attente au plus, réponse identique que l'adresse ait un compte ou non | `invite_to_workspace`, `workspace_invitations` |
| Les invitations reçues se retrouvent par l'adresse **confirmée** du compte, sans le lien | `my_invitations`, `accept_invitation_by_id` |
| Suppression d'un espace : administrateur seulement, saisie du nom, refusée s'il reste des canaux connectés ou des publications en file, ou si c'est le dernier espace de la personne ; ses fichiers du stockage sont retirés ensuite (clé de service) | `delete_workspace`, `lib/workspace-storage.ts` |

## À savoir

- **Aucun e-mail d'invitation n'est envoyé** : l'administrateur copie le lien et l'envoie lui-même. Un envoi automatique demanderait `SUPABASE_SERVICE_ROLE_KEY` et le modèle « Invite user » dans Supabase.
- **Les fichiers d'un espace supprimé** (`media`, `knowledge`) ne sont retirés que si le serveur a `SUPABASE_SERVICE_ROLE_KEY` ; sinon ils restent dans le stockage (un message est écrit dans les journaux du serveur).
- Aucune limite par offre n'est appliquée (espaces, membres) : la grille tarifaire annonce 1 / 5 / 15 membres, mais les abonnements ne sont appliqués nulle part.
- Un nouvel inscrit qui ouvre un lien d'invitation reçoit d'abord son propre espace (comme tout nouveau compte) ; l'invitation se retrouve dans ses Réglages si l'adresse est la même, ou en rouvrant le lien.
- Deux onglets sur deux espaces différents partagent le même cookie : une action s'applique à l'espace du cookie. Le nom de l'espace est toujours affiché dans l'en-tête.
- Le propriétaire de la plateforme (`/admin`) voit toutes les organisations de chaque utilisateur (fiche utilisateur) ; la liste des utilisateurs garde la plus ancienne et indique « N organisations ».
