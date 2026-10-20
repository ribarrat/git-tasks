import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_HEADER,
  DescriptionEffects,
  EDITOR_DISMISSED_MESSAGE,
  looksFlattened,
  InlineOutcome,
  resolveDescription,
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

describe('resolveDescription', () => {
  interface Calls {
    editorOpenedWith: string[];
    notified: string[];
  }

  const effects = (
    inline: InlineOutcome,
    editorResult?: string | undefined,
  ): { fx: DescriptionEffects; calls: Calls } => {
    const calls: Calls = { editorOpenedWith: [], notified: [] };
    return {
      calls,
      fx: {
        askInline: async () => inline,
        askEditor: async (initial: string) => {
          calls.editorOpenedWith.push(initial);
          return editorResult;
        },
        notify: (m: string) => calls.notified.push(m),
      },
    };
  };

  it('returns the trimmed inline value when accepted', async () => {
    const { fx, calls } = effects({ kind: 'accept', value: '  short note  ' });
    await expect(resolveDescription('', fx)).resolves.toBe('short note');
    expect(calls.editorOpenedWith).toEqual([]);
  });

  it('returns empty string when the box is accepted empty', async () => {
    const { fx } = effects({ kind: 'accept', value: '   ' });
    await expect(resolveDescription('', fx)).resolves.toBe('');
  });

  it('cancels the caller when the inline box is dismissed', async () => {
    const { fx, calls } = effects(undefined);
    await expect(resolveDescription('prior', fx)).resolves.toBeUndefined();
    expect(calls.editorOpenedWith).toEqual([]);
    expect(calls.notified).toEqual([]);
  });

  it('hands the editor what was already typed', async () => {
    const { fx, calls } = effects({ kind: 'editor', value: 'half a thought' }, 'finished');
    await resolveDescription('', fx);
    expect(calls.editorOpenedWith).toEqual(['half a thought']);
  });

  it('returns what the editor saved', async () => {
    const body = 'line one\n\n- a\n- b';
    const { fx } = effects({ kind: 'editor', value: 'seed' }, body);
    await expect(resolveDescription('', fx)).resolves.toBe(body);
  });

  it('accepts an empty save as clearing the description', async () => {
    const { fx, calls } = effects({ kind: 'editor', value: 'seed' }, '');
    await expect(resolveDescription('', fx)).resolves.toBe('');
    expect(calls.notified).toEqual([]);
  });

  // The regression that shipped once: a dismissed editor was read as "cancel",
  // which aborted the whole add flow and discarded the task.
  it('keeps the typed text and warns when the editor closes unsaved', async () => {
    const { fx, calls } = effects({ kind: 'editor', value: '  kept  ' }, undefined);
    await expect(resolveDescription('', fx)).resolves.toBe('kept');
    expect(calls.notified).toEqual([EDITOR_DISMISSED_MESSAGE]);
  });

  it('never cancels the caller once the editor has been opened', async () => {
    const { fx } = effects({ kind: 'editor', value: '' }, undefined);
    await expect(resolveDescription('', fx)).resolves.not.toBeUndefined();
  });
});

describe('looksFlattened', () => {
  it('flags the exact run-on a pasted markdown block produces', () => {
    // Verbatim from the smoke test: a block pasted into the input box.
    expect(
      looksFlattened(
        'Hard-coded in two places.- [ ] move to config- [ ] add a testSee [pricing docs](https://example.com/pricing)',
      ),
    ).toBe(true);
  });

  it('flags a heading folded into the middle of a line', () => {
    expect(looksFlattened('Intro text## Detailsmore')).toBe(true);
  });

  it('flags an implausibly long single line', () => {
    expect(looksFlattened('x'.repeat(201))).toBe(true);
    expect(looksFlattened('x'.repeat(200))).toBe(false);
  });

  it('stays quiet for ordinary one-line descriptions', () => {
    expect(looksFlattened('Tax rate is hard-coded')).toBe(false);
    expect(looksFlattened('')).toBe(false);
    expect(looksFlattened('Fix the parser - it chokes on empty input')).toBe(false);
    expect(looksFlattened('See [docs](https://example.com) for context')).toBe(false);
  });

  it('stays quiet when the text still has its newlines', () => {
    // Came from the editor, so nothing was lost — never warn here.
    expect(looksFlattened('Intro.\n\n- [ ] a\n- [ ] b')).toBe(false);
    expect(looksFlattened('x'.repeat(300) + '\nmore')).toBe(false);
  });

  it('does not flag a checkbox that legitimately starts the value', () => {
    expect(looksFlattened('- [ ] single item')).toBe(false);
  });
});
