import { describe, expect, it } from 'vitest';
import { regionColor, setTeams, teamMark, teamRegionColor } from './regions';

describe('regionColor', () => {
  it('uses the region variable, or a neutral one for unknown regions', () => {
    expect(regionColor('KR')).toBe('var(--region-kr)');
    expect(regionColor('APAC')).toBe('var(--region-apac)');
    expect(regionColor('VN')).toBe('var(--region-other)');
    expect(regionColor(null)).toBe('var(--region-other)');
  });

  it('finds the region of a team by name', () => {
    setTeams([{ name: 'T1', short: 'T1', region: 'KR', rating: 1600, games: 40 }]);
    expect(teamRegionColor('T1')).toBe('var(--region-kr)');
    expect(teamRegionColor('Unknown')).toBe('var(--region-other)');
  });

  it('shows the logo when there is one, and the region diamond otherwise', () => {
    setTeams([
      { name: 'T1', short: 'T1', region: 'KR', logo: 'img/teams/t1.png', rating: 1600, games: 40 },
      { name: 'Cloud9', short: 'C9', region: 'NA', logo: null, rating: 1400, games: 40 },
    ]);
    expect(teamMark('T1')).toContain('img/teams/t1.png');
    expect(teamMark('Cloud9')).toContain('class="rg"');
  });
});
