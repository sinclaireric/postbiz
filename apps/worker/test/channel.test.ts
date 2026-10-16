import { describe, expect, it } from 'vitest';
import { buildChannelRows, parseAddChannelArgs } from '../src/channel.ts';

const base = ['--org', 'o1', '--provider', 'facebook', '--internal-id', 'PAGE1', '--name', 'Ma Page', '--token', 'EAAB-secret'];

describe('add-channel', () => {
  it('lit les arguments', () => {
    expect(parseAddChannelArgs(base)).toMatchObject({ org: 'o1', provider: 'facebook', internalId: 'PAGE1', name: 'Ma Page', token: 'EAAB-secret' });
  });
  it('lit les réglages JSON', () => {
    expect(parseAddChannelArgs([...base, '--settings', '{"human_agent_enabled":true}']).settings).toEqual({ human_agent_enabled: true });
  });
  it('refuse un argument manquant, un réseau inconnu ou un JSON invalide', () => {
    expect(() => parseAddChannelArgs(base.slice(2))).toThrow(/--org/);
    expect(() => parseAddChannelArgs(['--org', 'o', '--provider', 'myspace', '--internal-id', 'x', '--name', 'n', '--token', 't'])).toThrow(/inconnu/);
    expect(() => parseAddChannelArgs([...base, '--settings', '{pas du json'])).toThrow(/JSON/);
    expect(() => parseAddChannelArgs([...base, '--username'])).toThrow(/manquante/);
  });
  it('ne stocke jamais le jeton en clair', async () => {
    const rows = await buildChannelRows(parseAddChannelArgs(base), async (p) => `enc(${p.length})`);
    expect(JSON.stringify(rows)).not.toContain('EAAB-secret');
    expect(rows.accessTokenEnc).toBe('enc(11)');
    expect(rows.integration).toMatchObject({ org_id: 'o1', provider: 'facebook', internal_id: 'PAGE1', status: 'active' });
  });
});
