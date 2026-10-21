import { describe, expect, it } from 'vitest';
import { createLimiter } from './rate-limit';

describe('limite d’appels', () => {
  it('refuse au-delà du maximum dans la fenêtre, puis ré-accepte', () => {
    let now = 0;
    const limiter = createLimiter(2, 1_000, () => now);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    now = 1_001;
    expect(limiter.take('a')).toBe(true);
  });

  it('compte chaque utilisateur séparément', () => {
    const limiter = createLimiter(1, 1_000, () => 0);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('b')).toBe(true);
    expect(limiter.take('a')).toBe(false);
  });
});
