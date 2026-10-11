import { describe, expect, it } from 'vitest';
import { championIcon, setChampionIcons } from './champions';

describe('championIcon', () => {
  it('builds the Data Dragon URL from the image id, not the display name', () => {
    setChampionIcons({ base: 'https://cdn/16.20.1/img/champion/', ids: { Wukong: 'MonkeyKing' } });
    expect(championIcon('Wukong')).toBe('https://cdn/16.20.1/img/champion/MonkeyKing.png');
    expect(championIcon('Nadie')).toBeNull();
  });

  it('has no icons until the data says so', () => {
    setChampionIcons(null);
    expect(championIcon('Wukong')).toBeNull();
  });
});
