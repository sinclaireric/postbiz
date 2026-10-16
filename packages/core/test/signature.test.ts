import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeMetaSignature, verifyMetaChallenge, verifyMetaSignature } from '../src/index.ts';

const secret = 'app-secret';
const body = '{"object":"page","entry":[{"id":"1","time":1,"messaging":[]}]}';
const nodeSig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('signature des webhooks Meta', () => {
  it('calcule la même signature que HMAC-SHA256 de Node', async () => {
    expect(await computeMetaSignature(body, secret)).toBe(nodeSig);
  });

  it('accepte une signature valide', async () => {
    expect(await verifyMetaSignature(body, nodeSig, secret)).toBe(true);
  });

  it('refuse un corps modifié, un mauvais secret, un en-tête absent ou mal formé', async () => {
    expect(await verifyMetaSignature(body + ' ', nodeSig, secret)).toBe(false);
    expect(await verifyMetaSignature(body, nodeSig, 'autre')).toBe(false);
    expect(await verifyMetaSignature(body, null, secret)).toBe(false);
    expect(await verifyMetaSignature(body, 'sha1=abc', secret)).toBe(false);
    expect(await verifyMetaSignature(body, nodeSig, '')).toBe(false);
  });
});

describe('handshake d’abonnement', () => {
  const params = (o: Record<string, string>) => new URLSearchParams(o);
  it('renvoie le challenge quand le jeton est bon', () => {
    expect(verifyMetaChallenge(params({ 'hub.mode': 'subscribe', 'hub.verify_token': 't', 'hub.challenge': '1234' }), 't')).toBe('1234');
  });
  it('refuse un mauvais jeton, un mauvais mode, ou une configuration vide', () => {
    expect(verifyMetaChallenge(params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '1' }), 't')).toBeNull();
    expect(verifyMetaChallenge(params({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 't', 'hub.challenge': '1' }), 't')).toBeNull();
    expect(verifyMetaChallenge(params({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }), '')).toBeNull();
  });
});
