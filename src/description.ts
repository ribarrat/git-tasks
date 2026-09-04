/**
 * Pure text helpers for task descriptions — kept free of `vscode` imports so
 * the editor, the hover renderer and the tests can all share one implementation.
 */

export const DESCRIPTION_HEADER_MARK = 'git-tasks:description';

export const DESCRIPTION_HEADER = `<!-- ${DESCRIPTION_HEADER_MARK}
Write the task description below, then SAVE this file to apply it.
Close it without saving to cancel. This comment is stripped automatically.
Markdown works: line breaks, lists, and [links](https://example.com).
-->

`;

/**
 * Remove the instruction banner prepended to the scratch buffer, leaving only
 * what the user wrote. Only our own marked block is stripped — an HTML comment
 * the user types themselves is part of their description and survives.
 */
export function stripDescriptionHeader(text: string): string {
  const re = new RegExp(`^\\s*<!--\\s*${DESCRIPTION_HEADER_MARK}[\\s\\S]*?-->\\n?`);
  return text.replace(re, '').trim();
}

/**
 * Markdown folds a lone newline into a space. Descriptions are written in a
 * plain editor where a line break is meant literally, so promote single
 * newlines to hard breaks while leaving blank-line paragraphs (and therefore
 * lists, quotes and fenced blocks) intact.
 */
export function preserveLineBreaks(s: string): string {
  return s.replace(/([^\n])\n(?!\n)/g, '$1  \n');
}

/**
 * The hover renders with `supportHtml`, so any user-authored string has to be
 * escaped before it reaches the markdown. Markdown links keep working — this
 * only defuses raw HTML.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
