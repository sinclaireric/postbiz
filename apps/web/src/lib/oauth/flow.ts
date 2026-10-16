// Flux de connexion des canaux. Toute la logique (état, PKCE, échange, choix des comptes, déconnexion) est ici,
// derrière un `OAuthStore` et un `fetch` injectés : les routes Next.js ne font que lire la requête et rediriger.
// Règle : aucun jeton ne sort de ce module vers le navigateur. Les erreurs montrées à l'utilisateur sont des codes
// fixes (jamais un texte venu du réseau ou de l'URL).
import {
  checkState, codeChallenge, createState, decryptSecret, encryptSecret, familyForNetwork, isFamilyId, missingEnv, newCodeVerifier,
  OAuthError, OAUTH_FAMILIES, type ChannelCandidate, type Env, type NetworkId, type OAuthContext,
} from '@postbiz/core';

export interface StoredState { userId: string; orgId: string; network: NetworkId; codeVerifierEnc: string | null; expiresAt: Date }
export interface PendingSelection { id: string; userId: string; orgId: string; network: NetworkId; payloadEnc: string; expiresAt: Date }
export interface ChannelWrite {
  orgId: string; provider: NetworkId; internalId: string; name: string; username: string | null; pictureUrl: string | null;
  settings: Record<string, unknown>; tokenExpiresAt: Date | null; accessTokenEnc: string; refreshTokenEnc: string | null;
}
export interface ChannelForDisconnect {
  id: string; network: NetworkId; internalId: string; settings: Record<string, unknown>; accessTokenEnc: string | null; refreshTokenEnc: string | null;
}

export interface OAuthStore {
  saveState(row: StoredState & { stateHash: string }): Promise<void>;
  /** Lecture ET suppression en une seule opération : un `state` ne sert qu'une fois. */
  consumeState(stateHash: string): Promise<StoredState | null>;
  savePending(row: Omit<PendingSelection, 'id'>): Promise<string>;
  getPending(id: string): Promise<PendingSelection | null>;
  deletePending(id: string): Promise<void>;
  connectChannel(row: ChannelWrite): Promise<string>;
  getChannelForDisconnect(orgId: string, integrationId: string): Promise<ChannelForDisconnect | null>;
  /** Autres canaux actifs rattachés à la même Page Meta (Facebook + Instagram partagent un abonnement). */
  hasOtherChannelOnPage(pageId: string, exceptIntegrationId: string): Promise<boolean>;
  disconnectChannel(orgId: string, integrationId: string): Promise<boolean>;
}

export interface FlowDeps {
  store: OAuthStore;
  env: Env;
  fetch: typeof fetch;
  /** URL publique du site (sans `/` final) : sert à construire l'adresse de retour enregistrée chez chaque réseau. */
  siteUrl: string;
  /** TOKEN_ENCRYPTION_KEY (32 octets en base64). */
  encryptionKey: string;
  isAdmin(userId: string, orgId: string): Promise<boolean>;
  now?: () => Date;
  log?: (msg: string) => void;
}

export type ErrorCode =
  | 'reseau_inconnu' | 'non_configure' | 'non_autorise' | 'refuse' | 'etat_invalide' | 'echange' | 'profil' | 'aucun_compte'
  | 'selection_vide' | 'expire' | 'erreur';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  reseau_inconnu: 'Ce réseau n’existe pas.',
  non_configure: 'La connexion de ce réseau n’est pas configurée sur ce serveur.',
  non_autorise: 'Seul un administrateur de l’organisation peut connecter ou déconnecter un canal.',
  refuse: 'Vous avez annulé l’autorisation chez le réseau : rien n’a été connecté.',
  etat_invalide: 'La connexion a expiré ou n’est plus valide. Relancez-la depuis cette page.',
  echange: 'Le réseau a refusé la connexion. Réessayez ; si cela se reproduit, vérifiez la configuration de l’application du réseau.',
  profil: 'Connexion acceptée, mais le profil du compte n’a pas pu être lu. Réessayez dans un instant.',
  aucun_compte: 'Aucun compte utilisable n’a été trouvé (pour Meta : Page autorisée, ou compte Instagram professionnel lié à une Page).',
  selection_vide: 'Sélectionnez au moins un compte à connecter.',
  expire: 'Cette sélection a expiré. Relancez la connexion.',
  erreur: 'La connexion a échoué. Réessayez dans un instant.',
};

const ERROR_FROM_OAUTH: Record<OAuthError['code'], ErrorCode> = {
  denied: 'refuse', invalid_state: 'etat_invalide', exchange: 'echange', profile: 'profil', no_account: 'aucun_compte', config: 'non_configure',
};

const STATE_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 30 * 60_000;

export const callbackUrl = (siteUrl: string, familyId: string) => `${siteUrl}/api/oauth/callback/${familyId}`;

