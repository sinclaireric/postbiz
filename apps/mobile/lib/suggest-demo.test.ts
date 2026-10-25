import assert from "node:assert/strict";
import { test } from "node:test";

import { demoSuggestion, type DemoConversation } from "./suggest-demo.ts";
import { parseSuggestResponse, type SuggestResult } from "./suggest-protocol.ts";

const NOW = new Date("2026-10-27T10:00:00Z");
const at = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const inbound = (body: string | null, min: number) => ({ direction: "in" as const, body, createdAt: at(min) });
const outbound = (body: string, min: number) => ({ direction: "out" as const, body, createdAt: at(min) });
const open = new Date(NOW.getTime() + 3 * 3_600_000).toISOString();
const dm = (messages: DemoConversation["messages"], over: Partial<DemoConversation> = {}): DemoConversation => ({ kind: "dm", contactName: "Léa Dupont", replyWindowExpiresAt: open, messages, ...over });
const comment = (messages: DemoConversation["messages"], contactName = "Julien R."): DemoConversation => ({ kind: "comment_thread", contactName, replyWindowExpiresAt: null, messages });

/** La suggestion d'un résultat qui doit être une réussite. */
function ok(result: SuggestResult) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.suggestion;
}

test("la fiche qui correspond à la question fonde le brouillon, et elle est citée", () => {
  const s = ok(demoSuggestion(dm([inbound("Bonjour !", 15), inbound("Vous faites des gâteaux sur commande ?", 12)]), NOW));
  assert.equal(s.reply, "Bonjour Léa, merci pour votre message ! Oui, nous préparons des gâteaux sur commande : prévenez-nous 48 h à l’avance, en boutique ou par message.");
  assert.deepEqual([s.grounded, s.needsHuman, s.sources, s.id], [true, false, ["Commandes"], ""]);

  const h = ok(demoSuggestion(dm([inbound("Vous êtes ouverts dimanche ?", 5)]), NOW));
  assert.match(h.reply, /de 6 h 30 à 13 h\.$/);
  assert.deepEqual([h.grounded, h.sources], [true, ["Horaires"]]);
});

test("rien dans la base ne répond : réponse d'attente, non fondée, sans source", () => {
  const s = ok(demoSuggestion(dm([inbound("Merci beaucoup, à samedi !", 600), outbound("Avec plaisir, à samedi !", 590)]), NOW));
  assert.equal(s.reply, "Bonjour Léa, merci pour votre message. Nous revenons vers vous très vite.");
  assert.deepEqual([s.grounded, s.needsHuman, s.sources], [false, false, []]);
});

test("un sujet sensible (allergène, remboursement) revient à une personne, avec une réponse d'attente neutre", () => {
  for (const text of ["Il est sans gluten ?", "Je suis cœliaque, il y a des traces ?", "Je veux un remboursement", "C'est une arnaque, je préviens la police"]) {
    const s = ok(demoSuggestion(comment([inbound(text, 30)]), NOW));
    assert.equal(s.needsHuman, true, text);
    assert.equal(s.grounded, false, text);
    assert.deepEqual(s.sources, [], text);
    assert.match(s.reply, /^Bonjour Julien, .*une personne de l’équipe revient vers vous très vite\.$/, text);
  }
  // Même quand la question touche aussi à une fiche : une personne passe d'abord.
  assert.equal(ok(demoSuggestion(dm([inbound("Vos gâteaux sont sans gluten ?", 5)]), NOW)).needsHuman, true);
});

test("un mot qui sonne sensible ne suffit pas : l'avocat d'un sandwich, la police d'écriture d'une étiquette", () => {
  for (const text of ["Vous faites un sandwich à l'avocat ?", "Quelle police d'écriture utilisez-vous sur vos étiquettes ?"]) assert.equal(ok(demoSuggestion(dm([inbound(text, 5)]), NOW)).needsHuman, false, text);
});

