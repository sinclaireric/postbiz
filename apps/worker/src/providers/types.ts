export interface PublishInput {
  accessToken: string;
  integration: { id: string; internalId: string; settings: Record<string, unknown> };
  /** Publication racine en premier, puis les éventuelles suites (fil). */
  posts: { id: string; content: string; media: unknown[]; settings: Record<string, unknown> }[];
}

export interface PublishResult {
  releaseId: string;
  releaseUrl: string | null;
}

export interface RefreshInput {
  refreshToken: string;
  integration: { id: string; internalId: string; settings: Record<string, unknown> };
}

export interface RefreshedTokens {
  accessToken: string;
  /** `null` : le réseau n'a pas émis de nouveau refresh token, on garde l'ancien. */
  refreshToken: string | null;
  /** `null` : le jeton n'expire pas. */
  expiresAt: Date | null;
}

export interface SocialProvider {
  id: string;
  supportsThreads: boolean;
  supportsMedia: boolean;
  /** Publie et renvoie un résultat par entrée de `posts`. Doit lever les erreurs de `errors.ts`. */
  publish(input: PublishInput): Promise<PublishResult[]>;
  /**
   * Échange un refresh token contre de nouveaux jetons. Absent si le réseau n'a rien à rafraîchir.
   * Lève ReconnectRequiredError (refus définitif : il faut reconnecter) ou RefreshTransientError (réessayer plus tard).
   */
  refreshToken?(input: RefreshInput): Promise<RefreshedTokens>;
}
