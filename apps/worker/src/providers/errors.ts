/** Le réseau a refusé la requête : rien n'a été publié, on peut réessayer à la main. */
export class PublishRejectedError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'PublishRejectedError';
  }
}

/** L'accès au compte est expiré ou révoqué : il faut reconnecter le canal. */
export class ReconnectRequiredError extends Error {
  constructor(message = 'L’accès au compte a expiré : reconnectez le canal.') {
    super(message);
    this.name = 'ReconnectRequiredError';
  }
}

/**
 * L'issue est inconnue (délai dépassé, 5xx, coupure réseau) : la publication est peut-être partie.
 * Ne JAMAIS rejouer automatiquement : on le signale à l'utilisateur, qui vérifie sur le réseau.
 */
export class OutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutcomeUnknownError';
  }
}
