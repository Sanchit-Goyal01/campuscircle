const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Replies are shown as plain text and must not show ids. Claude follows the
 * prompt's no-markdown rule, but smaller open models often do not, so the
 * final reply is cleaned here whatever the provider.
 */
export function toPlainText(reply: string): string {
  return (
    reply
      // "(action ID 65e2...)" and similar asides holding an id go entirely.
      .replace(new RegExp(`\\s*\\([^()]*${UUID}[^()]*\\)`, 'gi'), '')
      .replace(new RegExp(UUID, 'gi'), '')
      // Headings, horizontal rules and block quotes.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
      .replace(/^[ \t]*>[ \t]?/gm, '')
      // Bold, italic-by-underscore, inline code and links.
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
      // "* item" bullets read better as "- item".
      .replace(/^([ \t]*)\*[ \t]+/gm, '$1- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
