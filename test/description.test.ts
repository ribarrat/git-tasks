import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_HEADER,
  escapeHtml,
  preserveLineBreaks,
  stripDescriptionHeader,
} from '../src/description';

describe('stripDescriptionHeader', () => {
  it('removes the banner and returns only the body', () => {
    const body = 'longer text with enters\nhow does this work?';
    expect(stripDescriptionHeader(DESCRIPTION_HEADER + body)).toBe(body);
  });

  it('handles an empty body', () => {
    expect(stripDescriptionHeader(DESCRIPTION_HEADER)).toBe('');
  });

  it('leaves text alone when the banner is absent', () => {
    expect(stripDescriptionHeader('just a description')).toBe('just a description');
  });

  it("keeps the user's own HTML comments", () => {
    const body = '<!-- my own note -->\nreal text';
    expect(stripDescriptionHeader(DESCRIPTION_HEADER + body)).toBe(body);
  });

  it('only strips the banner, not a later comment that mentions the marker', () => {
    const body = 'text\n\n<!-- git-tasks:description in a quote -->';
    expect(stripDescriptionHeader(DESCRIPTION_HEADER + body)).toBe(body);
  });

  it('preserves interior blank lines while trimming the edges', () => {
    const body = 'para one\n\npara two';
    expect(stripDescriptionHeader(DESCRIPTION_HEADER + body + '\n\n')).toBe(body);
  });
});

describe('preserveLineBreaks', () => {
  it('turns a single newline into a markdown hard break', () => {
    expect(preserveLineBreaks('one\ntwo')).toBe('one  \ntwo');
  });

  it('leaves paragraph breaks untouched', () => {
    expect(preserveLineBreaks('one\n\ntwo')).toBe('one\n\ntwo');
  });

  it('keeps list items on their own lines', () => {
    expect(preserveLineBreaks('- a\n- b')).toBe('- a  \n- b');
  });

  it('is a no-op for single-line text', () => {
    expect(preserveLineBreaks('just one line')).toBe('just one line');
  });
});

describe('escapeHtml', () => {
  it('neutralises raw HTML', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('escapes ampersands before angle brackets', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });

  it('leaves markdown links intact', () => {
    const link = '[docs](https://example.com/d)';
    expect(escapeHtml(link)).toBe(link);
  });
});
