import assert from "node:assert/strict";
import { test } from "node:test";

import { createEventParser, parseEventLine, parseVideoJobResponse, sanitizeProposals, type AgentEvent } from "./agent-protocol.ts";

const thread = { id: "t1", title: "Bonjour", updatedAt: "2026-10-27T10:00:00Z" };
const msg = (role: "user" | "assistant", text: string) => ({ id: role, role, text, proposals: [], mediaIds: [], jobIds: [], createdAt: "2026-10-27T10:00:00Z" });
const events: AgentEvent[] = [
  { type: "text", delta: "Bonjour\nà tous" },
  { type: "tool", name: "list_media" },
  { type: "tool", name: "generate_image" },
  { type: "tool", name: "generate_video" },
  { type: "tool", name: "video_status" },
  { type: "media", media: [{ id: "g1", kind: "image", name: "ai-image-phare.jpg", alt: "", url: null, thumbUrl: null, durationSeconds: null }] },
  { type: "job", job: { id: "j1", status: "pending", orientation: "vertical", prompt: "Un phare", mediaId: null, error: null, createdAt: "2026-10-27T10:00:00Z" } },
  { type: "done", thread, user: msg("user", "Salut"), assistant: msg("assistant", "Oui") },
  { type: "error", code: "failed" },
];
const wire = events.map((e) => `${JSON.stringify(e)}\n`).join("");

test("un événement par ligne, y compris quand le texte contient un retour à la ligne", () => {
  assert.equal(wire.trimEnd().split("\n").length, events.length);
  const p = createEventParser();
  assert.deepEqual([...p.push(wire), ...p.flush()], events);
});

test("recolle une ligne coupée en deux morceaux, à n'importe quel endroit", () => {
  for (let cut = 1; cut < wire.length; cut += 7) {
    const p = createEventParser();
    assert.deepEqual([...p.push(wire.slice(0, cut)), ...p.push(wire.slice(cut)), ...p.flush()], events);
  }
});

test("ignore une ligne abîmée ou étrangère sans arrêter la lecture", () => {
  const p = createEventParser();
  const out = [...p.push(`pas du json\n{"type":"inconnu"}\n[1]\nnull\n${JSON.stringify(events[1])}`), ...p.flush()];
  assert.deepEqual(out, [events[1]]);
  assert.equal(parseEventLine(""), null);
});

test("lit la dernière ligne même sans retour à la ligne final", () => {
  const p = createEventParser();
  assert.deepEqual([...p.push(JSON.stringify(events[3])), ...p.flush()], [events[3]]);
});

const good = { id: "p1", integrationId: "fb", networkId: "facebook", accountName: "Maison Lune", text: "Bonjour", firstComment: null, mediaIds: ["m1"], publishAt: "2026-10-28T08:00:00.000Z", status: "draft" };

test("sanitizeProposals garde une publication bien formée telle quelle", () => {
  assert.deepEqual(sanitizeProposals([good]), [good]);
});

test("sanitizeProposals écarte ce qui n'est pas exploitable, sans rien casser", () => {
  assert.deepEqual(sanitizeProposals("non"), []);
  const bad = [null, "x", { ...good, id: 3 }, { ...good, networkId: "myspace" }, { ...good, status: "published" }, { ...good, text: "a".repeat(20_001) }, good];
  assert.deepEqual(sanitizeProposals(bad), [good]);
});

test("sanitizeProposals corrige les champs facultatifs abîmés au lieu d'écarter la publication", () => {
  const [p] = sanitizeProposals([{ ...good, publishAt: "demain", mediaIds: ["m1", 4, null], firstComment: 7 }]);
  assert.equal(p?.publishAt, null);
  assert.deepEqual(p?.mediaIds, ["m1"]);
  assert.equal(p?.firstComment, null);
});

const job = { id: "j1", status: "pending", orientation: "vertical", prompt: "x", mediaId: null, error: null, createdAt: "2026-10-27T10:00:00Z" };
const video = { id: "m1", kind: "video", name: "v.mp4", alt: "", url: null, thumbUrl: null, durationSeconds: 8 };

test("parseVideoJobResponse relit une réponse correcte", () => {
  assert.deepEqual(parseVideoJobResponse({ job, media: null, url: null }), { job, media: null, url: null });
  const done = { ...job, status: "completed", mediaId: "m1" };
  assert.deepEqual(parseVideoJobResponse({ job: done, media: video, url: "https://cdn/x" }), { job: done, media: video, url: "https://cdn/x" });
});

test("parseVideoJobResponse écarte une réponse abîmée ou étrangère (page d'erreur, erreur JSON)", () => {
  const bad = [null, "x", {}, { error: "not_found" }, { job: { ...job, status: "zzz" }, media: null, url: null }, { job: { ...job, orientation: "carre" }, media: null, url: null },
    { job, media: "x", url: null }, { job, media: null, url: 3 }, { job: { ...job, mediaId: 4 }, media: null, url: null }, { job: { ...job, id: 7 }, media: null, url: null }];
  for (const raw of bad) assert.equal(parseVideoJobResponse(raw), null, JSON.stringify(raw));
});
