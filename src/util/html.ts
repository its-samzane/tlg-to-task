/** Escapes text for Telegram's HTML parse mode. */
export function escapeHtml(value: string | number): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
