import { type Event } from 'nostr-tools'
import { type PublishedSharedSigner, type BaseSharedSigner } from '../types'
import { type Store } from '../service'
import { fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { Authenticator } from '@smontero/nostr-ual'
import { AuthenticatorType } from '../enum'

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
    if (!sharedSignersEvents.length) return []
    if (this.authenticator.getName() === AuthenticatorType.WebExtension) {
      return this.getSharedSignersSync(sharedSignersEvents)
    } else {
      return this.getSharedSignersAsync(sharedSignersEvents)
    }
  }

  private async getSharedSignersAsync<K extends number>(sharedSignersEvents: Array<Event<K>>): Promise<PublishedSharedSigner[]> {

    const signerPromises = sharedSignersEvents.map(async event => {
      const storeValue = this.store.get(event.id)
      if (storeValue) {
        return { signer: storeValue, rawEvent: event }
      }

      const baseDecryptedSigner: BaseSharedSigner = await this.authenticator.decryptObj(event.content, event.pubkey)
      const key = this.extractKey(baseDecryptedSigner.descriptor)
      const signer: PublishedSharedSigner = { ...baseDecryptedSigner, key, id: event.id, ownerPubKey: event.pubkey, createdAt: fromNostrDate(event.created_at) }

      return { signer, rawEvent: event }
    })
    const results = await Promise.allSettled(signerPromises)

    const validResults = results.reduce((acc, result) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(result.value);
      }
      return acc;
    }, [] as { signer: PublishedSharedSigner, rawEvent: Event<K> }[]);

    const signers = validResults.map(res => res.signer)
    const rawSignersEvents = validResults.map(res => res.rawEvent)

    this.store.store(signers)
    this.eventsStore.store(rawSignersEvents)

    return signers
  }

  private async getSharedSignersSync<K extends number>(sharedSignersEvents: Array<Event<K>>): Promise<PublishedSharedSigner[]> {
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
      const key = this.extractKey(baseDecryptedSigner.descriptor)
      const signer: PublishedSharedSigner = { ...baseDecryptedSigner, key, id: event.id, ownerPubKey: event.pubkey, createdAt: fromNostrDate(event.created_at) }
      signers.push(signer)
      rawSignersEvents.push(event)
    }
    this.store.store(signers)
    this.eventsStore.store(rawSignersEvents)
    return signers
  }

  private extractKey(descriptor: string): string {
    const matches = descriptor.match(/\((.*?)\)/)
    return matches ? matches[1] : ''
  }
}
