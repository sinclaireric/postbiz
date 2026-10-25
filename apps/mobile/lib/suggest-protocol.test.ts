import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSuggestResponse, postSuggest, recordOutcome, replyOutcome, sameReply, SUGGEST_ERROR_CODES, type SuggestOutcome } from "./suggest-protocol.ts";

const suggestion = { id: "9f0c2a56-3b6e-4f5e-9d63-0a1b2c3d4e5f", reply: "Bonjour Léa, nous livrons en Belgique sous 5 à 7 jours ouvrés.", grounded: true, needsHuman: false, sources: ["Questions fréquentes"] };
const failed = { ok: false, error: "failed" };

test("parseSuggestResponse garde une suggestion bien formée telle quelle", () => {
  assert.deepEqual(parseSuggestResponse(200, { suggestion }), { ok: true, suggestion });
});

test("parseSuggestResponse accepte un brouillon vide quand une personne doit s'en charger", () => {
  const held = { ...suggestion, reply: "", grounded: false, needsHuman: true, sources: [] };
  assert.deepEqual(parseSuggestResponse(200, { suggestion: held }), { ok: true, suggestion: held });
});

test("parseSuggestResponse ne garde des sources que les titres utilisables : douze au plus, de 200 signes au plus", () => {
  const titles = Array.from({ length: 20 }, (_, i) => `Fiche ${i}`);
  const r = parseSuggestResponse(200, { suggestion: { ...suggestion, sources: ["", "  ", 3, null, "A".repeat(300), ...titles] } });
  assert.ok(r.ok);
  assert.equal(r.suggestion.sources.length, 12);
  assert.equal(r.suggestion.sources[0], "A".repeat(200));
  assert.deepEqual(r.suggestion.sources.slice(1), titles.slice(0, 11));
  assert.deepEqual((parseSuggestResponse(200, { suggestion: { ...suggestion, sources: "Questions fréquentes" } }) as { suggestion: { sources: string[] } }).suggestion.sources, []);
});

test("parseSuggestResponse n'accorde d'identifiant qu'à une suggestion gardée : sinon elle s'affiche, mais son issue ne sera pas notée", () => {
  for (const id of ["", "a b", "x".repeat(65), "../etc/passwd", "id;drop"]) {
    const r = parseSuggestResponse(200, { suggestion: { ...suggestion, id } });
    assert.ok(r.ok, id);
    assert.equal(r.suggestion.id, "", id);
    assert.equal(r.suggestion.reply, suggestion.reply);
  }
  // Les identifiants de la base (uuid) et ceux de la démonstration du web passent.
  for (const id of [suggestion.id, "sg-12"]) assert.equal((parseSuggestResponse(200, { suggestion: { ...suggestion, id } }) as { suggestion: { id: string } }).suggestion.id, id);
});

test("parseSuggestResponse écarte une réponse abîmée ou étrangère (page d'erreur, JSON inattendu) sans lever d'exception", () => {
  const bad: unknown[] = [
    null, undefined, "<html>502 Bad Gateway</html>", 3, [], [suggestion], {}, { suggestion: null }, { suggestion: [] }, { suggestion: "x" },
    { suggestion: { ...suggestion, id: 3 } }, { suggestion: { ...suggestion, reply: null } }, { suggestion: { ...suggestion, reply: "a".repeat(5_001) } },
    { suggestion: { ...suggestion, grounded: "oui" } }, { suggestion: { ...suggestion, needsHuman: 0 } }, { suggestion: { id: "x", reply: "Bonjour" } },
  ];
  for (const raw of bad) assert.deepEqual(parseSuggestResponse(200, raw), failed, JSON.stringify(raw));
});

