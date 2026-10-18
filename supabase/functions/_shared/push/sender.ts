// Envoi par lots à l'API Expo Push, avec nouvelles tentatives et collecte des jetons morts.
import { chunk, EXPO_BATCH_SIZE, EXPO_PUSH_URL, type ExpoMessage } from './format.ts';

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string; [k: string]: unknown };
}

export interface SendDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Jeton d'accès Expo (Push Security activé sur le projet) ; facultatif. */
  accessToken?: string;
  /** Tentatives par lot pour les erreurs transitoires (429, 5xx, réseau). Défaut : 3. */
  maxAttempts?: number;
  /** Attente avant la 2ᵉ tentative, doublée ensuite. Défaut : 500 ms. */
  baseDelayMs?: number;
}

export interface SendReport {
  /** Messages acceptés par Expo (ticket « ok »). */
  sent: number;
  /** Jetons à supprimer : Expo répond DeviceNotRegistered. */
  deadTokens: string[];
  /** Messages refusés pour une autre raison, ou lots perdus après épuisement des tentatives. */
  failed: { token: string; reason: string }[];
}

class TransientError extends Error {}

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

async function postBatch(batch: ExpoMessage[], deps: SendDeps): Promise<ExpoTicket[]> {
  let res: Response;
  try {
    res = await deps.fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(deps.accessToken ? { Authorization: `Bearer ${deps.accessToken}` } : {}),
      },
      body: JSON.stringify(batch),
    });
  } catch (e) {
    throw new TransientError(`réseau : ${(e as Error).message}`);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const msg = `HTTP ${res.status} ${text.slice(0, 200)}`.trim();
    if (TRANSIENT_STATUS.has(res.status)) throw new TransientError(msg);
    throw new Error(msg); // 4xx : la requête est mauvaise, la rejouer ne changera rien
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new TransientError('réponse Expo illisible');
  }
  // Une seule charge envoyée dans un tableau => `data` est un tableau de tickets, dans l'ordre des messages.
  if (!Array.isArray(json?.data)) throw new Error(`réponse Expo inattendue : ${text.slice(0, 200)}`);
  return json.data as ExpoTicket[];
}

async function postWithRetry(batch: ExpoMessage[], deps: SendDeps): Promise<ExpoTicket[]> {
  const attempts = deps.maxAttempts ?? 3;
  let delay = deps.baseDelayMs ?? 500;
  for (let attempt = 1; ; attempt++) {
    try {
      return await postBatch(batch, deps);
    } catch (e) {
      if (!(e instanceof TransientError) || attempt >= attempts) throw e;
      await deps.sleep(delay);
      delay *= 2;
    }
  }
}

/** Envoie tous les messages (lots de 100) et classe les résultats. Ne lève jamais : un lot perdu est rapporté dans `failed`. */
export async function sendExpoMessages(messages: readonly ExpoMessage[], deps: SendDeps): Promise<SendReport> {
  const report: SendReport = { sent: 0, deadTokens: [], failed: [] };
  for (const batch of chunk(messages, EXPO_BATCH_SIZE)) {
    let tickets: ExpoTicket[];
    try {
      tickets = await postWithRetry(batch, deps);
    } catch (e) {
      for (const m of batch) report.failed.push({ token: m.to, reason: (e as Error).message });
      continue;
    }
    batch.forEach((m, i) => {
      const t = tickets[i];
      if (!t) {
        // Réponse plus courte que la requête : on ne sait rien de ce message, surtout pas qu'il faut supprimer son jeton.
        report.failed.push({ token: m.to, reason: 'ticket manquant' });
      } else if (t.status === 'ok') {
        report.sent++;
      } else if (t.details?.error === 'DeviceNotRegistered') {
        report.deadTokens.push(m.to);
      } else {
        report.failed.push({ token: m.to, reason: t.details?.error ?? t.message ?? 'erreur inconnue' });
      }
    });
  }
  return report;
}
