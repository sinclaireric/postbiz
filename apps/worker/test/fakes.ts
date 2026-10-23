import { vi } from 'vitest';
import type { WorkerConversation, WorkerDb, WorkerIntegration, WorkerPost } from '../src/engine/db.ts';

export const integration = (o: Partial<WorkerIntegration> = {}): WorkerIntegration => ({
  id: 'int-1', orgId: 'org-1', provider: 'facebook', internalId: 'PAGE1', name: 'Maison Lune', status: 'active', settings: {}, ...o,
});

export const post = (o: Partial<WorkerPost> = {}): WorkerPost => ({
  id: 'post-1', orgId: 'org-1', integrationId: 'int-1', content: 'Bonjour', media: [], settings: {}, createdBy: 'user-1', releaseId: null, firstComment: null, ...o,
});

export const conversation = (o: Partial<WorkerConversation> = {}): WorkerConversation => ({
  id: 'conv-1', integrationId: 'int-1', kind: 'dm', externalId: 'PAGE1:USER1', contactPlatformId: 'USER1',
  lastInboundAt: new Date(Date.now() - 3_600_000).toISOString(), replyWindowExpiresAt: new Date(Date.now() + 20 * 3_600_000).toISOString(), ...o,
});

/** Base factice : chaque méthode est un espion, avec des valeurs par défaut « tout va bien ». */
export function fakeDb(o: Partial<{ [K in keyof WorkerDb]: WorkerDb[K] }> = {}) {
  const db: WorkerDb = {
    getIntegration: vi.fn(async () => integration()),
    getAccessToken: vi.fn(async () => 'TOKEN'),
    markIntegrationRefreshNeeded: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    getChildren: vi.fn(async () => []),
    resolveMedia: vi.fn(async () => []),
    markPublished: vi.fn(async () => {}),
    markPostFailed: vi.fn(async () => {}),
    completeFirstComment: vi.fn(async () => {}),
    failFirstComment: vi.fn(async () => {}),
    getConversation: vi.fn(async () => conversation()),
    completeMessage: vi.fn(async () => {}),
    failMessage: vi.fn(async () => {}),
    ...o,
  };
  return db;
}
