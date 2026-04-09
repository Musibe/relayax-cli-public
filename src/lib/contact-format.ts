import type { ContactItem } from '../types.js'

/**
 * Normalize contact_links to an array of "key: value" pairs.
 * - Array format (new): [{type, label, value}, ...] → ["label: value", ...]
 * - Object format (legacy): {email: "a@b"} → ["email: a@b", ...]
 */
export function formatContactParts(
  contactLinks: ContactItem[] | Record<string, string> | unknown
): string[] {
  if (!contactLinks) return []

  if (Array.isArray(contactLinks)) {
    return (contactLinks as ContactItem[])
      .filter((c) => c.value?.trim())
      .map((c) => `${c.label || c.type}: ${c.value}`)
  }

  if (typeof contactLinks === 'object') {
    return Object.entries(contactLinks as Record<string, string>)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .map(([k, v]) => `${k}: ${v}`)
  }

  return []
}
