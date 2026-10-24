/**
 * Le modèle de l'agent : le même que celui de l'agent de Postiz (GPT-5.2, d'OpenAI). `OPENAI_AGENT_MODEL` permet d'en choisir un autre sans toucher au code.
 * L'agent n'est proposé que si le serveur a une clé d'API OpenAI (la même variable que Postiz : `OPENAI_API_KEY`).
 * Ce fichier ne dépend de rien : les pages peuvent le lire sans embarquer le SDK d'OpenAI.
 */
export const DEFAULT_AGENT_MODEL = 'gpt-5.2';
export const agentModel = () => process.env.OPENAI_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
export const agentConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim());