const now = (d: FlowDeps) => (d.now ?? (() => new Date()))();
const ctxOf = (d: FlowDeps): OAuthContext => ({ env: d.env, fetch: d.fetch, now: () => now(d) });

// ------------------------------------------------------------------------------------------------ démarrage
export type StartResult = { ok: true; url: string } | { ok: false; error: ErrorCode };

export async function startConnection(deps: FlowDeps, a: { network: string; userId: string; orgId: string }): Promise<StartResult> {
  const family = familyForNetwork(a.network);
  if (!family) return { ok: false, error: 'reseau_inconnu' };
  const network = a.network as NetworkId;
  if (missingEnv(family, deps.env).length > 0) return { ok: false, error: 'non_configure' };
  if (!(await deps.isAdmin(a.userId, a.orgId))) return { ok: false, error: 'non_autorise' };

  const { state, hash } = await createState(deps.encryptionKey);
  let verifier: string | null = null;
  let challenge: string | null = null;
  if (family.usesPkce) {
    verifier = newCodeVerifier();
    challenge = await codeChallenge(verifier);
  }
  await deps.store.saveState({
    stateHash: hash, userId: a.userId, orgId: a.orgId, network,
    codeVerifierEnc: verifier ? await encryptSecret(verifier, deps.encryptionKey) : null,
    expiresAt: new Date(now(deps).getTime() + STATE_TTL_MS),
  });
  const url = family.authorizeUrl(ctxOf(deps), { network, redirectUri: callbackUrl(deps.siteUrl, family.id), state, codeChallenge: challenge });
  return { ok: true, url };
}

// ------------------------------------------------------------------------------------------------ retour du réseau
export type CompleteResult =
  | { kind: 'connected'; network: NetworkId; count: number; webhookWarnings: number }
  | { kind: 'select'; pendingId: string }
  | { kind: 'error'; code: ErrorCode; network?: NetworkId };

export async function completeConnection(deps: FlowDeps, a: { family: string; params: URLSearchParams; userId: string }): Promise<CompleteResult> {
  if (!isFamilyId(a.family)) return { kind: 'error', code: 'reseau_inconnu' };
  const family = OAUTH_FAMILIES[a.family];

  const hash = await checkState(a.params.get('state'), deps.encryptionKey);
  if (!hash) return { kind: 'error', code: 'etat_invalide' };
  const row = await deps.store.consumeState(hash);
  if (!row || row.expiresAt.getTime() < now(deps).getTime() || row.userId !== a.userId || familyForNetwork(row.network)?.id !== family.id) {
    return { kind: 'error', code: 'etat_invalide' };
  }
  const network = row.network;
  const fail = (code: ErrorCode): CompleteResult => ({ kind: 'error', code, network });

  if (a.params.get('error')) return fail('refuse');
  const code = a.params.get('code');
  if (!code) return fail('etat_invalide');
  if (!(await deps.isAdmin(row.userId, row.orgId))) return fail('non_autorise');
  if (missingEnv(family, deps.env).length > 0) return fail('non_configure');

  try {
    const ctx = ctxOf(deps);
    const verifier = row.codeVerifierEnc ? await decryptSecret(row.codeVerifierEnc, deps.encryptionKey) : null;
    const tokens = await family.exchangeCode(ctx, { redirectUri: callbackUrl(deps.siteUrl, family.id), code, codeVerifier: verifier });
    const candidates = await family.listChannels(ctx, { network, tokens });
    if (candidates.length === 0) return fail('aucun_compte');

    if (family.choose) {
      const pendingId = await deps.store.savePending({
        userId: row.userId, orgId: row.orgId, network,
        payloadEnc: await encryptSecret(JSON.stringify(candidates), deps.encryptionKey),
        expiresAt: new Date(now(deps).getTime() + PENDING_TTL_MS),
      });
      return { kind: 'select', pendingId };
    }
    const done = await saveCandidates(deps, row.orgId, candidates.slice(0, 1));
    return { kind: 'connected', network, count: done.count, webhookWarnings: done.webhookWarnings };
  } catch (e) {
    // Détail technique dans les journaux serveur (déjà expurgé de tout jeton), code fixe pour l'utilisateur.
    deps.log?.(`OAuth ${family.id} : ${(e as Error).message}`);
    return fail(e instanceof OAuthError ? ERROR_FROM_OAUTH[e.code] : 'erreur');
  }
}