test("parseSuggestResponse ne prend une suggestion qu'avec un statut de réussite", () => {
  for (const status of [199, 301, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) assert.deepEqual(parseSuggestResponse(status, { suggestion }), failed, String(status));
  assert.deepEqual(parseSuggestResponse(429, { suggestion, error: "rate_limited" }), { ok: false, error: "rate_limited" });
  assert.equal(parseSuggestResponse(204, { suggestion }).ok, true);
});

// Les codes et statuts de apps/web/src/app/api/inbox/suggest/route.ts (STATUS ; 401 quand il n'y a pas de session).
const ROUTE: [number, string][] = [[503, "disabled"], [403, "forbidden"], [401, "forbidden"], [400, "invalid"], [429, "rate_limited"], [422, "refused"], [502, "failed"], [404, "not_found"], [409, "window_closed"]];

test("parseSuggestResponse rend le code d'erreur de la route, pour chaque statut qu'elle emploie", () => {
  for (const [status, error] of ROUTE) assert.deepEqual(parseSuggestResponse(status, { error }), { ok: false, error }, `${status} ${error}`);
  assert.deepEqual([...new Set(ROUTE.map(([, code]) => code))].sort(), [...SUGGEST_ERROR_CODES].sort());
});

test("parseSuggestResponse : un code inconnu ou absent devient « failed », quel que soit le statut", () => {
  for (const status of [429, 500, 502, 503]) {
    for (const raw of [{}, { error: "boom" }, { error: 429 }, { error: null }, { error: ["rate_limited"] }, "Too Many Requests", null]) assert.deepEqual(parseSuggestResponse(status, raw), failed, `${status} ${JSON.stringify(raw)}`);
  }
});

test("sameReply : seuls les espaces comptent, comme sur le web", () => {
  const same: [string, string][] = [
    ["Bonjour Léa !", "Bonjour Léa !"], ["Bonjour Léa !", "  Bonjour   Léa !\n"], ["Bonjour\nLéa", "Bonjour Léa"], ["Bonjour\r\n\r\nLéa", "Bonjour Léa"],
    ["Bonjour\tLéa", "Bonjour Léa"], ["Bonjour Léa", "Bonjour Léa"], ["", "   "],
  ];
  for (const [a, b] of same) {
    assert.equal(sameReply(a, b), true, JSON.stringify([a, b]));
    assert.equal(sameReply(b, a), true, JSON.stringify([b, a]));
  }
  const different: [string, string][] = [["Bonjour Léa !", "bonjour Léa !"], ["Bonjour Léa !", "Bonjour Léa."], ["Bonjour Léa", "BonjourLéa"], ["Bonjour Léa", "Bonjour Léa, merci"], ["Bonjour", ""]];
  for (const [a, b] of different) {
    assert.equal(sameReply(a, b), false, JSON.stringify([a, b]));
    assert.equal(sameReply(b, a), false, JSON.stringify([b, a]));
  }
});

test("replyOutcome : « sent » si la réponse part telle quelle (aux espaces près), « edited » sinon", () => {
  assert.equal(replyOutcome(suggestion.reply, suggestion.reply), "sent");
  assert.equal(replyOutcome(suggestion.reply, `  ${suggestion.reply.replace(/ /g, "  ")}\n`), "sent");
  assert.equal(replyOutcome(suggestion.reply, `${suggestion.reply} Merci !`), "edited");
  assert.equal(replyOutcome(suggestion.reply, suggestion.reply.replace("Belgique", "France")), "edited");
  assert.equal(replyOutcome(suggestion.reply, "Je vous réponds demain."), "edited");
  assert.equal(replyOutcome(suggestion.reply, ""), "edited");
});

test("recordOutcome note l'issue sous l'identifiant de la suggestion", async () => {
  const saved: [string, SuggestOutcome][] = [];
  const save = async (id: string, outcome: SuggestOutcome) => {
    saved.push([id, outcome]);
  };
  await recordOutcome(save, suggestion, suggestion.reply);
  await recordOutcome(save, suggestion, `${suggestion.reply} Merci !`);
  assert.deepEqual(saved, [[suggestion.id, "sent"], [suggestion.id, "edited"]]);
});

test("recordOutcome ne note rien pour une suggestion qui n'a pas été gardée en base", async () => {
  let calls = 0;
  await recordOutcome(async () => void calls++, { id: "", reply: suggestion.reply }, suggestion.reply);
  assert.equal(calls, 0);
});

test("recordOutcome ne lève jamais : un échec de la mesure ne gêne pas l'envoi", async () => {
  await recordOutcome(async () => { throw new Error("RLS"); }, suggestion, "Bonjour");
  await recordOutcome(() => { throw new Error("synchrone"); }, suggestion, "Bonjour");
  await recordOutcome(() => Promise.reject(new Error("réseau")), suggestion, "Bonjour");
  // supabase-js ne lève pas : il rend { error }, que l'on ignore.
  await recordOutcome(async () => ({ error: { message: "permission denied for table ai_reply_suggestions" } }), suggestion, "Bonjour");
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** Un `fetch` qui n'aboutit jamais : il ne se termine que si la demande est abandonnée (comme le vrai, qui rejette alors la promesse). */
const hang: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (init?.signal?.aborted) return abort();
    init?.signal?.addEventListener("abort", abort, { once: true });
  });

test("postSuggest envoie l'identifiant de la conversation, avec le jeton de l'utilisateur, à la route du web", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return json(200, { suggestion });
  };
  assert.deepEqual(await postSuggest({ webUrl: "https://site.test", token: "jeton", conversationId: "c-1", fetch: fake }), { ok: true, suggestion });
  const [call] = calls;
  assert.equal(calls.length, 1);
  assert.ok(call);
  assert.equal(call.url, "https://site.test/api/inbox/suggest");
  assert.equal(call.init.method, "POST");
  assert.deepEqual(call.init.headers, { "Content-Type": "application/json", Authorization: "Bearer jeton" });
  assert.deepEqual(JSON.parse(String(call.init.body)), { conversationId: "c-1" });
});

