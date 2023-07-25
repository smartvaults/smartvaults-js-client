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
    const metadataIds = metadataEvents.map(metadata => metadata.id)
    const missingMetadataIds = this.store.missing(metadataIds)
    if (missingMetadataIds.length === 0) {
      return this.store.getManyAsArray(metadataIds).map(metadata => metadata.content)
    }
    const missingMetadataEvents = metadataEvents.filter(metadata => missingMetadataIds.includes(metadata.id))
    const eventsMap: Map<string, Event<Kind>> = new Map()
    missingMetadataEvents.forEach(e => eventsMap.set(e.pubkey, e))
    Array.from(eventsMap.keys()).map(publicKey => {
      this.store.store({ content: { publicKey, ...JSON.parse(eventsMap.get(publicKey)!.content) }, id: eventsMap.get(publicKey)?.id })
      return this.store.get(eventsMap.get(publicKey)?.id!).content
    })
    return this.store.getManyAsArray(metadataIds).map(metadata => metadata.content)
  }
}