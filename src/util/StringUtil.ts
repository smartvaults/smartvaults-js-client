
export class StringUtil {
  static emptyToUndefined(str?: string): string | undefined {
    if (!str || !str.trim()) {
      return undefined
    }
    return str
  }

  static isString(value: any): value is string {
    return typeof value === 'string';
  }
}