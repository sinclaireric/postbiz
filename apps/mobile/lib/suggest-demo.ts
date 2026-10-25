// La suggestion du mode démo (EXPO_PUBLIC_DEMO=1) : aucune IA n'est appelée et aucune requête ne part. Le brouillon est construit avec les mots du client et une mini base de
// connaissance d'exemple, celle de la Boulangerie Martin des données de démo (lib/demo-seed.ts). Même idée que la suggestion de démonstration du web
// (apps/web/src/lib/inbox/suggest.ts), en plus court, avec les mêmes contrôles que la route : fenêtre de réponse dépassée, conversation sans message du client.
import { replyWindow } from "./inbox/logic.ts";
import type { SuggestResult } from "./suggest-protocol.ts";

export interface DemoConversation {
  kind: "dm" | "comment_thread";
  contactName: string;
  replyWindowExpiresAt: string | null;
  messages: { direction: "in" | "out"; body: string | null; createdAt: string }[];
}

/** Les fiches d'exemple : de quoi répondre à deux questions. Rien d'autre n'est « dans la base » (la suggestion le dit alors). */
const FACTS: { title: string; when: RegExp; answer: string }[] = [
  { title: "Commandes", when: /\b(g[âa]teaux?|commandes?|commander|anniversaire|pi[èe]ces? mont[ée]es?)\b/i, answer: "Oui, nous préparons des gâteaux sur commande : prévenez-nous 48 h à l’avance, en boutique ou par message." },
  { title: "Horaires", when: /\b(horaires?|ouverts?|ouvre|ouvrez|ferm[ée]s?|fermez)\b/i, answer: "Nous sommes ouverts le samedi et le dimanche, de 6 h 30 à 13 h." },
];

/** Les sujets qu'une personne doit traiter (comme les règles de l'IA du serveur) : allergènes et santé, remboursements et réclamations, menaces, presse. */
const SENSITIVE = /\b(gluten|allerg\w*|c(?:œ|oe|é|e)liaque|lactose|arachides?|intoxication|malade|rembours\w*|r[ée]clamation|plainte|arnaque|journaliste)\b/i;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const hello = (name: string) => (name ? `Bonjour ${name}` : "Bonjour");

export function demoSuggestion(c: DemoConversation, now: Date = new Date()): SuggestResult {
  if (replyWindow(c.replyWindowExpiresAt, now).state === "expired") return { ok: false, error: "window_closed" };

  // Comme le serveur : les messages qui ont du texte, du plus ancien au plus récent ; on répond au dernier du client, avec le message d'avant pour le contexte.
  const turns = [...c.messages]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((m) => (m.body?.trim() ? [{ customer: m.direction === "in", text: m.body.trim() }] : []));
  const last = turns.map((t) => t.customer).lastIndexOf(true);
  if (last < 0) return { ok: false, error: "invalid" };
  const question = [turns[last - 1]?.text, turns[last]!.text].filter(Boolean).join(" ");
  const name = firstName(c.contactName);

  if (SENSITIVE.test(question)) {
    const reply = `${hello(name)}, merci pour votre question. Nous préférons vous répondre avec certitude : une personne de l’équipe revient vers vous très vite.`;
    return { ok: true, suggestion: { id: "", reply, grounded: false, needsHuman: true, sources: [] } };
  }
  const fact = FACTS.find((f) => f.when.test(question));
  if (fact) return { ok: true, suggestion: { id: "", reply: `${hello(name)}, merci pour votre message ! ${fact.answer}`, grounded: true, needsHuman: false, sources: [fact.title] } };
  return { ok: true, suggestion: { id: "", reply: `${hello(name)}, merci pour votre message. Nous revenons vers vous très vite.`, grounded: false, needsHuman: false, sources: [] } };
}
