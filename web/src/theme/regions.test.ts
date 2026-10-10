import { describe, expect, it } from 'vitest';
import { regionColor, setRegions, teamRegionColor } from './regions';

describe('regionColor', () => {
  it('uses the region variable, or a neutral one for unknown regions', () => {
    expect(regionColor('KR')).toBe('var(--region-kr)');
    expect(regionColor('APAC')).toBe('var(--region-apac)');
    expect(regionColor('VN')).toBe('var(--region-other)');
    expect(regionColor(null)).toBe('var(--region-other)');
  });

  it('finds the region of a team by name', () => {
    setRegions([{ name: 'T1', short: 'T1', region: 'KR', rating: 1600, games: 40 }]);
    expect(teamRegionColor('T1')).toBe('var(--region-kr)');
    expect(teamRegionColor('Unknown')).toBe('var(--region-other)');
  });
});
