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

export interface SocialProvider {
  id: string;
  supportsThreads: boolean;
  supportsMedia: boolean;
  /** Publie et renvoie un résultat par entrée de `posts`. Doit lever les erreurs de `errors.ts`. */
  publish(input: PublishInput): Promise<PublishResult[]>;
}
