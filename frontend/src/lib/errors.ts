/** The text to show for anything thrown: the server's own message for API errors, else the error's message. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
