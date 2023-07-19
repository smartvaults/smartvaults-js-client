import { type Event, type Kind } from 'nostr-tools'
import { type Profile } from '../types'
import { type Store } from '../service'
import { EventKindHandler } from './EventKindHandler'

export class MetadataHandler extends EventKindHandler {
  private readonly store: Store
  constructor(store: Store) {
    super()
    this.store = store
  }

  protected async _handle<K extends number>(metadataEvents: Array<Event<K>>): Promise<Profile[]> {
    const eventsMap: Map<string, Event<Kind>> = new Map()
    metadataEvents.forEach(e => eventsMap.set(e.pubkey, e))
    return Array.from(eventsMap.keys()).map(publicKey => {
      this.store.store({ publicKey, ...JSON.parse(eventsMap.get(publicKey)!.content) })
      return this.store.get(publicKey)
    })
  }
}