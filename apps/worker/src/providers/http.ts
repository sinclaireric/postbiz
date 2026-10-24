import { MetricsUnavailableError, MissingScopeError, OutcomeUnknownError, PublishRejectedError, ReconnectRequiredError } from './errors.ts';

export type Fetch = typeof fetch;

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  json: any;
}

/**
 * Envoie une requête qui MODIFIE l'état du réseau (publication) et classe l'échec :
 * 401 → reconnexion, autre 4xx → refus, 5xx / délai / réseau → issue inconnue.
 */
/** Ce que la requête modifie : les messages d'erreur parlent de « la publication » ou de « le commentaire ». */
const WORDS = {
  post: { refused: 'la publication', retry: 'republier' },
  comment: { refused: 'le commentaire', retry: 'recommenter' },
} as const;

export async function mutate(fetchImpl: Fetch, url: string, init: RequestInit, opts: { timeoutMs?: number; provider: string; subject?: keyof typeof WORDS }): Promise<HttpResult> {
  const words = WORDS[opts.subject ?? 'post'];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (e) {
    throw new OutcomeUnknownError(`${opts.provider} : requête interrompue (${(e as Error).message}). Vérifiez sur le réseau avant de ${words.retry}.`);
  } finally {
    clearTimeout(timer);
  }

  let text = '';
  try {
    text = await res.text();
  } catch {
    if (res.ok) throw new OutcomeUnknownError(`${opts.provider} : réponse illisible. Vérifiez sur le réseau avant de ${words.retry}.`);
  }
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* corps non JSON */
  }
  if (res.ok) return { status: res.status, headers: res.headers, text, json };

  if (res.status === 401 || json?.error?.code === 190) throw new ReconnectRequiredError();
  if (res.status >= 500) throw new OutcomeUnknownError(`${opts.provider} a répondu ${res.status}. Vérifiez sur le réseau avant de ${words.retry}.`);
  if (res.status === 429) throw new PublishRejectedError(`${opts.provider} : limite de requêtes atteinte, réessayez plus tard.`, 429);
  const detail = json?.error?.message ?? json?.detail ?? json?.message ?? json?.title;
  throw new PublishRejectedError(`${opts.provider} a refusé ${words.refused}${detail ? ` : ${String(detail).slice(0, 300)}` : ` (${res.status})`}.`, res.status);
}

/** Codes d'erreur de l'API Graph qui disent « cette application n'a pas la permission » (et non « ce jeton est invalide »). */
const GRAPH_PERMISSION_CODES = new Set([10, 200, 299, 3]);

/**
 * Que dit un refus du réseau sur une lecture ? `reconnect` : le jeton est invalide ou révoqué ; `scope` : le jeton est bon mais n'a pas l'autorisation
 * demandée (reconnecter, en accordant la nouvelle autorisation) ; `transient` : quota, panne ou réponse inattendue (réessayer plus tard).
 */
export function classifyReadFailure(status: number, json: any): 'reconnect' | 'scope' | 'transient' {
  const code = json?.error?.code;
  const text = `${json?.error?.message ?? ''} ${json?.error?.status ?? ''} ${json?.error?.errors?.[0]?.reason ?? ''} ${json?.message ?? ''} ${json?.serviceErrorCode ?? ''} ${json?.error?.code ?? ''}`;
  // Certains réseaux répondent 401 quand l'autorisation manque (TikTok : scope_not_authorized) : ce n'est pas un jeton révoqué.
  if (status < 500 && /scope_not_authorized|scope_permission_missed|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(text)) return 'scope';
  if (status === 401 || code === 190) return 'reconnect';
  if (status === 429 || status >= 500) return 'transient';
  if (/quota|rate.?limit|limit exceeded|too many/i.test(text)) return 'transient'; // YouTube répond 403 « quotaExceeded »
  if (status === 403 || GRAPH_PERMISSION_CODES.has(code) || /scope|permission|insufficient|access_denied|not authorized/i.test(text)) return 'scope';
  return 'transient';
}

/**
 * Lit une donnée chez le réseau (statistiques) : une lecture ne modifie rien, donc on peut la rejouer sans risque.
 * 401 (ou code 190 chez Meta) → reconnexion ; refus d'autorisation (403, codes de permission de Meta, scope manquant) → autorisation à renouveler ;
 * tout le reste (429, 5xx, délai, réseau, réponse illisible) → panne passagère.
 */
export async function read(fetchImpl: Fetch, url: string, init: RequestInit & { provider: string }, opts: { timeoutMs?: number } = {}): Promise<any> {
  const { provider, ...request } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...request, signal: controller.signal, headers: { Accept: 'application/json', ...(request.headers as Record<string, string> | undefined) } });
  } catch (e) {
    throw new MetricsUnavailableError(`${provider} : requête interrompue (${(e as Error).message}).`);
  } finally {
    clearTimeout(timer);
  }
  let json: any = {};
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : {};
  } catch {
    if (res.ok) throw new MetricsUnavailableError(`${provider} : réponse illisible.`);
  }
  if (res.ok) return json;

  const detail = String(json?.error?.message ?? json?.message ?? json?.error_description ?? json?.error?.errors?.[0]?.reason ?? json?.error?.status ?? '').slice(0, 200);
  const kind = classifyReadFailure(res.status, json);
  if (kind === 'reconnect') throw new ReconnectRequiredError();
  if (kind === 'scope') throw new MissingScopeError(`${provider} refuse l’accès aux statistiques${detail ? ` : ${detail}` : ''}. Reconnectez le canal pour accorder l’autorisation.`);
  throw new MetricsUnavailableError(`${provider} a répondu ${res.status}${detail ? ` : ${detail}` : ''}.`);
}
