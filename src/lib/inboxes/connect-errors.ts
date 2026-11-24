// Short codes for Gmail connection failures. Only codes travel in URLs (?inbox_error=<code>), so a
// crafted link can never put arbitrary text on the settings page. The UI renders through
// inboxErrorMessage only.

export const INBOX_ERROR_MESSAGES = {
  not_set_up: "Gmail connection is not set up yet.",
  no_permission: "You do not have permission to connect an inbox.",
  declined: "Google did not connect the inbox. Try again.",
  mismatch: "The connection request expired or did not match. Try again.",
  scopes: "Gmail did not grant every permission RGE needs. Connect again and allow all permissions.",
  teammate: "This inbox is already connected by a teammate.",
  teammate_before: "This inbox was connected by a teammate before. Ask an Owner or Admin.",
  failed: "Gmail could not be connected. Try again.",
} as const;

export type InboxErrorCode = keyof typeof INBOX_ERROR_MESSAGES;

const GENERIC = INBOX_ERROR_MESSAGES.failed;

const isCode = (code: string): code is InboxErrorCode => Object.prototype.hasOwnProperty.call(INBOX_ERROR_MESSAGES, code);

/** The copy for an inbox_error code: mapped text, a generic message for unknown codes, null for none. */
export function inboxErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return isCode(code) ? INBOX_ERROR_MESSAGES[code] : GENERIC;
}
