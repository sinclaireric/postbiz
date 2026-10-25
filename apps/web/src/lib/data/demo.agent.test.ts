import { describe, expect, it } from 'vitest';
import type { AgentProposal } from '@/lib/agent/types';
import { demoRepositories } from './demo';

const agent = demoRepositories.agent;

const proposal = (over: Partial<AgentProposal> = {}): AgentProposal => ({
  id: 'p1', integrationId: 'i2', networkId: 'facebook', accountName: 'Maison Lune', text: 'Atelier ouvert samedi', firstComment: null, mediaIds: [], publishAt: null, status: 'pending', ...over,
});

describe('conversations de l’agent (mode démo)', () => {
  it('ouvre une conversation avec le premier échange, puis y ajoute les suivants', async () => {
    const first = (await agent.saveExchange({ threadId: null, title: 'Annonce de l’atelier', user: { text: 'Annonce l’atelier', mediaIds: ['m1'] }, assistant: { text: 'Voici', proposals: [proposal()], mediaIds: [], jobIds: [] } }))!;
    expect(first.thread.title).toBe('Annonce de l’atelier');
    expect(first.user).toMatchObject({ role: 'user', text: 'Annonce l’atelier', mediaIds: ['m1'], proposals: [] });
    expect(first.assistant).toMatchObject({ role: 'assistant', text: 'Voici', proposals: [{ id: 'p1', status: 'pending' }] });
    expect(first.user.createdAt < first.assistant.createdAt).toBe(true);

    const second = (await agent.saveExchange({ threadId: first.thread.id, title: 'ignoré', user: { text: 'Et pour LinkedIn ?', mediaIds: [] }, assistant: { text: 'Oui', proposals: [], mediaIds: [], jobIds: [] } }))!;
    expect(second.thread.id).toBe(first.thread.id);
    expect(second.thread.title).toBe('Annonce de l’atelier');
    expect((await agent.thread(first.thread.id))!.messages.map((m) => m.text)).toEqual(['Annonce l’atelier', 'Voici', 'Et pour LinkedIn ?', 'Oui']);
  });

  it('liste la conversation la plus récente en premier', async () => {
    const older = (await agent.saveExchange({ threadId: null, title: 'Ancienne', user: { text: 'a', mediaIds: [] }, assistant: { text: 'b', proposals: [], mediaIds: [], jobIds: [] } }))!;
    await new Promise((r) => setTimeout(r, 5));
    const newer = (await agent.saveExchange({ threadId: null, title: 'Récente', user: { text: 'a', mediaIds: [] }, assistant: { text: 'b', proposals: [], mediaIds: [], jobIds: [] } }))!;
    const ids = (await agent.threads()).map((t) => t.id);
    expect(ids.indexOf(newer.thread.id)).toBeLessThan(ids.indexOf(older.thread.id));
  });

  it('refuse d’écrire dans une conversation qui n’existe pas', async () => {
    expect(await agent.saveExchange({ threadId: 'fantome', title: 'x', user: { text: 'a', mediaIds: [] }, assistant: { text: 'b', proposals: [], mediaIds: [], jobIds: [] } })).toBeNull();
    expect(await agent.thread('fantome')).toBeNull();
  });

  it('met à jour l’état des publications d’un message, et ce que l’utilisateur en a fait', async () => {
    const { thread, assistant } = (await agent.saveExchange({ threadId: null, title: 'État', user: { text: 'a', mediaIds: [] }, assistant: { text: 'b', proposals: [proposal(), proposal({ id: 'p2' })], mediaIds: [], jobIds: [] } }))!;
    const res = await agent.updateProposals(assistant.id, [{ id: 'p1', status: 'scheduled', text: 'Texte relu', firstComment: 'Adresse', mediaIds: ['m1'], publishAt: '2026-10-28T08:00:00.000Z' }]);
    expect(res.ok).toBe(true);
    const saved = (await agent.thread(thread.id))!.messages[1]!.proposals;
    expect(saved[0]).toMatchObject({ id: 'p1', status: 'scheduled', text: 'Texte relu', firstComment: 'Adresse', mediaIds: ['m1'], publishAt: '2026-10-28T08:00:00.000Z' });
    expect(saved[1]).toMatchObject({ id: 'p2', status: 'pending', text: 'Atelier ouvert samedi' });
    expect((await agent.updateProposals('fantome', [])).ok).toBe(false);
  });

  it('rend des copies : modifier le résultat ne change pas la conversation', async () => {
    const { thread } = (await agent.saveExchange({ threadId: null, title: 'Copie', user: { text: 'a', mediaIds: [] }, assistant: { text: 'b', proposals: [proposal()], mediaIds: [], jobIds: [] } }))!;
    const read = (await agent.thread(thread.id))!;
    read.messages[1]!.proposals[0]!.text = 'abîmé';
    expect((await agent.thread(thread.id))!.messages[1]!.proposals[0]!.text).toBe('Atelier ouvert samedi');
  });

  it('supprime une conversation avec ses messages', async () => {
    const { thread } = (await agent.saveExchange({ threadId: null, title: 'À supprimer', user: { text: 'a', mediaIds: [] }, assistant: { text: 'b', proposals: [], mediaIds: [], jobIds: [] } }))!;
    expect((await agent.removeThread(thread.id)).ok).toBe(true);
    expect(await agent.thread(thread.id)).toBeNull();
    expect((await agent.threads()).some((t) => t.id === thread.id)).toBe(false);
  });
});
