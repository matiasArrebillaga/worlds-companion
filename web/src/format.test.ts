import { describe, expect, it } from 'vitest';
import {
  countdownParts, formatDayHeading, formatPercent, formatTime, isStale, localDayKey, relativeTime, roundLabel,
} from './format';

const BA = 'America/Argentina/Buenos_Aires';

describe('formatTime', () => {
  it('shows local time', () => {
    expect(formatTime('2026-10-24T17:00:00Z', BA)).toBe('14:00');
  });
  it('never invents a time', () => {
    expect(formatTime(null, BA)).toBe('a confirmar');
  });
});

describe('localDayKey', () => {
  it('moves late UTC matches to the previous local day', () => {
    expect(localDayKey('2026-10-24T02:00:00Z', BA)).toBe('2026-10-23');
    expect(localDayKey('2026-10-24T17:00:00Z', BA)).toBe('2026-10-24');
  });
});

describe('formatDayHeading', () => {
  it('formats in Spanish', () => {
    const text = formatDayHeading('2026-10-24');
    expect(text).toContain('24');
    expect(text.toLowerCase()).toContain('octubre');
    expect(text.toLowerCase()).toContain('sábado');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-24T18:00:00Z');
  it('handles minutes, hours and days', () => {
    expect(relativeTime('2026-10-24T17:59:40Z', now)).toBe('hace un momento');
    expect(relativeTime('2026-10-24T17:42:00Z', now)).toBe('hace 18 min');
    expect(relativeTime('2026-10-24T15:00:00Z', now)).toBe('hace 3 h');
    expect(relativeTime('2026-10-23T12:00:00Z', now)).toBe('hace 1 día');
    expect(relativeTime('2026-10-21T12:00:00Z', now)).toBe('hace 3 días');
  });
});

describe('isStale', () => {
  const now = new Date('2026-10-24T18:00:00Z');
  it('only warns on match days after 3 hours', () => {
    expect(isStale('2026-10-24T14:00:00Z', now, true)).toBe(true);
    expect(isStale('2026-10-24T16:00:00Z', now, true)).toBe(false);
    expect(isStale('2026-10-24T14:00:00Z', now, false)).toBe(false);
  });
});

describe('roundLabel', () => {
  it('translates known rounds', () => {
    expect(roundLabel('Round 3')).toBe('Ronda 3');
    expect(roundLabel('Quarterfinals')).toBe('Cuartos de final');
    expect(roundLabel('Semifinals')).toBe('Semifinales');
    expect(roundLabel('Finals')).toBe('Final');
    expect(roundLabel('Tiebreaker')).toBe('Tiebreaker');
  });
});

describe('countdownParts', () => {
  it('splits milliseconds and never goes negative', () => {
    expect(countdownParts((2 * 3600 + 14 * 60 + 36) * 1000)).toEqual({ h: 2, m: 14, s: 36 });
    expect(countdownParts(-5000)).toEqual({ h: 0, m: 0, s: 0 });
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(0.6407)).toBe('64%');
    expect(formatPercent(0.5)).toBe('50%');
  });
  it('never shows certainty', () => {
    expect(formatPercent(0.999)).toBe('99%');
    expect(formatPercent(0.002)).toBe('1%');
  });
});
