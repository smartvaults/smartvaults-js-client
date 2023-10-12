import { type Event } from 'nostr-tools'
import { type BaseSharedSigner } from '../models'
import { type PublishedSharedSigner } from '../types'
import { type Store } from '../service'
import { fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { Authenticator } from '@smontero/nostr-ual'
import { AuthenticatorType, NetworkType } from '../enum'

export class SharedSignerHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly authenticator!: Authenticator
  private readonly extractKey: (descriptor: string) => string
  private readonly network: NetworkType
  constructor(authenticator: Authenticator, store: Store, eventsStore: Store, network: NetworkType, extractKey: (descriptor: string) => string) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.authenticator = authenticator
    this.network = network
    this.extractKey = extractKey
  }

  protected async _handle<K extends number>(sharedSignersEvents: Array<Event<K>>): Promise<PublishedSharedSigner[]> {
    if (!sharedSignersEvents.length) return []
    const networkFilter = this.network === NetworkType.Bitcoin ? 'xpub' : 'tpub'
    if (this.authenticator.getName() === AuthenticatorType.WebExtension) {
      return this.getSharedSignersSync(sharedSignersEvents, networkFilter)
    } else {
      return this.getSharedSignersAsync(sharedSignersEvents, networkFilter)
    }
  }

  private async getSharedSignersAsync<K extends number>(sharedSignersEvents: Array<Event<K>>, networkFilter: string): Promise<PublishedSharedSigner[]> {

    const signerPromises = sharedSignersEvents.map(async event => {
      const storeValue = this.store.get(event.id)
      if (storeValue) {
        return { signer: storeValue, rawEvent: event }
      }

      const baseDecryptedSigner: BaseSharedSigner = await this.authenticator.decryptObj(event.content, event.pubkey)
      if (!baseDecryptedSigner.descriptor.includes(networkFilter)) return null
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

  private async getSharedSignersSync<K extends number>(sharedSignersEvents: Array<Event<K>>, networkFilter: string): Promise<PublishedSharedSigner[]> {
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
      if (!baseDecryptedSigner.descriptor.includes(networkFilter)) continue
      const key = this.extractKey(baseDecryptedSigner.descriptor)
      const signer: PublishedSharedSigner = { ...baseDecryptedSigner, key, id: event.id, ownerPubKey: event.pubkey, createdAt: fromNostrDate(event.created_at) }
      signers.push(signer)
      rawSignersEvents.push(event)
    }
    this.store.store(signers)
    this.eventsStore.store(rawSignersEvents)
    return signers
  }

}
