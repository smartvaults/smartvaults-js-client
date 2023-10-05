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
    if (!metadataEvents.length) return []
    const metadataIds = metadataEvents.map(metadata => metadata.id)
    const missingMetadataIds = this.store.missing(metadataIds)
    if (missingMetadataIds.length === 0) {
      return this.store.getManyAsArray(metadataIds).map(metadata => metadata.content)
    }
    const missingMetadataEvents = metadataEvents.filter(metadata => missingMetadataIds.includes(metadata.id))
    const eventsMap: Map<string, Event<Kind>> = new Map()
    missingMetadataEvents.forEach(e => eventsMap.set(e.pubkey, e))
    Array.from(eventsMap.keys()).map(async publicKey => {
      let metadata = JSON.parse(eventsMap.get(publicKey)!.content)
      if (metadata?.nip05) {
        const [name, url] = metadata.nip05.split('@');

        let isNip05Valid = false;
        const URL_ENDPOINT = `https://${url}/.well-known/nostr.json?name=${name}`;
        try {

          const urlResponse = await fetch(URL_ENDPOINT);

          console.log(urlResponse);
          console.log(publicKey);

          const HTTP_OK = 200;

          if (urlResponse.ok && urlResponse.status === HTTP_OK) {
            const urlMetadata = await urlResponse.json();
            console.log(urlMetadata);

            isNip05Valid = urlMetadata.names[name] === publicKey;
            console.log(isNip05Valid)
          }
        } catch (fetchError) {
          console.error(`Error fetching the URL ${URL_ENDPOINT} to validate NIP05:`, fetchError);
        }

        if (!isNip05Valid) {
          metadata.nip05 = undefined;
        }
      }
      this.store.store({ content: { publicKey, ...metadata }, id: eventsMap.get(publicKey)?.id })
      return this.store.get(eventsMap.get(publicKey)?.id!).content
    })
    return this.store.getManyAsArray(metadataIds).map(metadata => metadata.content)
  }
}