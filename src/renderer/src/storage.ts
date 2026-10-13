// Small lists the window remembers between launches (recent files, folders you opened up).

/** A list of strings saved in localStorage; anything unreadable counts as empty. */
export function readList(key: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
