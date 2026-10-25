import { describe, expect, it } from 'vitest';
import { demoRepositories } from '@/lib/data/demo';
import { loadThread } from './load';

describe('loadThread : une conversation avec ses images, ses vidéos et leurs médias', () => {
  it('rend les images générées et les vidéos lancées d’un message, dans leur état du moment', async () => {
    const image = (await demoRepositories.generation.createMedia({ name: 'ai-image-phare.jpg', mimeType: 'image/jpeg', bytes: new Uint8Array(10), width: 1024, height: 1024, durationSeconds: null, alt: 'Un phare' }))!;
    const finished = (await demoRepositories.generation.createJob({ prompt: 'Un rabot', orientation: 'horizontal', providerTaskId: 'demo-1', referenceMediaIds: [] }))!;
    const video = (await demoRepositories.generation.createMedia({ name: 'ai-video-rabot.mp4', mimeType: 'video/mp4', bytes: new Uint8Array(10), width: 1280, height: 720, durationSeconds: 8, alt: '' }))!;
    await demoRepositories.generation.settleJob(finished.id, { status: 'completed', mediaId: video.id });
    const running = (await demoRepositories.generation.createJob({ prompt: 'Un phare', orientation: 'vertical', providerTaskId: 'demo-2', referenceMediaIds: [] }))!;

    const saved = (await demoRepositories.agent.saveExchange({
      threadId: null, title: 'Phare', user: { text: 'Une image et deux vidéos', mediaIds: [] },
      assistant: { text: 'Voilà', proposals: [], mediaIds: [image.id], jobIds: [finished.id, running.id] },
    }))!;
    expect(saved.assistant).toMatchObject({ mediaIds: [image.id], jobIds: [finished.id, running.id] });

    const loaded = (await loadThread(demoRepositories, saved.thread.id))!;
    expect(loaded.jobs.map((j) => [j.id, j.status, j.mediaId])).toEqual([[finished.id, 'completed', video.id], [running.id, 'pending', null]]);
    expect(JSON.stringify(loaded.jobs)).not.toContain('demo-1');
    // Les médias cités : l'image générée et la vidéo terminée (pas besoin de les chercher à part).
    expect(loaded.media.map((m) => m.id).sort()).toEqual([image.id, video.id].sort());
    expect(loaded.media.find((m) => m.id === image.id)).toMatchObject({ kind: 'image', alt: 'Un phare' });
    expect(loaded.media.find((m) => m.id === video.id)).toMatchObject({ kind: 'video', url: null });
  });

  it('une conversation sans génération n’a ni vidéo ni média supplémentaire', async () => {
    const saved = (await demoRepositories.agent.saveExchange({ threadId: null, title: 'Simple', user: { text: 'Salut', mediaIds: [] }, assistant: { text: 'Bonjour', proposals: [], mediaIds: [], jobIds: [] } }))!;
    expect(await loadThread(demoRepositories, saved.thread.id)).toMatchObject({ jobs: [], media: [] });
    expect(await loadThread(demoRepositories, 'fantome')).toBeNull();
  });
});
