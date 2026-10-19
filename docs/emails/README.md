# E-mail de confirmation d'inscription

Modèle du message « Confirm sign up » de Supabase, en 14 langues. Le lien du bouton envoie sur `/auth/confirm` du site, qui valide
l'adresse puis ouvre l'onboarding (`/app/calendrier?onboarding=true`), comme l'activation de compte de Postiz.

## À installer dans Supabase (une fois par projet)

1. **Authentication → Emails → Templates → Confirm sign up**
   - **Subject heading** : coller le contenu de `confirm-signup.subject.txt` (une seule ligne).
   - **Message body** : coller le contenu de `confirm-signup.html`.
2. **Authentication → URL Configuration**
   - **Site URL** : l'adresse publique du site, sans `/` final (`http://localhost:3100` en local). Le lien du bouton en est construit.
   - **Redirect URLs** : `<Site URL>/**`.
3. **Authentication → Sign In / Providers → Email** : laisser « Confirm email » activé.

## Comment ça marche

- Le site crée le compte avec `signUp` et ajoute `source: "web"` et `locale` aux métadonnées de l'utilisateur
  (`signup` dans `apps/web/src/app/(auth)/actions.ts`). Le modèle lit `locale` pour la langue, `source` pour le lien.
- `source = web` : lien `<Site URL>/auth/confirm?token_hash=…&type=email`. Il se valide depuis n'importe quel appareil
  (inscription sur l'ordinateur, e-mail ouvert sur le téléphone), contrairement au lien à code de Supabase, qui exige le navigateur
  de l'inscription.
- Sans `source` (application mobile) : le modèle garde le lien par défaut de Supabase (`ConfirmationURL`), donc le mobile n'est pas touché.
- `locale` absente : français. Langue inconnue : anglais.
- Modèle resté par défaut : l'inscription fonctionne quand même (lien à code, repli dans `/auth/callback`), mais seulement dans le
  navigateur où le compte a été créé.

## À savoir

- Le moteur de modèles de Supabase est celui de Go (`{{ if }}`, `{{ with }}`). Ce modèle n'a pas pu être exécuté hors de Supabase : après l'avoir collé, faites une vraie inscription de test dans une autre langue que le français.
- L'expéditeur par défaut de Supabase est limité à quelques messages par heure et n'écrit qu'aux membres de l'équipe du projet.
  Pour de vrais utilisateurs : **Project Settings → Authentication → SMTP Settings** (Resend, Postmark, SES…).
- Le jeton d'un lien ne sert qu'une fois : certains antivirus de messagerie l'ouvrent avant l'utilisateur. Dans ce cas, `/auth/confirm`
  renvoie vers la connexion avec « lien n’est plus valide », et l'utilisateur peut se connecter si son adresse est déjà confirmée.
