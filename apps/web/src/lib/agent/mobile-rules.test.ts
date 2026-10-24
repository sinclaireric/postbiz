import { describe, expect, it } from 'vitest';
import { proposalProblems } from '../../../../mobile/lib/agent-rules';
import type { NetworkId } from '@/lib/inbox/types';
import { validatePost } from '@/lib/posts/logic';

// Le mobile applique les règles de l'agent avec son propre code (`apps/mobile/lib/agent-rules.ts`) : ce test le compare à `validatePost` du web sur une grille de
// cas (réseau × texte × médias × date × premier commentaire × mode). Pour chaque cas, les deux doivent s'accorder sur « enregistrable » ou « refusé ».

const now = new Date('2026-10-27T10:00:00Z');
const NETWORKS: NetworkId[] = ['facebook', 'instagram', 'instagram_standalone', 'x', 'linkedin', 'linkedin_page', 'tiktok', 'youtube'];
const TEXTS = ['', '   ', 'Atelier ouvert samedi', 'a'.repeat(280), 'a'.repeat(281), '🎉'.repeat(140), '🎉'.repeat(141), 'a'.repeat(1_250), 'a'.repeat(2_200), 'a'.repeat(2_201), 'a'.repeat(3_000), 'a'.repeat(3_001), 'a'.repeat(5_001)];
const COMMENTS = ['', 'Adresse en commentaire', 'a'.repeat(280), 'a'.repeat(281), 'a'.repeat(1_250), 'a'.repeat(1_251), 'a'.repeat(8_001)];
const DATES: (Date | null)[] = [null, new Date('2026-10-27T09:00:00Z'), new Date('2026-10-27T10:00:30Z'), new Date('2026-10-27T10:02:00Z'), new Date('2026-11-02T08:00:00Z')];

describe('règles de l’agent : le mobile et le web s’accordent', () => {
  for (const network of NETWORKS) {
    it(network, () => {
      let cases = 0;
      // Les médias ne sont joints que là où le worker sait les publier : ailleurs, leurs règles viennent de `validateMedia`, que le mobile reçoit en argument.
      const mediaCounts = network === 'facebook' || network.startsWith('instagram') ? [0, 1] : [0];
      for (const mode of ['draft', 'schedule'] as const) {
        for (const text of TEXTS) {
          for (const firstComment of COMMENTS) {
            for (const mediaCount of mediaCounts) {
              for (const date of DATES) {
                const web = validatePost({
                  content: text, networkIds: [network], publishAt: date ? date.toISOString() : null, mode, firstComment, now,
                  media: Array.from({ length: mediaCount }, () => ({ kind: 'image' as const, width: 1080, height: 1350, name: 'a.jpg' })),
                });
                const mobile = proposalProblems({ network, label: network, text, firstComment, mediaCount, mediaProblems: [], mode, publishAt: date, now });
                expect({ valid: mobile.length === 0, text: text.length, firstComment: firstComment.length, mediaCount, date, mode }).toEqual({ valid: web.length === 0, text: text.length, firstComment: firstComment.length, mediaCount, date, mode });
                cases++;
              }
            }
          }
        }
      }
      expect(cases).toBeGreaterThan(500);
    });
  }
});
