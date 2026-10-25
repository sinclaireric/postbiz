/**
 * Le modèle de l'agent : le même que celui de l'agent de Postiz (GPT-5.2, d'OpenAI). `OPENAI_AGENT_MODEL` permet d'en choisir un autre sans toucher au code.
 * L'agent n'est proposé que si le serveur a une clé d'API OpenAI (la même variable que Postiz : `OPENAI_API_KEY`).
 * Ce fichier ne dépend de rien : les pages peuvent le lire sans embarquer le SDK d'OpenAI.
 */
export const DEFAULT_AGENT_MODEL = 'gpt-5.2';
export const agentModel = () => process.env.OPENAI_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
export const agentConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim());

/**
 * Génération d'images : le même modèle que Postiz (`chatgpt-image-latest`, d'OpenAI), avec la même clé que l'agent. `OPENAI_IMAGE_MODEL` en choisit un autre.
 * La qualité par défaut est « medium » (Postiz laisse « auto ») : une image « high » peut dépasser les 60 secondes d'une réponse de l'agent.
 */
export const DEFAULT_IMAGE_MODEL = 'chatgpt-image-latest';
export const imageModel = () => process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
export type ImageQuality = 'low' | 'medium' | 'high' | 'auto';
export const imageQuality = (): ImageQuality => {
  const q = process.env.OPENAI_IMAGE_QUALITY?.trim().toLowerCase();
  return q === 'low' || q === 'high' || q === 'auto' ? q : 'medium';
};

/** Vidéos : Seedance 2.0 par Evolink, comme dans Postiz (`EVOLINK_API_KEY`). Sans clé, l'agent ne propose pas de vidéo. */
export const videoConfigured = () => Boolean(process.env.EVOLINK_API_KEY?.trim());

function limit(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name]?.trim() ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 1_000) : fallback;
}

/**
 * Plafonds par organisation et par jour glissant : chaque image et chaque vidéo est facturée par le fournisseur, et l'agent peut en lancer à la demande.
 * 0 désactive la génération correspondante.
 */
export const imagesPerDay = () => limit('AGENT_IMAGES_PER_DAY', 30);
export const videosPerDay = () => limit('AGENT_VIDEOS_PER_DAY', 5);
