
export class StringUtil {
  static emptyToUndefined(str?: string): string | undefined {
    if (!str || !str.trim()) {
      return undefined
    }
    return str
  }
}