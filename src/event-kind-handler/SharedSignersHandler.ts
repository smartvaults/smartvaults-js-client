import { type Event } from 'nostr-tools'
import { type PublishedSharedSigner, type BaseSharedSigner } from '../types'
import { type Store } from '../service'
import { fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type Authenticator } from '@smontero/nostr-ual'

export class SharedSignerHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly authenticator!: Authenticator
  constructor(authenticator: Authenticator, store: Store, eventsStore: Store) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.authenticator = authenticator
  }

  protected async _handle<K extends number>(sharedSignersEvents: Array<Event<K>>): Promise<PublishedSharedSigner[]> {
    const signers: PublishedSharedSigner[] = []
    const rawSignersEvents: Array<Event<K>> = []
    for (const event of sharedSignersEvents) {
      const storeValue = this.store.get(event.id)
      if (storeValue) {
        signers.push(storeValue)
        rawSignersEvents.push(event)
        continue
      }
      const baseDecryptedSigner: BaseSharedSigner = await this.authenticator.decryptObj(event.content, event.pubkey)
      const signer: PublishedSharedSigner = { ...baseDecryptedSigner, id: event.id, ownerPubKey: event.pubkey, createdAt: fromNostrDate(event.created_at) }
      signers.push(signer)
      rawSignersEvents.push(event)
    }
    this.store.store(signers)
    this.eventsStore.store(rawSignersEvents)
    return signers
  }
}
