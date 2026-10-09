import { describe, expect, it } from 'vitest';
import { isNewer } from './data';

const meta = (updated_at: string) => ({ updated_at, source_fetched_at: '2026-10-24T10:00:00Z', match_count: 1 });

describe('isNewer', () => {
  it('detects a later pipeline run', () => {
    expect(isNewer(meta('2026-10-24T17:00:00Z'), meta('2026-10-24T18:00:00Z'))).toBe(true);
  });
  it('ignores the same or an older run', () => {
    expect(isNewer(meta('2026-10-24T18:00:00Z'), meta('2026-10-24T18:00:00Z'))).toBe(false);
    expect(isNewer(meta('2026-10-24T18:00:00Z'), meta('2026-10-24T17:00:00Z'))).toBe(false);
  });
});
