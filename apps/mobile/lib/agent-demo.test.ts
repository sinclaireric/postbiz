import assert from "node:assert/strict";
import { test } from "node:test";

import { demoReply, demoSubject, fitText } from "./agent-demo.ts";
import { countLength } from "./text-length.ts";

const now = new Date(2026, 9, 27, 10, 0);
let n = 0;
const id = () => `d${++n}`;
const channels = [
  { id: "fb", name: "Maison Lune", network: "facebook" },
  { id: "ig", name: "maison.lune", network: "instagram" },
  { id: "x", name: "X", network: "x" },
  { id: "li", name: "Camille", network: "linkedin-page" },
];

test("le sujet est le message sans le verbe d'ordre", () => {
  assert.equal(demoSubject("Annonce l’atelier ouvert samedi"), "Atelier ouvert samedi");
  assert.equal(demoSubject("Publie un post sur la collection d’automne"), "Collection d’automne");
  assert.equal(demoSubject("Write a post about our new bench"), "Our new bench");
  assert.equal(demoSubject("Atelier ouvert samedi"), "Atelier ouvert samedi");
});

test("le texte reste sous la limite du réseau, X compté pondéré", () => {
  const long = "Atelier ouvert samedi. ".repeat(30);
  const x = fitText("x", long);
  assert.ok(countLength("x", x) <= 280);
  assert.ok(x.endsWith("…"));
  assert.equal(fitText("facebook", "Court"), "Court");
});

test("une publication par canal utilisable, rien pour ceux qui exigent un média", () => {
  const r = demoReply("Annonce l’atelier ouvert samedi", channels, now, id);
  assert.deepEqual(r.proposals.map((p) => p.integrationId), ["fb", "x", "li"]);
  assert.deepEqual(r.proposals.map((p) => p.networkId), ["facebook", "x", "linkedin_page"]);
  assert.ok(r.proposals.every((p) => p.status === "pending" && p.publishAt === null && p.mediaIds.length === 0));
  assert.match(r.text, /Je n’ai rien préparé pour instagram/);
});

test("« demain » propose demain 9 h", () => {
  const r = demoReply("Annonce l’atelier demain", [channels[0]!], now, id);
  assert.equal(new Date(r.proposals[0]!.publishAt!).getTime(), new Date(2026, 9, 28, 9, 0).getTime());
});

test("consulter le calendrier, saluer, ne rien cocher : du texte, pas de publication", () => {
  assert.equal(demoReply("Qu’est-ce qui est prévu cette semaine ?", channels, now, id).proposals.length, 0);
  assert.equal(demoReply("Salut", channels, now, id).proposals.length, 0);
  assert.match(demoReply("Annonce l’atelier ouvert samedi", [], now, id).text, /Cochez au moins un canal/);
});

test("une demande d'écriture qui parle de calendrier reste une demande d'écriture", () => {
  assert.ok(demoReply("Annonce l’atelier dans le calendrier", channels, now, id).proposals.length > 0);
});
