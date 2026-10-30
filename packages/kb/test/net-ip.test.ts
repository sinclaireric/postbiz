import { describe, expect, it } from 'vitest';
import { isIpLiteral, isPublicIp, parseIPv4, parseIPv6 } from '../src/net/ip.ts';

describe('parseIPv4 : notation décimale pointée stricte', () => {
  it.each([
    ['1.2.3.4', [1, 2, 3, 4]], ['0.0.0.0', [0, 0, 0, 0]], ['255.255.255.255', [255, 255, 255, 255]],
  ] as const)('%s', (input, bytes) => expect(parseIPv4(input)).toEqual(bytes));

  it.each(['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-4', '01.2.3.4', '1.2.3.04', '1.2.3.4 ', 'a.b.c.d', '1..2.3', '0x7f.0.0.1', '2130706433', '1.2.3.4/8'])(
    'refuse %j', (input) => expect(parseIPv4(input)).toBeNull(),
  );
});

describe('parseIPv6', () => {
  it('lit les formes compressées et complètes', () => {
    expect(parseIPv6('::')).toEqual(Array(16).fill(0));
    expect(parseIPv6('::1')).toEqual([...Array(15).fill(0), 1]);
    expect(parseIPv6('1::')).toEqual([0, 1, ...Array(14).fill(0)]);
    expect(parseIPv6('2001:db8::8:800:200c:417a')).toEqual([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 8, 8, 0, 0x20, 0x0c, 0x41, 0x7a]);
    expect(parseIPv6('2001:0db8:0000:0000:0008:0800:200c:417a')).toEqual(parseIPv6('2001:db8::8:800:200c:417a'));
    expect(parseIPv6('FE80::1')).toEqual(parseIPv6('fe80::1'));
  });

  it('lit une adresse IPv4 intégrée', () => {
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual([...Array(10).fill(0), 0xff, 0xff, 1, 2, 3, 4]);
    expect(parseIPv6('64:ff9b::192.0.2.33')).toEqual([0, 0x64, 0xff, 0x9b, ...Array(8).fill(0), 192, 0, 2, 33]);
  });

  it.each(['', ':', ':::', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1::2::3', 'g::1', '12345::1', '::1.2.3', '1.2.3.4::', '::ffff:1.2.3.256', 'fe80::1%eth0', '1:2:3:4:5:6:7::8', '[::1]'])(
    'refuse %j', (input) => expect(parseIPv6(input)).toBeNull(),
  );
});

describe('isPublicIp : le contrôle qui protège le serveur', () => {
  describe('IPv4 non publiques', () => {
    it.each([
      // ce réseau, boucle locale
      '0.0.0.0', '0.1.2.3', '127.0.0.1', '127.255.255.254',
      // privées
      '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
      // liaison locale et métadonnées des clouds
      '169.254.0.1', '169.254.169.254', '169.254.170.2', '169.254.255.255',
      // opérateurs (CGNAT), métadonnées d'Alibaba
      '100.64.0.1', '100.100.100.200', '100.127.255.255',
      // protocoles IETF (métadonnées d'Oracle), documentation, mesures, relais 6to4
      '192.0.0.192', '192.0.0.1', '192.0.2.5', '198.51.100.5', '203.0.113.5', '198.18.0.1', '198.19.255.255', '192.88.99.1',
      // multicast, réservées, diffusion
      '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
      // service d'infrastructure d'Azure
      '168.63.129.16',
    ])('%s est refusée', (ip) => expect(isPublicIp(ip)).toBe(false));

    it.each(['172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0', '169.253.255.255', '169.255.0.0', '11.0.0.1', '192.167.255.255', '192.169.0.0', '198.17.255.255', '198.20.0.0', '168.63.129.15', '168.63.129.17', '223.255.255.255'])(
      '%s, juste à côté d’une plage privée, est permise', (ip) => expect(isPublicIp(ip)).toBe(true),
    );

    it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '151.101.1.69', '185.199.108.153'])('%s est permise', (ip) => expect(isPublicIp(ip)).toBe(true));
  });

  describe('IPv6 non publiques', () => {
    it.each([
      '::', '::1', '::2', '::ffff', '::1.2.3.4', // non spécifiée, boucle, IPv4 « compatible »
      'fc00::1', 'fd00:ec2::254', 'fdff::1', // unique-locales (dont les métadonnées d'AWS en IPv6)
      'fe80::1', 'febf::1', 'fec0::1', // liaison locale, ancienne « site-locale »
      'ff02::1', 'ff00::', // multicast
      '100::1', '64:ff9b:1::1', // abandon, NAT64 à usage local
      '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:10::1', '2001:1ff:ffff::1', // Teredo, ORCHID, protocoles IETF
      '2001:db8::1', '2002::1', '2002:7f00:1::1', '3ffe::1', '3fff::1', // documentation, 6to4, 6bone
      '4000::1', '8000::1', 'a000::1', // hors de l'unicast global
    ])('%s est refusée', (ip) => expect(isPublicIp(ip)).toBe(false));

    it.each([
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:192.168.1.1', '[::ffff:c0a8:101]', // IPv4 privée « mappée »
      '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b::a9fe:a9fe', // NAT64 vers une IPv4 privée
    ])('%s (IPv4 privée dans IPv6) est refusée', (ip) => expect(isPublicIp(ip)).toBe(false));

    it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4007:80f::200e', '2001:200::1', '[2606:4700:4700::1111]', '3000::1'])(
      '%s est permise', (ip) => expect(isPublicIp(ip)).toBe(true),
    );

    it('une IPv4 publique « mappée » ou en NAT64 est permise', () => {
      expect(isPublicIp('::ffff:8.8.8.8')).toBe(true);
      expect(isPublicIp('::ffff:808:808')).toBe(true);
      expect(isPublicIp('64:ff9b::8.8.8.8')).toBe(true);
    });
  });

  it('ce qui n’est pas une adresse IP est refusé', () => {
    for (const s of ['', 'localhost', 'example.com', '1.2.3', '1.2.3.4.5', '0x7f.0.0.1', '2130706433', '0177.0.0.1', '127.1', 'fe80::1%en0', ' ']) expect(isPublicIp(s)).toBe(false);
  });

  it('isIpLiteral reconnaît les adresses, crochets compris', () => {
    for (const s of ['1.2.3.4', '::1', '[::1]', '[2606:4700::1111]', '::ffff:1.2.3.4']) expect(isIpLiteral(s)).toBe(true);
    for (const s of ['example.com', '1.2.3', 'a.b.c.d', '', '127.1']) expect(isIpLiteral(s)).toBe(false);
  });
});
