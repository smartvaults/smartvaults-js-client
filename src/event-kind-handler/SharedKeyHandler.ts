import { type Event } from 'nostr-tools'
import { TagType, AuthenticatorType } from '../enum'
import { type SharedKeyAuthenticator } from '../types'
import { type Store } from '../service'
import { getTagValues } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'

export class SharedKeyHandler extends EventKindHandler {
  private readonly authenticator: Authenticator
  private readonly store: Store
  private readonly eventsStore: Store
  constructor(authenticator: Authenticator, store: Store, eventsStore: Store) {
    super()
    this.authenticator = authenticator
    this.store = store
    this.eventsStore = eventsStore
  }

  protected async _handle<K extends number>(sharedKeyEvents: Array<Event<K>>): Promise<SharedKeyAuthenticator[]> {
    if (!sharedKeyEvents.length) return []
    if (this.authenticator.getName() === AuthenticatorType.WebExtension) {
      return this.getSharedKeysSync(sharedKeyEvents)
    } else {
      return this.getSharedKeysAsync(sharedKeyEvents)
    }
  }

  private async getSharedKeysSync<K extends number>(sharedKeyEvents: Array<Event<K>>): Promise<SharedKeyAuthenticator[]> {
    const sharedKeyAuthenticators: SharedKeyAuthenticator[] = []
    const rawSharedKeyAuthEvents: Array<Event<K>> = []
    for (const sharedKeyEvent of sharedKeyEvents) {
      const policyId = getTagValues(sharedKeyEvent, TagType.Event)[0]
      if (this.store.has(policyId)) {
        sharedKeyAuthenticators.push(this.store.get(policyId))
      }
      const sharedKey = await this.authenticator.decrypt(
        sharedKeyEvent.content,
        sharedKeyEvent.pubkey
      )
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
      const id = sharedKeyEvent.id
      const creator = sharedKeyEvent.pubkey
      sharedKeyAuthenticators.push({ id, policyId, creator, sharedKeyAuthenticator, private: sharedKey })
      rawSharedKeyAuthEvents.push(sharedKeyEvent)
    }
    this.store.store(sharedKeyAuthenticators)
    this.eventsStore.store(rawSharedKeyAuthEvents)
    return sharedKeyAuthenticators
  }

  private async getSharedKeysAsync<K extends number>(sharedKeyEvents: Array<Event<K>>): Promise<SharedKeyAuthenticator[]> {

    const sharedKeyPromises = sharedKeyEvents.map(async sharedKeyEvent => {
      const policyId = getTagValues(sharedKeyEvent, TagType.Event)[0]
      let completeAuthenticator;

      if (this.store.has(policyId)) {
        completeAuthenticator = this.store.get(policyId);
      } else {
        const sharedKey = await this.authenticator.decrypt(
          sharedKeyEvent.content,
          sharedKeyEvent.pubkey
        )
        const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
        const id = sharedKeyEvent.id
        const creator = sharedKeyEvent.pubkey
        completeAuthenticator = { id, policyId, creator, sharedKeyAuthenticator }
      }
      return { completeAuthenticator, rawEvent: sharedKeyEvent }
    })

    const results = await Promise.allSettled(sharedKeyPromises)

    const validResults = results.reduce((acc, result) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(result.value);
      }
      return acc;
    }, [] as { completeAuthenticator: SharedKeyAuthenticator, rawEvent: Event<K> }[]);

    const sharedKeyAuthenticators = validResults.map(res => res.completeAuthenticator)
    const rawSharedKeyAuthEvents: Array<Event<K>> = validResults.map(res => res.rawEvent)

    this.store.store(sharedKeyAuthenticators)
    this.eventsStore.store(rawSharedKeyAuthEvents)

    return sharedKeyAuthenticators
  }

}
