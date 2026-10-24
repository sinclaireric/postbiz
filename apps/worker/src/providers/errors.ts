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

/** Le rafraîchissement d'un jeton a échoué pour une raison passagère (réseau, 5xx, configuration) : réessayer plus tard. */
export class RefreshTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefreshTransientError';
  }
}

/**
 * Le réseau refuse de donner les statistiques parce que l'accès du canal n'a pas cette autorisation (le canal a été connecté avant qu'on la
 * demande, ou l'utilisateur ne l'a pas accordée) : inutile de réessayer tout de suite, il faut reconnecter le canal.
 */
export class MissingScopeError extends Error {
  constructor(message = 'Le réseau n’autorise pas la lecture des statistiques : reconnectez le canal pour accorder cette autorisation.') {
    super(message);
    this.name = 'MissingScopeError';
  }
}

/** La lecture des statistiques a échoué pour une raison passagère (réseau, 5xx, quota, réponse inattendue) : on réessaiera plus tard. */
export class MetricsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricsUnavailableError';
  }
}
