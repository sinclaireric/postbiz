import { TokenRejectedError, TokenTransientError, type OAuthContext, type TokenSet } from './types.ts';

export interface JsonResponse {
  status: number;
  ok: boolean;
  json: any;
}

/**
 * Requête HTTP vers un réseau. Les pannes passagères (réseau coupé, délai, 5xx, 429) lèvent TokenTransientError ;
 * les refus 4xx sont renvoyés (`ok: false`) pour que l'appelant décide.
 */
export async function requestJson(
  ctx: Pick<OAuthContext, 'fetch'>,
  url: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; headers?: Record<string, string>; form?: Record<string, string>; timeoutMs?: number } = {}
): Promise<JsonResponse> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body: string | undefined;
  if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  let text: string;
  try {
    res = await ctx.fetch(url, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: controller.signal });
    text = await res.text();
  } catch (e) {
    throw new TokenTransientError(`Le réseau ne répond pas (${(e as Error).name === 'AbortError' ? 'délai dépassé' : 'connexion impossible'}).`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500 || res.status === 429) throw new TokenTransientError(`Le réseau est momentanément indisponible (${res.status}).`);
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* corps non JSON */
  }
  return { status: res.status, ok: res.ok, json };
}

/** Message lisible tiré d'une réponse d'erreur. Jamais le corps brut (il pourrait contenir un jeton). */
export function describeError(json: any, status: number): string {
  const pick = [json?.error_description, json?.error?.message, json?.message, json?.detail, typeof json?.error === 'string' ? json.error : undefined, json?.data?.description]
    .find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
  const code = typeof json?.error === 'string' ? json.error : json?.error?.code;
  return `${pick ? pick.slice(0, 200) : `réponse ${status}`}${code && pick && !pick.includes(String(code)) ? ` (${String(code).slice(0, 40)})` : ''}`;
}

/** Réponse d'erreur → refus définitif. Certains réseaux (TikTok) répondent 200 avec un champ `error`. */
export function ensureOk(res: JsonResponse): void {
  const inBody = res.ok && typeof res.json?.error === 'string' && res.json.error !== '' && res.json.error !== 'ok';
  if (!res.ok || inBody) throw new TokenRejectedError(describeError(res.json, res.status));
}

/** Lit un jeton OAuth standard (`access_token`, `refresh_token`, `expires_in`). */
export function toTokens(json: any, now: Date): TokenSet {
  const accessToken = json?.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') throw new TokenRejectedError('Le réseau n’a pas renvoyé de jeton d’accès.');
  const expiresIn = Number(json?.expires_in);
  return {
    accessToken,
    refreshToken: typeof json?.refresh_token === 'string' && json.refresh_token !== '' ? json.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null,
  };
}

export const basicAuth = (id: string, secret: string) => `Basic ${btoa(`${id}:${secret}`)}`;

export function requireEnv(env: Record<string, string | undefined>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = env[k];
    if (!v) throw new TokenRejectedError(`Variable d’environnement manquante : ${k}`);
    out[k] = v;
  }
  return out;
}
