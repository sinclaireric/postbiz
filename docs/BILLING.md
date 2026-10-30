# Facturation (Stripe + mobile money PawaPay)

Offres **Gratuit / Standard (19 $) / Team (39 $) / Agence (79 $)**, par espace de travail (organisation). Carte bancaire par **Stripe** (abonnement renouvelé automatiquement), **mobile money** par **PawaPay** (paiement prépayé de 1 ou 12 mois, sans renouvellement automatique). Migration : `supabase/migrations/20261103000001_billing.sql` ; code : `apps/web/src/lib/billing/`.

## Mise en route

1. Appliquer la migration (après celle des espaces de travail, `20261102000001_workspaces.sql`).
2. **La facturation est désactivée par défaut** (bêta gratuite : aucune limite, aucun paiement, la page Facturation affiche un avis). L'activer depuis `/admin/facturation` (bouton « Activer la facturation ») quand tout est prêt. À l'activation, les limites de chaque offre s'appliquent à tous les espaces ; aucun canal existant n'est déconnecté, seules les nouvelles connexions sont refusées au-delà de la limite (`channel_limit`).
3. Variables d'environnement (noms dans `apps/web/.env.example`, **valeurs jamais dans git** : `.env.local` puis Vercel) :
   - `STRIPE_SECRET_KEY` : `sk_test_…` en développement. Une clé `sk_live_…` est **ignorée** hors production (sauf `BILLING_ALLOW_LIVE_IN_DEV=1`).
   - `STRIPE_WEBHOOK_SECRET` : `whsec_…` du point d'accès `https://<site>/api/billing/stripe/webhook`, événements : `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`. En local : `stripe listen --forward-to localhost:3100/api/billing/stripe/webhook` (Stripe CLI à installer).
   - `PAWAPAY_API_TOKEN` et `PAWAPAY_ENV` (`sandbox` par défaut, `production` seulement sur le serveur de production). Adresse de rappel à déclarer dans le tableau de bord PawaPay : `https://<site>/api/billing/pawapay/callback` (c'est un réglage **du compte** PawaPay : ne pas partager le compte de LEFAX, dont le rappel est déjà pris). PawaPay refuse un retour en `http://localhost` : en local, `BILLING_RETURN_BASE_URL` (adresse https).
   - `CRON_SECRET` : secret de la tâche quotidienne `/api/billing/cron` (planifiée par `apps/web/vercel.json`, 04:00 UTC) qui rapproche les dépôts restés en attente et aligne les statuts des abonnements terminés.
   - Facultatif : `BILLING_USD_PER_EUR` (taux de référence des prix en francs CFA), `GEO_IP_URL` (service de géolocalisation par adresse IP).
4. Stripe n'a rien à préparer : les produits `postbiz_standard|team|agency` sont créés au premier paiement (identifiant fixe) et les prix sont ceux de la grille du code.

## Prix et pays

- Référence : dollars (`lib/billing/plans.ts`). Pays de la zone franc CFA (XAF : CM, GA, TD, CG, CF, GQ ; XOF : SN, CI, TG, BJ, BF, ML, NE, GW) : **conversion moins 15 %**, arrondie aux 500 F (`lib/billing/price.ts`, taux dans `config.ts` : 1 € = 1,1193 $ au 23/10/2026, 1 € = 655,957 F). RDC : dollars moins 15 %. Annuel : −20 % en plus.
- Standard 9 500 F/mois (91 000 F/an), Team 19 500 F (187 000 F), Agence 39 500 F (379 000 F).
- Pays détecté : choix de la personne (cookie `postbiz_region`), sinon en-tête de l'hébergeur (`x-vercel-ip-country`), sinon service d'adresse IP appelé côté serveur (délai 1,5 s, jamais bloquant). Elle peut le changer elle-même.
- Mobile money actif au 25/10/2026 sur le compte PawaPay de LEFAX : Cameroun, Gabon, Congo-Brazzaville, Sénégal, Côte d'Ivoire, Bénin, Burkina Faso (le site relit `/v2/active-conf` : c'est PawaPay qui fait foi). Les autres pays : carte seulement. RDC et Wave : à faire activer chez PawaPay.

## Sécurité

- Un paiement mobile money n'active une offre qu'après **relecture du dépôt chez PawaPay** (`GET /v2/deposits/{id}`, montant et devise comparés à ceux enregistrés avant l'appel) : ni l'adresse de retour, ni le corps d'un rappel ne sont crus. Rappel rejoué = sans effet (`billing_settle_payment` est idempotent).
- Webhook Stripe : signature vérifiée sur le corps brut (tolérance 5 min), événement journalisé avec ses effets dans une seule transaction (`billing_events`), abonnement relu chez Stripe (l'ordre des livraisons n'importe pas). Les événements d'un autre site du même compte Stripe (sans les métadonnées `postbiz_*`) sont ignorés.
- Aucune écriture client sur `subscriptions`, `payments`, `billing_events`, `plan_limits`, `billing_settings` : la RLS et les droits les réservent au `service_role` et aux fonctions `admin_*` (propriétaire de la plateforme). Un administrateur d'espace lit les paiements de son espace seulement.

## Cycle de vie

- Essai : 14 jours de l'offre Standard, une fois par personne (`user_trials`), sans carte.
- Fin de période : l'offre applicable (`org_plan`) se déduit des dates, sans tâche planifiée : essai en cours → période payée → délai de grâce (7 jours en mobile money, 3 jours de plus pour Stripe) → Gratuit. Rien n'est supprimé.
- Changement d'offre en mobile money : la valeur restante de l'ancienne offre (en dollars) est convertie en temps de la nouvelle, au plus une période.
- Abonnement offert : `/admin/utilisateurs/<id>` → « Offrir un abonnement » (offre, 1/3/6/12 mois, note). Jamais compté dans le MRR, ne remplace jamais un abonnement payé.

## Quotas appliqués (valeurs : table `plan_limits`, miroir `lib/billing/plans.ts`, test de concordance)

Canaux (`connect_integration`), images/vidéos IA (`ai_media_reserve`), stockage de médias (déclencheur sur `media`). **À brancher par les sessions concernées** : IA texte (`repos.generation.reserveText`), membres (`org_plan_limit(org,'members')` dans les invitations), connaissances (`knowledge_files|sites`), historique d'analyses (`analytics_days`).

## Réel / simulé

Testé : migration et fonctions SQL (PGlite), calculs de prix, détection de pays, signatures, idempotence, clients Stripe et PawaPay (réponses simulées). **Non testé contre les vrais services** : Stripe Checkout et PawaPay en bac à sable (clés de test à fournir). Mode démo : paiements simulés en mémoire.
