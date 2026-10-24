import { createEventParser } from './request';
import type { AgentChatRequest, AgentEvent } from './types';

/**
 * Envoie un message à l'agent et rend chaque événement de la réponse dès qu'il arrive. La promesse se termine quand le flux est fini ;
 * une réponse qui s'arrête sans événement final (connexion coupée, page d'erreur) devient une erreur, jamais un silence.
 */
export async function streamChat(req: AgentChatRequest, onEvent: (event: AgentEvent) => void, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  let ended = false;
  const forward = (event: AgentEvent) => {
    if (event.type === 'done' || event.type === 'error') ended = true;
    onEvent(event);
  };

  try {
    const res = await fetcher('/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal });
    if (!res.body) throw new Error('no body');
    const parser = createEventParser();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(value)) forward(event);
    }
    for (const event of parser.flush()) forward(event);
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
  }
  if (!ended && !signal?.aborted) onEvent({ type: 'error', code: 'failed' });
}
