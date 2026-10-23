# E-mails d'authentification Supabase

Deux modèles, en 14 langues, à coller dans Supabase :

| Modèle Supabase | Fichiers | Le lien du bouton |
|---|---|---|
| **Confirm sign up** (inscription) | `confirm-signup.html`, `confirm-signup.subject.txt` | `/auth/confirm` valide l'adresse, ouvre la session et envoie sur l'onboarding (`/app/calendrier?onboarding=true`), comme l'activation de compte de Postiz |
| **Reset password** (mot de passe oublié) | `recovery.html`, `recovery.subject.txt` | `/auth/confirm` ouvre la session et envoie sur `/reset-password` |

Mise en page : celle d'un message de confirmation Supabase (logo, titre, texte avec l'adresse, bouton, mention « pas vous », pied de page),
aux couleurs de Postbiz. Le logo est dessiné en HTML, car les clients e-mail n'affichent pas le SVG ; une fois le site en ligne, il peut
être remplacé par une image hébergée. Le message reprend l'adresse du destinataire avec `{{ .Email }}`.

Les fichiers `.html` et `.subject.txt` sont **générés** par `build.py`, où se trouvent les textes : pour changer un mot, modifier `build.py`
puis lancer `python3 docs/emails/build.py`. Avec un dossier en argument, il écrit aussi un aperçu HTML par langue.

## À installer dans Supabase (une fois par projet)

1. **Authentication → Emails → Templates → Confirm sign up**
   - **Subject heading** : coller le contenu de `confirm-signup.subject.txt` (une seule ligne). Supabase limite l'objet à 255 caractères : il est en français pour une inscription en français, en anglais sinon. Le corps du message, lui, suit la langue de l'utilisateur.
   - **Message body** (onglet **Source**) : coller le contenu de `confirm-signup.html`.
2. **Authentication → Emails → Templates → Reset password** : même chose avec `recovery.subject.txt` et `recovery.html`.
3. **Authentication → URL Configuration**
   - **Site URL** : l'adresse publique du site, sans `/` final (`http://localhost:3100` en local). Les liens des boutons en sont construits.
   - **Redirect URLs** : `<Site URL>/**`.
4. **Authentication → Sign In / Providers → Email** : laisser « Confirm email » activé.

Pour copier un fichier dans le presse-papiers sur Mac : `pbcopy < docs/emails/recovery.html`.

## Comment ça marche

- Le site envoie `locale` (langue de l'interface) et `source: "web"` avec l'inscription (`signup` dans `apps/web/src/app/(auth)/actions.ts`).
  Les modèles lisent `locale` pour la langue : absente, c'est le français ; inconnue, l'anglais.
- **Inscription** : avec `source = web`, le lien est `<Site URL>/auth/confirm?token_hash=…&type=email`. Il se valide depuis n'importe quel
  appareil (inscription sur l'ordinateur, e-mail ouvert sur le téléphone), contrairement au lien à code de Supabase, qui exige le navigateur
  de l'inscription. Sans `source` (application mobile), le modèle garde le lien par défaut de Supabase (`ConfirmationURL`).
- **Mot de passe oublié** : `resetPasswordForEmail` ne transmet pas de métadonnées, donc le modèle reconnaît le site à l'adresse de retour
  (`RedirectTo`) : elle commence par `http` pour le site (lien `<Site URL>/auth/confirm?token_hash=…&type=recovery`), pas pour l'application
  mobile (lien d'application : lien par défaut de Supabase, comme avant). La langue vient de `locale` ; elle manque pour un compte créé
  avec Google ou sur mobile : le message est alors en français.
- Modèle resté par défaut : tout fonctionne quand même (lien à code, repli dans `/auth/callback`), mais seulement dans le navigateur où la
  demande a été faite.
- Si Supabase refuse un modèle à l'exécution (erreur de syntaxe), il envoie le message par défaut en anglais : la cause est dans **Logs → Auth**.

## À savoir

- Le moteur de modèles de Supabase est celui de Go (`{{ if }}`, `{{ with }}`). Ces modèles n'ont pas pu être exécutés hors de Supabase :
  après les avoir collés, faites une vraie inscription de test, puis un « mot de passe oublié », dans une autre langue que le français.
- L'expéditeur par défaut de Supabase est limité à quelques messages par heure et n'écrit qu'aux membres de l'équipe du projet.
  Pour de vrais utilisateurs : **Project Settings → Authentication → SMTP Settings** (Resend, Brevo, Postmark, SES…).
- Le jeton d'un lien ne sert qu'une fois : certains antivirus de messagerie l'ouvrent avant l'utilisateur. Dans ce cas, `/auth/confirm`
  renvoie vers la connexion avec « lien n'est plus valide » ; pour une inscription, l'utilisateur peut se connecter si son adresse est déjà
  confirmée, pour un mot de passe, il en redemande un.
