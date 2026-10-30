import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanSupportBody, mergeSupportMessages, parseSupportMessage, supportErrorCode, supportRouteFor, validateSupportBody, SUPPORT_USER_MAX } from "./support-logic.ts";

test("cleanSupportBody donne le résultat de la base sur l’exemple du test PGlite", () => {
  assert.equal(cleanSupportBody("  Bonjour\r\n\r\n\r\n\r\nvoici‮ txt.exe⁦ \u0007et\u001B fin  "), "Bonjour\n\nvoici txt.exe et fin");
});

test("cleanSupportBody garde le HTML, les liens, les emojis et l’arabe tels quels", () => {
  const text = "<script>alert(1)</script> https://exemple.test/?a=1&b=2 😀 مرحبا";
  assert.equal(cleanSupportBody(text), text);
});

test("validateSupportBody refuse le vide et plus de 2 000 caractères (comptés par point de code)", () => {
  assert.equal(validateSupportBody(""), "invalid_message");
  assert.equal(validateSupportBody("x".repeat(SUPPORT_USER_MAX)), null);
  assert.equal(validateSupportBody("x".repeat(SUPPORT_USER_MAX + 1)), "message_too_long");
  assert.equal(validateSupportBody("😀".repeat(SUPPORT_USER_MAX)), null);
});

test("supportErrorCode reconnaît les erreurs de la base et ramène le reste à « failed »", () => {
  assert.equal(supportErrorCode({ message: "rate_limited" }), "rate_limited");
  assert.equal(supportErrorCode({ message: "too_many_unanswered" }), "too_many_unanswered");
  assert.equal(supportErrorCode({ message: "account suspended" }), "failed");
  assert.equal(supportErrorCode(null), "failed");
});

test("parseSupportMessage ignore une ligne sans identifiant ou sans texte, et prend « user » pour un auteur inconnu", () => {
  assert.deepEqual(parseSupportMessage({ id: "a", author: "support", body: "Salut", created_at: "2026-11-04T10:00:00Z" }), { id: "a", author: "support", body: "Salut", createdAt: "2026-11-04T10:00:00Z" });
  assert.equal(parseSupportMessage({ body: "x" }), null);
  assert.equal(parseSupportMessage(null), null);
  assert.equal(parseSupportMessage({ id: "a", author: "?", body: "x" })?.author, "user");
});

test("mergeSupportMessages ordonne par date puis identifiant, sans doublon", () => {
  const m = (id: string, createdAt: string) => ({ id, author: "user" as const, body: id, createdAt });
  const merged = mergeSupportMessages([m("b", "2026-11-04T10:00:02Z"), m("a", "2026-11-04T10:00:01Z")], [m("b", "2026-11-04T10:00:02Z"), m("d", "2026-11-04T10:00:03Z"), m("c", "2026-11-04T10:00:03Z")]);
  assert.deepEqual(merged.map((x) => x.id), ["a", "b", "c", "d"]);
});

test("supportRouteFor mène une réponse du support au chat, et ignore les autres notifications", () => {
  assert.equal(supportRouteFor("support_reply", { screen: "support" }), "/support");
  assert.equal(supportRouteFor("x", { screen: "support" }), "/support");
  assert.equal(supportRouteFor("post_error", {}), null);
  assert.equal(supportRouteFor("support_message", { support_conversation_id: "abc" }), null);
});
