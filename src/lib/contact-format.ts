import type { ContactItem } from '../types.js'

/**
 * contact_links를 "key: value" 쌍의 배열로 정규화한다.
 * - 배열 형식 (신규): [{type, label, value}, ...] → ["label: value", ...]
 * - 객체 형식 (레거시): {email: "a@b"} → ["email: a@b", ...]
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
