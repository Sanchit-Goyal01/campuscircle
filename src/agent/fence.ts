/**
 * Neutralises any closing tag for `tags` in untrusted text, so the text cannot
 * escape the fence it is placed in. Used by the agent's <tool_data> fence and
 * by study help's <note_data> fence.
 */
export function neutralise(text: string, tags: string[]): string {
  const closing = new RegExp(`<\\/(\\s*)(${tags.join('|')})`, 'gi');
  return text.replace(closing, (_m, space: string, tag: string) => `&lt;/${space}${tag}`);
}
