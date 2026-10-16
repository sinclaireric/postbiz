// Envoi de réponses via l'API Graph de Meta (Messenger, messages privés Instagram, commentaires).
//
// ⚠️ À valider avec de vrais comptes de test avant la revue Meta : chemins, versions et paramètres
// suivent la documentation Meta mais n'ont pas été exécutés contre l'API réelle.

export const DEFAULT_GRAPH_VERSION = 'v23.0';

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** La requête a été refusée par Meta (4xx) : rien n'a été envoyé, on peut réessayer à la main. */
export class MetaRejectedError extends Error {
  constructor(public status: number, public code: number | undefined, message: string, public needsReconnect = false) {
    super(message);
    this.name = 'MetaRejectedError';
  }
}

/** L'issue est inconnue (délai dépassé, 5xx, réseau coupé) : le message est peut-être parti. Ne jamais rejouer automatiquement. */
export class MetaOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaOutcomeUnknownError';
  }
}

export interface MetaClientOptions {
  accessToken: string;
  /** `graph.facebook.com` (connexion Facebook) ou `graph.instagram.com` (connexion Instagram). */
  host?: string;
  version?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

async function call(opts: MetaClientOptions, path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const url = `https://${opts.host ?? 'graph.facebook.com'}/${opts.version ?? DEFAULT_GRAPH_VERSION}/${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.accessToken}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new MetaOutcomeUnknownError(`Requête interrompue : ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* corps non JSON */
  }
  if (res.ok) return json;

  if (res.status >= 500) throw new MetaOutcomeUnknownError(`Meta a répondu ${res.status}`);
  const err = json.error ?? {};
  const code = typeof err.code === 'number' ? err.code : undefined;
  // 190 : jeton invalide ou expiré
  throw new MetaRejectedError(res.status, code, err.message ?? `Meta a répondu ${res.status}`, code === 190 || res.status === 401);
}

export interface SendDmInput {
  /** Compte qui envoie (Page ou compte pro). */
  senderId: string;
  recipientId: string;
  text: string;
  /** Hors fenêtre de 24 h : envoi avec le tag HUMAN_AGENT (nécessite l'approbation de Meta). */
  humanAgent?: boolean;
}

export async function sendDirectMessage(opts: MetaClientOptions, input: SendDmInput): Promise<{ messageId: string }> {
  const json = await call(opts, `${input.senderId}/messages`, {
    recipient: { id: input.recipientId },
    ...(input.humanAgent ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : { messaging_type: 'RESPONSE' }),
    message: { text: input.text },
  });
  const id = json.message_id ?? json.id;
  if (!id) throw new MetaOutcomeUnknownError('Réponse de Meta sans identifiant de message');
  return { messageId: String(id) };
}

/** Réponse à un commentaire : Facebook → `/{comment}/comments`, Instagram → `/{comment}/replies`. */
export async function replyToComment(
  opts: MetaClientOptions,
  provider: 'facebook' | 'instagram',
  commentId: string,
  text: string
): Promise<{ commentId: string }> {
  const edge = provider === 'facebook' ? 'comments' : 'replies';
  const json = await call(opts, `${commentId}/${edge}`, { message: text });
  if (!json.id) throw new MetaOutcomeUnknownError('Réponse de Meta sans identifiant de commentaire');
  return { commentId: String(json.id) };
}
