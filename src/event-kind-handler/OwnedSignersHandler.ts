import { Kind, type Event } from 'nostr-tools'
import { type BaseOwnedSigner } from '../models'
import { type PublishedOwnedSigner } from '../types'
import { type Store, type NostrClient } from '../service'
import { buildEvent, fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type Authenticator } from '@smontero/nostr-ual'
import { TagType, AuthenticatorType, NetworkType } from '../enum'

export class OwnedSignerHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly authenticator!: Authenticator
  private readonly nostrClient: NostrClient
  private readonly network: NetworkType
  private readonly extractKey: (descriptor: string) => string
  constructor(authenticator: Authenticator, nostrClient: NostrClient, store: Store, eventsStore: Store, network: NetworkType, extractKey: (descriptor: string) => string) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.authenticator = authenticator
    this.nostrClient = nostrClient
    this.network = network
    this.extractKey = extractKey
  }

  protected async _handle<K extends number>(ownedSignersEvents: Array<Event<K>>): Promise<PublishedOwnedSigner[]> {
    const networkFilter = this.network === NetworkType.Bitcoin ? 'xpub' : 'tpub'
    if (this.authenticator.getName() === AuthenticatorType.WebExtension) {
      return this.getSignersSync(ownedSignersEvents, networkFilter)
    } else {
      return this.getSignersAsync(ownedSignersEvents, networkFilter)
    }
  }

  private async getSignersAsync<K extends number>(ownedSignersEvents: Array<Event<K>>, networkFilter: string): Promise<PublishedOwnedSigner[]> {

    const signerPromises = ownedSignersEvents.map(signersEvent => {
      const storeValue = this.store.get(signersEvent.id)
      if (storeValue) {
        return Promise.resolve({ signer: storeValue, rawEvent: signersEvent })
      }

      return this.authenticator.decryptObj(signersEvent.content, signersEvent.pubkey)
        .then(baseDecryptedSigner => {
          if (!baseDecryptedSigner.descriptor.includes(networkFilter)) return null
          const key = this.extractKey(baseDecryptedSigner.descriptor)
          const signer: PublishedOwnedSigner = {
            ...baseDecryptedSigner,
            key,
            id: signersEvent.id,
            ownerPubKey: signersEvent.pubkey,
            createdAt: fromNostrDate(signersEvent.created_at)
          }
          return { signer, rawEvent: signersEvent };
        })
        .catch(_ => null);
    })

    const results = await Promise.allSettled(signerPromises)

    const validResults = results.reduce((acc, result) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(result.value);
      }
      return acc;
    }, [] as { signer: PublishedOwnedSigner, rawEvent: Event<K> }[]);

    const signers = validResults.map(res => res.signer);
    const rawSignersEvents = validResults.map(res => res.rawEvent);

    this.store.store(signers);
    this.eventsStore.store(rawSignersEvents);

    return signers;
  }


  private async getSignersSync<K extends number>(ownedSignersEvents: Array<Event<K>>, networkFilter: string): Promise<PublishedOwnedSigner[]> {
    if (!ownedSignersEvents.length) return []
    const signers: PublishedOwnedSigner[] = []
    const rawSignersEvents: Array<Event<K>> = []
    for (const signersEvent of ownedSignersEvents) {
      const storeValue = this.store.get(signersEvent.id)
      if (storeValue) {
        signers.push(storeValue)
        rawSignersEvents.push(signersEvent)
        continue
      }
      const baseDecryptedSigner: BaseOwnedSigner = await this.authenticator.decryptObj(signersEvent.content, signersEvent.pubkey)
      if (!baseDecryptedSigner.descriptor.includes(networkFilter)) continue
      const key = this.extractKey(baseDecryptedSigner.descriptor)
      signers.push({ ...baseDecryptedSigner, key, id: signersEvent.id, ownerPubKey: signersEvent.pubkey, createdAt: fromNostrDate(signersEvent.created_at) })
      rawSignersEvents.push(signersEvent)
    }
    this.store.store(signers)
    this.eventsStore.store(rawSignersEvents)
    return signers
  }

  protected async _delete<K extends number>(signersIds: string[]): Promise<void> {
    const pubKey = this.authenticator.getPublicKey()
    const tags: [TagType.Event, string][] = []
    const rawEventsToDelete: Array<Event<K>> = []
    const signers: Array<Event<K>> = []
    for (const signerId of signersIds) {
      const signerEvent: Event<K> = this.eventsStore.get(signerId)
      if (!signerEvent || signerEvent.pubkey !== pubKey) continue
      const publishedSigner = this.store.get(signerId)
      tags.push([TagType.Event, signerEvent.id])
      signers.push(publishedSigner)
      rawEventsToDelete.push(signerEvent)
    }
    const deleteEvent = await buildEvent({
      kind: Kind.EventDeletion,
      content: '',
      tags,
    }, this.authenticator)
    const pub = this.nostrClient.publish(deleteEvent);
    await pub.onFirstOkOrCompleteFailure();
    this.store.delete(signers)
    this.eventsStore.delete(rawEventsToDelete)
  }
}
