import { generatePrivateKey, getPublicKey } from 'nostr-tools'

export class Keys {
  privateKey: string
  publicKey: string
  constructor(privateKey?: string) {
    this.privateKey = privateKey || generatePrivateKey()
    this.publicKey = getPublicKey(this.privateKey)
  }
}