async function saveCandidates(deps: FlowDeps, orgId: string, candidates: ChannelCandidate[]) {
  const ctx = ctxOf(deps);
  let count = 0;
  let webhookWarnings = 0;
  for (const c of candidates) {
    await deps.store.connectChannel({
      orgId, provider: c.network, internalId: c.internalId, name: c.name, username: c.username, pictureUrl: c.pictureUrl, settings: c.settings,
      tokenExpiresAt: c.tokens.expiresAt,
      accessTokenEnc: await encryptSecret(c.tokens.accessToken, deps.encryptionKey),
      refreshTokenEnc: c.tokens.refreshToken ? await encryptSecret(c.tokens.refreshToken, deps.encryptionKey) : null,
    });
    count++;
    const after = await familyForNetwork(c.network)!.afterConnect?.(ctx, c);
    if (after && !after.ok) {
      webhookWarnings++;
      deps.log?.(`OAuth ${c.network} : ${after.error}`);
    }
  }
  return { count, webhookWarnings };
}

// ------------------------------------------------------------------------------------------------ choix des comptes (Meta)
/** Ce que le navigateur a le droit de voir : jamais de jeton. */
export interface PublicCandidate { key: string; network: NetworkId; name: string; username: string | null; pictureUrl: string | null }

const keyOf = (c: Pick<ChannelCandidate, 'network' | 'internalId'>) => `${c.network}:${c.internalId}`;

async function loadPending(deps: FlowDeps, userId: string, pendingId: string): Promise<{ row: PendingSelection; candidates: ChannelCandidate[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pendingId)) return null;
  const row = await deps.store.getPending(pendingId);
  if (!row || row.userId !== userId || row.expiresAt.getTime() < now(deps).getTime()) return null;
  const candidates = JSON.parse(await decryptSecret(row.payloadEnc, deps.encryptionKey)) as ChannelCandidate[];
  return { row, candidates };
}

export async function getPendingSelection(deps: FlowDeps, a: { userId: string; pendingId: string }): Promise<{ network: NetworkId; candidates: PublicCandidate[] } | null> {
  const p = await loadPending(deps, a.userId, a.pendingId);
  if (!p) return null;
  return {
    network: p.row.network,
    candidates: p.candidates.map((c) => ({ key: keyOf(c), network: c.network, name: c.name, username: c.username, pictureUrl: c.pictureUrl })),
  };
}

export async function confirmSelection(deps: FlowDeps, a: { userId: string; pendingId: string; keys: string[] }): Promise<CompleteResult> {
  const p = await loadPending(deps, a.userId, a.pendingId);
  if (!p) return { kind: 'error', code: 'expire' };
  const network = p.row.network;
  if (!(await deps.isAdmin(a.userId, p.row.orgId))) return { kind: 'error', code: 'non_autorise', network };
  const wanted = new Set(a.keys);
  const chosen = p.candidates.filter((c) => wanted.has(keyOf(c)));
  if (chosen.length === 0) return { kind: 'error', code: 'selection_vide', network };
  try {
    const done = await saveCandidates(deps, p.row.orgId, chosen);
    await deps.store.deletePending(p.row.id);
    return { kind: 'connected', network, count: done.count, webhookWarnings: done.webhookWarnings };
  } catch (e) {
    deps.log?.(`OAuth sélection : ${(e as Error).message}`);
    return { kind: 'error', code: 'erreur', network };
  }
}

// ------------------------------------------------------------------------------------------------ déconnexion
export type DisconnectResult = { ok: true; cleanupFailed: boolean } | { ok: false; error: ErrorCode };

/**
 * Révoque / se désabonne chez le réseau (au mieux : un échec n'empêche jamais la déconnexion), puis supprime les
 * jetons et marque le canal supprimé en une seule opération en base.
 */
export async function disconnectChannel(deps: FlowDeps, a: { userId: string; orgId: string; integrationId: string }): Promise<DisconnectResult> {
  if (!(await deps.isAdmin(a.userId, a.orgId))) return { ok: false, error: 'non_autorise' };
  const ch = await deps.store.getChannelForDisconnect(a.orgId, a.integrationId);
  if (!ch) return { ok: false, error: 'erreur' };

  let cleanupFailed = false;
  const family = familyForNetwork(ch.network);
  if (family?.onDisconnect && missingEnv(family, deps.env).length === 0) {
    try {
      const pageId = typeof ch.settings.page_id === 'string' ? ch.settings.page_id : null;
      await family.onDisconnect(ctxOf(deps), {
        network: ch.network, internalId: ch.internalId, settings: ch.settings,
        accessToken: ch.accessTokenEnc ? await decryptSecret(ch.accessTokenEnc, deps.encryptionKey) : null,
        refreshToken: ch.refreshTokenEnc ? await decryptSecret(ch.refreshTokenEnc, deps.encryptionKey) : null,
        sharesPageWithOtherChannel: pageId ? await deps.store.hasOtherChannelOnPage(pageId, ch.id) : false,
      });
    } catch (e) {
      cleanupFailed = true;
      deps.log?.(`Déconnexion ${ch.network} : nettoyage chez le réseau impossible (${(e as Error).message})`);
    }
  }
  if (!(await deps.store.disconnectChannel(a.orgId, ch.id))) return { ok: false, error: 'erreur' };
  return { ok: true, cleanupFailed };
}
