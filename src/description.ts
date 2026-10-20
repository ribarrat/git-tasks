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

// ---------- Description prompt flow ----------

/**
 * What the inline input box came back with: the user accepted the text, asked
 * to move to a full editor, or dismissed the box.
 */
export type InlineOutcome =
  | { kind: 'accept'; value: string }
  | { kind: 'editor'; value: string }
  | undefined;

/**
 * The editor-shaped side effects the description prompt needs. Injecting them
 * keeps the branching below testable: the bug this guards against (treating a
 * dismissed editor as "cancel the whole task") was decision logic, not VS Code
 * behaviour, so it belongs in a unit test rather than an integration one.
 */
export interface DescriptionEffects {
  /** Show the single-line box; resolves undefined when dismissed. */
  askInline: (initial: string) => Promise<InlineOutcome>;
  /** Open the scratch buffer; resolves undefined when closed without saving. */
  askEditor: (initial: string) => Promise<string | undefined>;
  /** Tell the user something without blocking. */
  notify: (message: string) => void;
}

export const EDITOR_DISMISSED_MESSAGE =
  'git-tasks: description editor closed without saving — description left unchanged.';

/**
 * Resolve a description through the inline box and, optionally, the scratch
 * editor. Returns the text to store, or undefined to cancel the caller's flow.
 *
 * Dismissing the inline box cancels, matching every other prompt in the wizard.
 * Closing the scratch editor does not: it means "I didn't write a long one",
 * so the text already typed is kept and the user is told, rather than throwing
 * away a task they were part-way through creating.
 */
export async function resolveDescription(
  initial: string,
  fx: DescriptionEffects,
): Promise<string | undefined> {
  const action = await fx.askInline(initial);
  if (!action) return undefined;
  if (action.kind === 'accept') return action.value.trim();

  const edited = await fx.askEditor(action.value);
  if (edited !== undefined) return edited;

  fx.notify(EDITOR_DISMISSED_MESSAGE);
  return action.value.trim();
}
