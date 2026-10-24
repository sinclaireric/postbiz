# Notices

Postbiz est un fork de [Postiz](https://github.com/gitroomhq/postiz-app), © Gitroom, publié sous
**GNU AGPL-3.0** (voir `LICENSE`). Postbiz reste donc sous AGPL-3.0 : toute personne qui accède à
Postbiz via un réseau doit pouvoir obtenir le code source correspondant, y compris vos modifications.

## Composants repris

| Dossier | Origine | Statut juridique |
|---|---|---|
| `apps/mobile` | `gitroomhq/postiz-mobile` | Dépôt sans licence. **Utilisé avec l'autorisation de ses auteurs** : conserver la preuve écrite et demander l'ajout d'une licence. |
| `apps/uploader` | `gitroomhq/postiz-uploader` | Dépôt sans licence. **Utilisé avec l'autorisation de ses auteurs** : idem. |
| `packages/*`, `apps/worker` | Écrits pour Postbiz, avec des idées reprises de `postiz-app` (AGPL-3.0) | AGPL-3.0 |
| `apps/web/src/lib/agent/`, `apps/web/src/components/agent/`, `apps/web/src/app/api/agent/`, `apps/web/src/app/app/(shell)/agent/` | Page « Agent » : reprend l'organisation de l'onglet Agent de `postiz-app` (AGPL-3.0) — canaux à gauche, conversation au centre, historique à droite — et son principe d'outils (consulter les publications et la médiathèque, préparer des publications validées par les règles de chaque réseau, confirmation avant écriture). Même modèle que celui de l'agent de Postiz (GPT-5.2, d'OpenAI). Code réécrit pour Postbiz (OpenAI, Supabase, Next.js) : aucun fichier de `postiz-app` n'est copié. | AGPL-3.0 |
| `apps/web/src/lib/text/style.ts`, `apps/web/src/lib/text/length.ts`, `apps/web/src/components/calendar/post-editor.tsx`, `emoji-picker.tsx` | Éditeur de publication : le gras et le souligné en caractères Unicode (alphabet gras sans empattement, trait souligné combinant), le décompte des caractères de X et le sélecteur d'émojis reprennent l'approche de l'éditeur de `postiz-app` (AGPL-3.0). Code réécrit pour un champ texte simple ; le sélecteur utilise `emoji-picker-react` (MIT). | AGPL-3.0 |

## Marques

« Postiz » et son logo appartiennent à leurs propriétaires et ne sont pas utilisés par Postbiz comme
marque. Le site marketing de Postbiz s'inspire du *langage visuel* d'autres produits sans reprendre
leurs textes, polices, illustrations ni couleurs. Exceptions, à connaître :

| Élément | Origine | Précaution |
|---|---|---|
| `apps/web/public/agents/*.svg` : logos des 20 agents IA (Claude, ChatGPT, Claude Code, Cursor, Codex, OpenClaw, Hermes Agent, Grok Bot, Gemini, DeepSeek, Kimi…) et pictogrammes MCP / terminal, affichés dans le titre de l'accueil, le menu « Agents IA » et les pages d'agents | Copiés depuis `postiz.com/svgs/agents/` ; ceux de Gemini, DeepSeek et Kimi, qui n'y sont pas en fichier, sont extraits du SVG intégré aux pages `postiz.com/gemini`, `/deepseek` et `/kimi` | Marques de leurs propriétaires respectifs, montrées uniquement pour nommer les agents que Postbiz vise (le serveur MCP, la CLI et l'API publique ne sont **pas encore disponibles**, et les pages le disent). Aucun partenariat ni soutien n'est sous-entendu : à retirer à la demande d'un propriétaire, ou si la compatibilité n'est finalement pas proposée. |
| `apps/web/public/socials/*.svg` : logos de Facebook, Instagram, X, LinkedIn, TikTok et YouTube, affichés sur les pastilles des pages d'agents et dans le menu « Canaux » | Copiés depuis `postiz.com/svgs/socials/`, sauf `messenger.svg` et `whatsapp.svg` (pastilles redessinées pour Postbiz, avec le pictogramme de Messenger et celui de WhatsApp, qui illustrent la boîte de réception de la démonstration de l'accueil ; WhatsApp n'est pas un canal de Postbiz) | Marques de leurs propriétaires, montrées pour désigner les six réseaux que Postbiz gère. Voir aussi la mention en pied de page. |
| `apps/web/public/agents/hero/*.webm` et `*.webp` : mascottes animées (20 vidéos de 10 s et leurs affiches) des pages d'agents | Copiés depuis `postiz.com/videos/<agent>-hero.webm` et `postiz.com/pngs/<agent>-hero-poster.webp` ; la vidéo de Claude Cowork a aussi été fournie par le propriétaire du projet | Illustrations 3D réalisées pour Postiz, reprises à la demande du propriétaire du projet, qui indique l'accord de Gitroom : **à confirmer par écrit**. Elles ne portent pas le logo Postiz mais appartiennent à Postiz ; à remplacer par des créations propres à Postbiz avant un lancement public. |
| Animation de chargement du hero (`globals.css`, `.hero-*`) | Séquence (délais, durées, courbe, flou, perspective) relevée sur la page `x.ai/bot` | Réimplémentée en CSS : aucun code, texte ni visuel de x.ai n'est repris. |
| `apps/web/public/videos/*.webm` : démonstrations de l'accueil | Captures de l'interface de Postiz (logo « postiz » visible), fournies par le propriétaire du projet Postbiz | Réutilisées avec l'accord de Gitroom indiqué par le propriétaire du projet : à confirmer par écrit. À remplacer par des captures de Postbiz dès que l'interface sera prête. |
