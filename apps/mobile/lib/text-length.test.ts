import assert from "node:assert/strict";
import { test } from "node:test";

import { countLength, xWeightedLength } from "./text-length.ts";

test("les réseaux autres que X comptent les caractères", () => {
  assert.equal(countLength("facebook", "Atelier ouvert samedi"), 21);
  assert.equal(countLength("linkedin", "𝗯onjour"), 7); // un caractère en gras Unicode vaut 1, pas 2
});

test("X compte pondéré : un émoji pèse 2, un lien 23", () => {
  assert.equal(countLength("x", "Bonjour"), 7);
  assert.equal(countLength("x", "Bonjour 🎉"), 7 + 1 + 2);
  assert.equal(xWeightedLength("Lisez ça : https://exemple.fr/un-tres-long-lien-vers-un-article?utm=1"), 11 + 23);
});

test("un texte de 280 caractères latins tient sur X, 281 non", () => {
  assert.ok(countLength("x", "a".repeat(280)) <= 280);
  assert.ok(countLength("x", "a".repeat(281)) > 280);
});
