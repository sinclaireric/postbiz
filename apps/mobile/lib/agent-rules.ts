// Les règles que l'agent applique à une publication avant de l'enregistrer, les mêmes que celles du web (apps/web/src/lib/posts/logic.ts, `validatePost`) :
// longueur du texte selon le réseau, média exigé, date dans le futur, premier commentaire. Les règles des médias eux-mêmes (formats, nombre) viennent de
// `lib/media-rules.ts`, passées en argument (`mediaProblems`) : ce fichier-ci reste sans dépendance, donc testable avec Node seul.
import { countLength } from "./text-length.ts";

/** Plafond de caractères par réseau (approximatif : les réseaux comptent différemment liens et émojis) ; X compte pondéré, voir `countLength`. */
export const TEXT_LIMITS: Record<string, number> = {
  facebook: 63_206,
  instagram: 2_200,
  instagram_standalone: 2_200,
  x: 280,
  linkedin: 3_000,
  linkedin_page: 3_000,
  tiktok: 2_200,
  youtube: 5_000,
};

/** Réseaux où le worker publie un premier commentaire (sous la publication, juste après), et sa longueur maximale. */
export const FIRST_COMMENT_LIMITS: Record<string, number> = { facebook: 8_000, linkedin: 1_250, linkedin_page: 1_250, x: 280 };
export const supportsFirstComment = (network: string) => network in FIRST_COMMENT_LIMITS;

/** Réseaux qui refusent une publication sans image ni vidéo. */
const REQUIRES_MEDIA = ["instagram", "instagram_standalone", "tiktok", "youtube"];

/** Délai minimum entre maintenant et une publication programmée. */
export const MIN_LEAD_MS = 60_000;

export interface ProposalCheck {
  /** Identifiant du réseau côté base (`linkedin_page`, `instagram_standalone`…) ou côté application (`linkedin-page`) : les deux sont reconnus. */
  network: string;
  label: string;
  text: string;
  firstComment: string;
  mediaCount: number;
  /** Erreurs des médias eux-mêmes (`validateMedia`). */
  mediaProblems: string[];
  /** Brouillon : seule la longueur compte ; programmée : la date et les médias aussi. */
  mode: "draft" | "schedule";
  publishAt: Date | null;
  now?: Date;
}

// Écritures de l'application mobile (`ChannelNetwork`) → identifiants de la base.
const ALIAS: Record<string, string> = { "instagram-business": "instagram", "linkedin-page": "linkedin_page" };
const base = (network: string) => ALIAS[network] ?? network;

/** Ce qui empêche d'enregistrer la publication, en français (liste vide : tout est en règle). Même verdict que `validatePost` du web, qui ne demande un texte ou un média que pour programmer. */
export function proposalProblems(c: ProposalCheck): string[] {
  const out: string[] = [];
  const network = base(c.network);
  const now = c.now ?? new Date();
  const text = c.text.trim();

  const max = TEXT_LIMITS[network];
  if (max !== undefined) {
    const length = countLength(network, text);
    if (length > max) out.push(`${c.label} : ${length.toLocaleString("fr-FR")} / ${max.toLocaleString("fr-FR")} caractères.`);
  }

  if (c.mode === "schedule") {
    if (!text && c.mediaCount === 0) out.push("Écrivez un texte ou ajoutez un média.");
    if (!c.publishAt || Number.isNaN(c.publishAt.getTime())) out.push("Choisissez une date et une heure de publication.");
    else if (c.publishAt.getTime() < now.getTime() + MIN_LEAD_MS) out.push("La date de publication doit être dans le futur.");
    if (REQUIRES_MEDIA.includes(network) && c.mediaCount === 0) out.push(`${c.label} exige une image ou une vidéo.`);
    out.push(...c.mediaProblems);
  }

  const comment = c.firstComment.trim();
  if (comment) {
    if (!supportsFirstComment(network)) out.push(`${c.label} ne publie pas de premier commentaire : retirez-le.`);
    else {
      const length = countLength(network, comment);
      const limit = FIRST_COMMENT_LIMITS[network]!;
      if (length > limit) out.push(`${c.label} : premier commentaire de ${length.toLocaleString("fr-FR")} / ${limit.toLocaleString("fr-FR")} caractères.`);
    }
  }
  return [...new Set(out)];
}

/** Heures (locales) auxquelles l'application propose de publier : matin, midi, fin de journée (comme le web, `lib/posts/slots.ts`). */
export const SLOT_HOURS = [9, 12, 18] as const;
/** Un créneau doit être au moins à cette distance : la base refuse une publication trop proche (`MIN_LEAD_MS`) et il faut le temps de relire. */
const LEAD_MS = 30 * 60_000;

/** Prochain créneau libre : le premier de la journée assez éloigné, sinon le premier du lendemain. */
export function nextSlot(now: Date): Date {
  for (const hour of SLOT_HOURS) {
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0);
    if (slot.getTime() >= now.getTime() + LEAD_MS) return slot;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, SLOT_HOURS[0], 0);
}