test("le message d'avant donne le contexte, mais pas les plus anciens", () => {
  assert.deepEqual(ok(demoSuggestion(dm([inbound("Vous êtes ouverts ?", 20), inbound("et le dimanche ?", 10)]), NOW)).sources, ["Horaires"]);
  const old = [inbound("Vous faites des gâteaux ?", 40), outbound("Oui, bien sûr", 35), inbound("Merci, à samedi", 10)];
  assert.deepEqual(ok(demoSuggestion(dm(old), NOW)).sources, []);
  // Le message d'avant peut être le nôtre : ce qu'il dit compte aussi (« sur commande » ramène la fiche des commandes).
  assert.deepEqual(ok(demoSuggestion(dm([inbound("Vous faites des gâteaux ?", 40), outbound("Oui, sur commande", 35), inbound("Merci, à samedi", 10)]), NOW)).sources, ["Commandes"]);
});

test("on répond au dernier message du client, même si l'équipe a écrit ensuite, et quel que soit l'ordre reçu", () => {
  const thread = [inbound("Vous êtes ouverts le dimanche ?", 60), outbound("Oui, de 6 h 30 à 13 h", 50)];
  assert.deepEqual(ok(demoSuggestion(dm(thread), NOW)).sources, ["Horaires"]);
  assert.deepEqual(ok(demoSuggestion(dm([...thread].reverse()), NOW)).sources, ["Horaires"]);
});

test("mêmes contrôles que la route : fenêtre dépassée, puis conversation sans message du client", () => {
  const expired = new Date(NOW.getTime() - 1).toISOString();
  assert.deepEqual(demoSuggestion(dm([inbound("Bonjour", 5)], { replyWindowExpiresAt: expired }), NOW), { ok: false, error: "window_closed" });
  assert.deepEqual(demoSuggestion(dm([inbound("Bonjour", 5)], { replyWindowExpiresAt: NOW.toISOString() }), NOW), { ok: false, error: "window_closed" });
  assert.deepEqual(demoSuggestion(dm([], { replyWindowExpiresAt: expired }), NOW), { ok: false, error: "window_closed" });
  assert.equal(demoSuggestion(dm([inbound("Bonjour", 5)], { replyWindowExpiresAt: null }), NOW).ok, true);

  for (const messages of [[], [outbound("Bonjour", 5)], [inbound(null, 5)], [inbound("   \n", 5)]]) assert.deepEqual(demoSuggestion(dm(messages), NOW), { ok: false, error: "invalid" });
});

test("le prénom : le premier mot du nom, et pas d'espace en trop quand il est inconnu", () => {
  const ask = [inbound("Vous êtes ouverts ?", 5)];
  assert.match(ok(demoSuggestion(comment(ask, "Karim B."), NOW)).reply, /^Bonjour Karim, merci/);
  assert.match(ok(demoSuggestion(comment(ask, "  Zoé  "), NOW)).reply, /^Bonjour Zoé, merci/);
  assert.match(ok(demoSuggestion(comment(ask, ""), NOW)).reply, /^Bonjour, merci/);
  assert.match(ok(demoSuggestion(comment([inbound("Il est sans gluten ?", 5)], ""), NOW)).reply, /^Bonjour, merci/);
});

test("un commentaire public reste sous 300 signes, un message privé sous 800 (limites de la suggestion du web)", () => {
  const questions = ["Vous faites des gâteaux ?", "Vous êtes ouverts ?", "Merci !", "Il est sans gluten ?"];
  for (const text of questions) {
    assert.ok(ok(demoSuggestion(comment([inbound(text, 5)]), NOW)).reply.length <= 300, text);
    assert.ok(ok(demoSuggestion(dm([inbound(text, 5)]), NOW)).reply.length <= 800, text);
  }
});

test("la suggestion simulée a la forme de la réponse de la route", () => {
  for (const text of ["Vous faites des gâteaux ?", "Merci !", "Il est sans gluten ?"]) {
    const result = demoSuggestion(dm([inbound(text, 5)]), NOW);
    assert.deepEqual(parseSuggestResponse(200, { suggestion: ok(result) }), result, text);
  }
});

test("aucune requête ne part", () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("réseau appelé en démonstration");
  }) as typeof fetch;
  try {
    assert.equal(demoSuggestion(dm([inbound("Vous faites des gâteaux ?", 5)]), NOW).ok, true);
  } finally {
    globalThis.fetch = real;
  }
});
