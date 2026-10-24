import assert from "node:assert/strict";
import { test } from "node:test";

import { nextSlot, proposalProblems, type ProposalCheck } from "./agent-rules.ts";

const now = new Date("2026-10-27T10:00:00Z");
const base = (over: Partial<ProposalCheck> = {}): ProposalCheck => ({
  network: "facebook", label: "Facebook", text: "Atelier ouvert samedi", firstComment: "", mediaCount: 0, mediaProblems: [], mode: "schedule", publishAt: new Date("2026-10-28T08:00:00Z"), now, ...over,
});

test("une publication en règle n'a aucun problème", () => {
  assert.deepEqual(proposalProblems(base()), []);
  assert.deepEqual(proposalProblems(base({ network: "instagram", label: "Instagram", mediaCount: 1 })), []);
});

test("X compte pondéré : 280 passent, 281 non", () => {
  assert.deepEqual(proposalProblems(base({ network: "x", label: "X", text: "a".repeat(280) })), []);
  assert.deepEqual(proposalProblems(base({ network: "x", label: "X", text: "a".repeat(281) })), ["X : 281 / 280 caractères."]);
  // Un émoji pèse 2 sur X : 140 émojis = 280, 141 = 282.
  assert.deepEqual(proposalProblems(base({ network: "x", label: "X", text: "🎉".repeat(140) })), []);
  assert.equal(proposalProblems(base({ network: "x", label: "X", text: "🎉".repeat(141) })).length, 1);
});

test("un brouillon n'exige ni date ni média, mais respecte la longueur", () => {
  assert.deepEqual(proposalProblems(base({ mode: "draft", publishAt: null, network: "instagram", label: "Instagram" })), []);
  assert.equal(proposalProblems(base({ mode: "draft", publishAt: null, network: "x", label: "X", text: "a".repeat(300) })).length, 1);
});

test("programmer exige une date dans le futur", () => {
  assert.deepEqual(proposalProblems(base({ publishAt: null })), ["Choisissez une date et une heure de publication."]);
  assert.deepEqual(proposalProblems(base({ publishAt: new Date("2026-10-27T09:00:00Z") })), ["La date de publication doit être dans le futur."]);
  assert.deepEqual(proposalProblems(base({ publishAt: new Date("2026-10-27T10:00:30Z") })), ["La date de publication doit être dans le futur."]);
  assert.deepEqual(proposalProblems(base({ publishAt: new Date("2026-10-27T10:02:00Z") })), []);
});

test("Instagram, TikTok et YouTube exigent un média pour être programmés, quelle que soit l'écriture du réseau", () => {
  for (const network of ["instagram", "instagram-business", "instagram_standalone", "tiktok", "youtube"]) {
    assert.deepEqual(proposalProblems(base({ network, label: "Réseau" })), ["Réseau exige une image ou une vidéo."], network);
  }
});

test("les problèmes des médias eux-mêmes sont repris, une seule fois", () => {
  const p = ["Instagram : « a.jpg » n'a pas un format accepté."];
  assert.deepEqual(proposalProblems(base({ network: "instagram", label: "Instagram", mediaCount: 1, mediaProblems: [...p, ...p] })), p);
});

test("premier commentaire : seulement Facebook, LinkedIn et X, avec leur limite", () => {
  assert.deepEqual(proposalProblems(base({ firstComment: "Adresse en commentaire" })), []);
  assert.deepEqual(proposalProblems(base({ network: "linkedin-page", label: "LinkedIn", firstComment: "a".repeat(1_250) })), []);
  assert.equal(proposalProblems(base({ network: "linkedin", label: "LinkedIn", firstComment: "a".repeat(1_251) })).length, 1);
  assert.deepEqual(proposalProblems(base({ network: "instagram", label: "Instagram", mediaCount: 1, firstComment: "salut" })), ["Instagram ne publie pas de premier commentaire : retirez-le."]);
});

test("programmer un texte vide sans média est refusé ; le brouillon vide ne l'est pas ici (la carte, elle, désactive le bouton)", () => {
  assert.deepEqual(proposalProblems(base({ text: "   " })), ["Écrivez un texte ou ajoutez un média."]);
  assert.deepEqual(proposalProblems(base({ text: "   ", mode: "draft", publishAt: null })), []);
});

test("le prochain créneau : 9 h, 12 h ou 18 h, au moins 30 minutes plus loin, sinon demain 9 h", () => {
  assert.deepEqual(nextSlot(new Date(2026, 9, 27, 7, 0)), new Date(2026, 9, 27, 9, 0));
  assert.deepEqual(nextSlot(new Date(2026, 9, 27, 8, 45)), new Date(2026, 9, 27, 12, 0)); // 9 h est à moins de 30 minutes
  assert.deepEqual(nextSlot(new Date(2026, 9, 27, 13, 0)), new Date(2026, 9, 27, 18, 0));
  assert.deepEqual(nextSlot(new Date(2026, 9, 27, 18, 0)), new Date(2026, 9, 28, 9, 0));
  assert.deepEqual(nextSlot(new Date(2026, 9, 31, 23, 0)), new Date(2026, 10, 1, 9, 0));
});
