---
title: Why Postbiz never replays a publication whose outcome is uncertain
description: When a network doesn’t answer, there’s no way to know whether the post went out. Retrying risks publishing it twice. The rule we chose, and what you see on screen.
date: 2026-10-09
category: product
cover: lime
coverTitle: No blind retries
---

You schedule a post for 9 am. At the appointed time, Postbiz’s sending engine calls the network’s API. One of three things can happen: the network confirms, the network clearly refuses, or the network… doesn’t answer.

## The silent case

The first two are simple. A confirmation: the post is published. A clear refusal (missing permissions, text too long): it didn’t go out, we tell you so and let you fix it.

The third case is the trap: timeout, an error on the network’s server, a connection dropped mid-send. **The post may or may not be published.** An automated system has two reflexes:

- **retry**: if the post had already gone out, it’s published twice, in front of your audience;
- **do nothing**: if it hadn’t gone out, it’s missing.

## The rule we chose

Postbiz **never automatically replays** a publication whose outcome is uncertain. The post moves to the **Unknown result** state, with a message explaining what happened, and you decide after checking on the network.

Why this choice? Because the two mistakes aren’t equal. A post that arrives a few minutes late can be made up for. A public duplicate can’t: even deleted, it was seen.

The same rule applies to replies you send from the inbox: a message whose sending was interrupted is marked as failed, never sent again without you knowing.

## Post states

| State | What it means |
|---|---|
| Draft | Not scheduled yet |
| Scheduled | Waiting for its time |
| In progress | The engine is sending it |
| Published | The network confirmed |
| Error | The network refused; the message says why |
| Unknown result | The outcome is uncertain: check on the network |

## What it changes for you

- A notification asks you to check your post when the outcome is uncertain.
- You open the network and check whether the post is there. If it is, you delete the calendar entry; if it isn’t, you schedule the post again.
- Nothing is replayed behind your back.

> [!NOTE]
> Postbiz channels are in beta. This behaviour is deliberate and part of how the sending engine is designed, but the status of each network is detailed on [the Channels page](/canaux).
