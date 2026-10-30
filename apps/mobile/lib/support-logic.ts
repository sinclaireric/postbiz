// Chat de support : règles partagées avec le web (apps/web/src/lib/support/logic.ts) et avec la base (migration …_support_chat.sql, qui reste l'autorité).
// Miroir tenu à la main : apps/web/src/lib/support/mobile-logic.test.ts fait tourner les deux versions sur les mêmes entrées.

export const SUPPORT_USER_MAX = 2000;
export const SUPPORT_THREAD_LIMIT = 200;

export type SupportAuthor = "user" | "support";
export type SupportStatus = "open" | "resolved";
export type SupportErrorCode = "invalid_message" | "message_too_long" | "rate_limited" | "too_many_unanswered" | "failed";

export type SupportMessage = { id: string; author: SupportAuthor; body: string; createdAt: string };

/**
 * Le texte tel que la base le garde (`support_clean_body`) : fins de ligne unifiées, caractères de contrôle et marques de direction (U+202A–202E, U+2066–2069)
 * retirés, trois sauts de ligne ou plus ramenés à deux, blancs de bord retirés.
 */
export function cleanSupportBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \n\t]+|[ \n\t]+$/g, "");
}

/** Faute du texte déjà nettoyé (vide, ou plus de 2 000 caractères comptés par point de code, comme la base), ou null. */
export function validateSupportBody(clean: string): SupportErrorCode | null {
  if (clean.length === 0) return "invalid_message";
  return [...clean].length > SUPPORT_USER_MAX ? "message_too_long" : null;
}

const CODES: SupportErrorCode[] = ["invalid_message", "message_too_long", "rate_limited", "too_many_unanswered"];

/** Code d'une erreur de la base : `support_send` lève `rate_limited`, `message_too_long`… ; le reste (réseau, droits, compte suspendu) est `failed`. */
export function supportErrorCode(error: { message?: string } | null | undefined): SupportErrorCode {
  const message = error?.message ?? "";
  return CODES.find((c) => message.includes(c)) ?? "failed";
}

export const SUPPORT_ERROR_TEXT: Record<SupportErrorCode, string> = {
  invalid_message: "Écrivez un message avant d’envoyer.",
  message_too_long: `Votre message est trop long (${SUPPORT_USER_MAX} caractères au plus).`,
  rate_limited: "Vous écrivez trop vite. Patientez une minute avant d’envoyer un autre message.",
  too_many_unanswered: "Vous avez déjà envoyé beaucoup de messages sans réponse. Nous les lisons : merci de patienter avant d’en envoyer d’autres.",
  failed: "Le message n’a pas pu être envoyé. Vérifiez votre connexion et réessayez.",
};

/** Ligne de `support_messages` ; null sans identifiant ni texte. */
export function parseSupportMessage(raw: unknown): SupportMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.body !== "string") return null;
  return { id: r.id, author: r.author === "support" ? "support" : "user", body: r.body, createdAt: typeof r.created_at === "string" ? r.created_at : "" };
}

/** Fusionne sans doublon (par identifiant), du plus ancien au plus récent. */
export function mergeSupportMessages(current: readonly SupportMessage[], incoming: readonly SupportMessage[]): SupportMessage[] {
  const byId = new Map<string, SupportMessage>();
  for (const m of [...current, ...incoming]) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** L'écran à ouvrir pour une notification du chat (réponse du support), ou null pour les autres. */
export function supportRouteFor(type: unknown, data?: Record<string, unknown>): string | null {
  return type === "support_reply" || data?.screen === "support" ? "/support" : null;
}
