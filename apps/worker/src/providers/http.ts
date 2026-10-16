import { OutcomeUnknownError, PublishRejectedError, ReconnectRequiredError } from './errors.ts';

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
export async function mutate(fetchImpl: Fetch, url: string, init: RequestInit, opts: { timeoutMs?: number; provider: string }): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (e) {
    throw new OutcomeUnknownError(`${opts.provider} : requête interrompue (${(e as Error).message}). Vérifiez sur le réseau avant de republier.`);
  } finally {
    clearTimeout(timer);
  }

  let text = '';
  try {
    text = await res.text();
  } catch {
    if (res.ok) throw new OutcomeUnknownError(`${opts.provider} : réponse illisible. Vérifiez sur le réseau avant de republier.`);
  }
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* corps non JSON */
  }
  if (res.ok) return { status: res.status, headers: res.headers, text, json };

  if (res.status === 401) throw new ReconnectRequiredError();
  if (res.status >= 500) throw new OutcomeUnknownError(`${opts.provider} a répondu ${res.status}. Vérifiez sur le réseau avant de republier.`);
  if (res.status === 429) throw new PublishRejectedError(`${opts.provider} : limite de requêtes atteinte, réessayez plus tard.`, 429);
  const detail = json?.error?.message ?? json?.detail ?? json?.message ?? json?.title;
  throw new PublishRejectedError(`${opts.provider} a refusé la publication${detail ? ` : ${String(detail).slice(0, 300)}` : ` (${res.status})`}.`, res.status);
}
