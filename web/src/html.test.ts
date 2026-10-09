import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<b>"T1" & 'G2'</b>`)).toBe('&lt;b&gt;&quot;T1&quot; &amp; &#39;G2&#39;&lt;/b&gt;');
  });
});
