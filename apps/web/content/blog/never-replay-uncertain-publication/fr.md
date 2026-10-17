---
title: Pourquoi Postbiz ne rejoue jamais une publication dont l’issue est incertaine
description: Quand un réseau ne répond pas, impossible de savoir si le post est parti. Réessayer risque de le publier deux fois. La règle que nous avons choisie, et ce que vous voyez à l’écran.
date: 2026-10-09
category: product
cover: lime
coverTitle: Jamais de rejeu à l’aveugle
---

Vous planifiez un post pour 9 h. À l’heure dite, le moteur d’envoi de Postbiz appelle l’API du réseau. Trois choses peuvent se produire : le réseau confirme, le réseau refuse clairement, ou le réseau… ne répond pas.

## Le cas du silence

Les deux premiers cas sont simples. Une confirmation : le post est publié. Un refus clair (droits manquants, texte trop long) : il n’est pas parti, on le dit et on vous laisse le corriger.

Le troisième cas est le piège : délai dépassé, erreur du serveur du réseau, connexion coupée en plein envoi. **Le post est peut-être publié, peut-être pas.** Deux réflexes s’offrent à un système automatique :

- **réessayer** : si le post était déjà parti, il est publié deux fois, sous les yeux de votre audience ;
- **ne rien faire** : si le post n’était pas parti, il manque.

## La règle que nous avons choisie

Postbiz ne **rejoue jamais automatiquement** une publication dont l’issue est incertaine. Le post passe à l’état **Résultat inconnu**, avec un message qui dit ce qui s’est passé, et c’est vous qui décidez après avoir regardé sur le réseau.

Pourquoi ce choix ? Parce que les deux erreurs ne se valent pas. Un post qui arrive avec quelques minutes de retard se rattrape. Un doublon public ne se rattrape pas : même supprimé, il a été vu.

La même règle s’applique aux réponses que vous envoyez depuis la boîte de réception : un message dont l’envoi est interrompu est marqué en échec, jamais renvoyé sans que vous le sachiez.

## Les états d’un post

| État | Ce que ça veut dire |
|---|---|
| Brouillon | Pas encore programmé |
| Programmée | En attente de son heure |
| En cours | Le moteur est en train de l’envoyer |
| Publiée | Le réseau a confirmé |
| Erreur | Le réseau a refusé ; le message explique pourquoi |
| Résultat inconnu | L’issue est incertaine : à vérifier sur le réseau |

## Ce que ça change pour vous

- Une notification (« Vérifiez votre publication ») vous prévient quand l’issue est incertaine.
- Vous ouvrez le réseau et vous regardez si le post y est. S’il y est, vous supprimez l’entrée du calendrier ; s’il n’y est pas, vous planifiez de nouveau le post.
- Rien n’est rejoué dans votre dos.

> [!NOTE]
> Les canaux de Postbiz sont en bêta. Ce comportement est volontaire et fait partie de la conception du moteur d’envoi, mais l’état de chaque réseau est détaillé sur [la page Canaux](/canaux).
