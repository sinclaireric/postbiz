// L'agent du mode démo (EXPO_PUBLIC_DEMO=1) : aucune IA n'est appelée, la réponse est simulée et construite avec les mots de l'utilisateur (rien n'est inventé).
// Même idée que l'agent de démonstration du web (apps/web/src/lib/agent/demo.ts), en plus court : les publications passent par les mêmes règles à l'enregistrement.
import type { AgentProposal } from "./agent-protocol.ts";
import { TEXT_LIMITS } from "./agent-rules.ts";
import { countLength } from "./text-length.ts";

export interface DemoChannel {
  id: string;
  name: string;
  /** Écriture de l'application (`ChannelNetwork`). */
  network: string;
}

const LEADING = /^(annonce|annoncer|publie|publier|poste|poster|[ée]cris|r[ée]dige|pr[ée]pare|cr[ée]e|write|post|announce|publish|draft|create|prepare)\s+(?:(?:un|une|le|la|les|des|a|an|the)\s+|l['’])?(?:(?:post|publication|message)\s+)?(?:(?:sur|pour|[àa] propos de|au sujet de|about|on|for)\s+)?(?:(?:un|une|le|la|les|des|a|an|the)\s+|l['’])?/i;
const LIST_INTENT = /\b(pr[ée]vu|programm\w*|planifi\w*|planning|calendrier|venir|scheduled|upcoming|calendar)\b/i;
const WRITE_VERB = /\b(annonce\w*|publie\w*|poste\w*|[ée]cris|r[ée]dige\w*|pr[ée]pare\w*|cr[ée]e\w*|write|post|announce|publish|draft|create|prepare)\b/i;
const TOMORROW = /\b(demain|tomorrow)\b/i;
/** Une demande de génération d'image ou de vidéo : en démonstration, rien n'est généré (aucun fournisseur n'est appelé et la démo n'a pas de médiathèque). */
const GENERATE_INTENT = /\b(g[ée]n[èe]re\w*|cr[ée]e\w*|fais|fabrique\w*|dessine\w*|generate|create|make|draw)\b[^.!?]{0,60}\b(image|photo|visuel|illustration|vid[ée]o|clip|reel|picture|visual)s?\b/i;
/** Réseaux qui exigent une image ou une vidéo (la démo n'en a pas à joindre) ou sur lesquels l'application ne publie pas encore. */
const NEEDS_MEDIA = ["instagram", "instagram-business", "tiktok", "youtube"];

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Le sujet : le message sans le verbe d'ordre du début (« Annonce l'atelier de samedi » → « L'atelier de samedi »). */
export function demoSubject(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  const stripped = oneLine.replace(LEADING, "").trim();
  return capitalize(stripped || oneLine);
}

/** Le texte mis sous la limite du réseau : coupé avec « … » au besoin. */
export function fitText(network: string, text: string): string {
  const key = network === "linkedin-page" ? "linkedin_page" : network;
  const max = TEXT_LIMITS[key] ?? Infinity;
  if (countLength(key, text) <= max) return text;
  const chars = [...text].slice(0, Math.max(0, max - 2));
  while (chars.length > 0 && countLength(key, `${chars.join("")}…`) > max) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

export interface DemoReply {
  text: string;
  proposals: AgentProposal[];
}

export function demoReply(message: string, channels: DemoChannel[], now: Date, newId: () => string): DemoReply {
  if (LIST_INTENT.test(message) && !WRITE_VERB.test(message)) {
    return { text: "En démonstration, je ne consulte pas le calendrier. Demandez-moi plutôt de préparer une publication, par exemple « Annonce l’atelier ouvert samedi ».", proposals: [] };
  }
  if (GENERATE_INTENT.test(message) && !/\b(post|publication|publie\w*|poste\w*|annonce\w*)\b/i.test(message)) {
    return { text: "En démonstration, je ne génère ni image ni vidéo : aucun service n’est appelé. Avec le serveur Postbiz, je génère l’image (ou la vidéo, qui prend quelques minutes) et je la range dans votre médiathèque.", proposals: [] };
  }
  if (message.trim().length < 6) {
    return { text: "Je suis l’agent de démonstration. Décrivez une publication (par exemple « Annonce l’atelier ouvert samedi ») et je la prépare pour les canaux cochés.", proposals: [] };
  }
  if (channels.length === 0) return { text: "Cochez au moins un canal sur lequel je peux publier, puis décrivez à nouveau la publication.", proposals: [] };

  const subject = demoSubject(message);
  const tomorrow = TOMORROW.test(message) ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0).toISOString() : null;
  const usable = channels.filter((c) => !NEEDS_MEDIA.includes(c.network));
  const skipped = channels.filter((c) => NEEDS_MEDIA.includes(c.network));
  const proposals = usable.map((c): AgentProposal => ({
    id: newId(), integrationId: c.id, networkId: c.network === "linkedin-page" ? "linkedin_page" : c.network, accountName: c.name,
    text: fitText(c.network, subject), firstComment: null, mediaIds: [], publishAt: tomorrow, status: "pending",
  }));
  const names = [...new Set(skipped.map((c) => c.network))].join(", ");
  const note = skipped.length > 0 ? ` Je n’ai rien préparé pour ${names} : le réseau exige une image ou une vidéo, ou la publication n’y est pas encore disponible.` : "";
  if (proposals.length === 0) return { text: note.trim(), proposals: [] };
  return { text: `Voici ce que j’ai préparé pour vos canaux.${note}`, proposals };
}
