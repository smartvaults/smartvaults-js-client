import { type Event, type Kind } from 'nostr-tools'
import { type Profile } from '../types'
import { type Store } from '../service'
import { EventKindHandler } from './EventKindHandler'
import { isNip05Verified } from '../util'
export class MetadataHandler extends EventKindHandler {
  private readonly store: Store
  constructor(store: Store) {
    super()
    this.store = store
  }

  protected async _handle<K extends number>(metadataEvents: Array<Event<K>>): Promise<Profile[]> {
    if (!metadataEvents.length) return [];

    const metadataIds = metadataEvents.map(metadata => metadata.id);
    const missingMetadataIds = this.store.missing(metadataIds);

    if (missingMetadataIds.length === 0) {
      return this.store.getManyAsArray(metadataIds).map(metadata => metadata.content);
    }

    const missingMetadataEvents = metadataEvents.filter(metadata => missingMetadataIds.includes(metadata.id));
    const eventsMap: Map<string, Event<Kind>> = new Map();
    missingMetadataEvents.forEach(e => eventsMap.set(e.pubkey, e));

    const fetchPromises = Array.from(eventsMap.keys()).map(async publicKey => {
      const event = eventsMap.get(publicKey)!;
      let metadata;
      try {
        metadata = JSON.parse(event.content);
      } catch (e) {
        console.error(`Invalid Metadata content for ${publicKey}`);
        return;
      }

      if (metadata?.nip05) {
        const isVerified = await isNip05Verified(metadata.nip05, publicKey);
        if (!isVerified) {
          console.error(`Cannot verify NIP05 for ${publicKey}`);
          metadata.nip05 = undefined;
        }
      }

      this.store.store({ content: { publicKey, ...metadata, isKeyAgent: false, isVerified: false }, id: event.id });
    });

    const results = await Promise.allSettled(fetchPromises);
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`Fetch promise #${index + 1} failed with ${result.reason}`);
      }
    });

    return this.store.getManyAsArray(metadataIds).map(metadata => metadata.content);
  }
}