test("postSuggest rend le code d'erreur de la route", async () => {
  for (const [status, error] of ROUTE) {
    const fake: typeof fetch = async () => json(status, { error });
    assert.deepEqual(await postSuggest({ webUrl: "https://site.test", token: "t", conversationId: "c", fetch: fake }), { ok: false, error }, `${status} ${error}`);
  }
});

test("postSuggest : une page d'erreur, un corps vide ou un réseau coupé donnent « failed »", async () => {
  const answers: (() => Promise<Response>)[] = [
    async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    async () => new Response("", { status: 200 }),
    async () => new Response(null, { status: 204 }),
    async () => { throw new TypeError("Network request failed"); },
  ];
  for (const answer of answers) assert.deepEqual(await postSuggest({ webUrl: "https://site.test", token: "t", conversationId: "c", fetch: answer }), failed);
});

test("postSuggest abandonne la demande au bout du délai", async () => {
  let seen: AbortSignal | null | undefined;
  const spy: typeof fetch = (url, init) => {
    seen = init?.signal;
    return hang(url, init);
  };
  assert.deepEqual(await postSuggest({ webUrl: "https://site.test", token: "t", conversationId: "c", fetch: spy, timeoutMs: 20 }), failed);
  assert.equal(seen?.aborted, true);
});

test("postSuggest abandonne la demande quand l'écran est quitté, avant comme pendant l'attente", async () => {
  const during = new AbortController();
  const pending = postSuggest({ webUrl: "https://site.test", token: "t", conversationId: "c", fetch: hang, signal: during.signal, timeoutMs: 60_000 });
  during.abort();
  assert.deepEqual(await pending, failed);

  const before = new AbortController();
  before.abort();
  assert.deepEqual(await postSuggest({ webUrl: "https://site.test", token: "t", conversationId: "c", fetch: hang, signal: before.signal, timeoutMs: 60_000 }), failed);
});
