/**
 * Neutralises any closing tag for `tags` in untrusted text, so the text cannot
 * escape the fence it is placed in. Used by the agent's <tool_data> fence and
 * by study help's <note_data> fence.
 */
export function neutralise(text: string, tags: string[]): string {
  const alt = tags.join('|');
  const closing = new RegExp(`<\\/(\\s*)(${alt})`, 'gi');
  // An opening tag could forge a second block (e.g. a fake note_page with another page number).
  const opening = new RegExp(`<(\\s*)(${alt})(?![a-z0-9_])`, 'gi');
  return text
    .replace(closing, (_m, space: string, tag: string) => `&lt;/${space}${tag}`)
    .replace(opening, (_m, space: string, tag: string) => `&lt;${space}${tag}`);
}
