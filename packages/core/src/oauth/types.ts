// Flux OAuth des réseaux : définitions partagées entre l'app web (connexion) et le worker (rafraîchissement).
// ⚠️ Rien de tout cela n'a été exécuté contre les vraies API : les URL, scopes et formats suivent la documentation
// publique de chaque réseau et sont validés uniquement avec un réseau simulé (voir docs/RESEAUX.md).

export type NetworkId = 'facebook' | 'instagram' | 'x' | 'linkedin' | 'tiktok' | 'youtube';
/** Une « famille » = une application développeur chez le réseau (Meta couvre Facebook et Instagram, Google couvre YouTube). */
export type FamilyId = 'meta' | 'x' | 'linkedin' | 'google' | 'tiktok';

export type Env = Record<string, string | undefined>;

export interface OAuthContext {
  env: Env;
  fetch: typeof fetch;
  now: () => Date;
}

export interface TokenSet {
  accessToken: string;
  /** Au rafraîchissement, `null` signifie « inchangé » (le réseau n'en a pas émis de nouveau). */
  refreshToken: string | null;
  /** `null` = le jeton n'expire pas (jeton de Page Meta). */
  expiresAt: Date | null;
}

/** Un compte que l'utilisateur peut connecter (le jeton n'est jamais envoyé au navigateur). */
export interface ChannelCandidate {
  network: NetworkId;
  internalId: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  settings: Record<string, unknown>;
  tokens: TokenSet;
}

export interface DisconnectInfo {
  network: NetworkId;
  internalId: string;
  settings: Record<string, unknown>;
  accessToken: string | null;
  refreshToken: string | null;
  /** Un autre canal actif partage la même Page Meta : ne pas désabonner ses webhooks. */
  sharesPageWithOtherChannel: boolean;
}

export interface OAuthFamily {
  id: FamilyId;
  networks: readonly NetworkId[];
  /** Variables d'environnement qui doivent toutes être renseignées pour activer ce réseau. */
  envKeys: readonly string[];
  /** PKCE (S256) pour les réseaux qui le documentent pour leur flux web. */
  usesPkce: boolean;
  /** `true` : plusieurs comptes possibles (Pages Meta), l'utilisateur choisit avant la création des canaux. */
  choose: boolean;
  authorizeUrl(ctx: OAuthContext, a: { network: NetworkId; redirectUri: string; state: string; codeChallenge: string | null }): string;
  exchangeCode(ctx: OAuthContext, a: { redirectUri: string; code: string; codeVerifier: string | null }): Promise<TokenSet>;
  /** Absent = rien à rafraîchir (jetons de Page Meta : sans expiration). */
  refresh?(ctx: OAuthContext, refreshToken: string): Promise<TokenSet>;
  listChannels(ctx: OAuthContext, a: { network: NetworkId; tokens: TokenSet }): Promise<ChannelCandidate[]>;
  /** Après création du canal (ex. abonnement aux webhooks de la Page). Ne lève pas : renvoie le résultat. */
  afterConnect?(ctx: OAuthContext, c: ChannelCandidate): Promise<{ ok: boolean; error?: string }>;
  /** Au retrait du canal : révocation du jeton / désabonnement. Au mieux : l'appelant ignore les échecs. */
  onDisconnect?(ctx: OAuthContext, d: DisconnectInfo): Promise<void>;
}

/** Erreur à afficher à l'utilisateur : le message ne contient jamais de jeton ni de corps de réponse brut. */
export class OAuthError extends Error {
  constructor(
    message: string,
    public code: 'denied' | 'invalid_state' | 'exchange' | 'profile' | 'no_account' | 'config' = 'exchange'
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

/** Le réseau a refusé le jeton / le code (ex. invalid_grant) : inutile de réessayer, il faut reconnecter. */
export class TokenRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenRejectedError';
  }
}

/** Panne passagère (réseau, 5xx, limite de débit) : on peut réessayer plus tard. */
export class TokenTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenTransientError';
  }
}
