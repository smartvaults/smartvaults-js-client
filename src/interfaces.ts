export interface BitcoinUtil {
  getKeysFromMiniscript(miniscript: string): string[]
  toDescriptor(miniscript: string): string
}
