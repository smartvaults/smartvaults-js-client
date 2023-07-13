import { type Event } from 'nostr-tools'
import { type PublishedOwnedSigner, type BaseOwnedSigner } from '../types'
import { type NostrClient, type Store } from '../service'
import { fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type Authenticator } from '@smontero/nostr-ual'
import { type BitcoinUtil } from '../models'

export class OwnedSignerHandler extends EventKindHandler {
  private readonly store: Store
  private readonly authenticator!: Authenticator
  constructor (_: NostrClient, authenticator: Authenticator, store: Store, __: BitcoinUtil) {
    super()
    this.store = store
    this.authenticator = authenticator
  }

  protected async _handle<K extends number>(ownedSignersEvents: Array<Event<K>>): Promise<PublishedOwnedSigner[]> {
    const signers: PublishedOwnedSigner[] = []
    for (const signersEvent of ownedSignersEvents) {
      const storeValue = this.store.get(signersEvent.id)
      if (storeValue) {
        signers.push(storeValue)
        continue
      }
      const baseDecryptedSigner: BaseOwnedSigner = await this.authenticator.decryptObj(signersEvent.content, signersEvent.pubkey)
      signers.push({ ...baseDecryptedSigner, id: signersEvent.id, ownerPubKey: signersEvent.pubkey, createdAt: fromNostrDate(signersEvent.created_at) })
    }
    this.store.store(signers)
    return signers
  }
}
