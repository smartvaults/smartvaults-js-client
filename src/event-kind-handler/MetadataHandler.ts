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
        console.error(`Invalid JSON content for ${publicKey}`);
        return;
      }

      if (metadata?.nip05) {
        const HTTP_OK = 200;
        const nip05Array = metadata.nip05.split('@');
        const isNip05Valid = nip05Array.length === 2 && nip05Array[1].includes('.');

        if (!isNip05Valid) {
          console.error(`Invalid NIP05 string for ${publicKey}`);
          metadata.nip05 = undefined;
        } else {
          const [name, url] = nip05Array;
          const URL_ENDPOINT = `https://${url}/.well-known/nostr.json?name=${name}`;

          let isNip05Verifed = false;
          try {
            const urlResponse = await this.fetchWithTimeout(URL_ENDPOINT);
            if (urlResponse.ok && urlResponse.status === HTTP_OK) {
              const urlMetadata = await urlResponse.json();
              isNip05Verifed = urlMetadata.names[name] === publicKey;
            }
          } catch (fetchError) {
            console.error(`Error fetching the URL ${URL_ENDPOINT} to validate NIP05:`, fetchError);
          }

          if (!isNip05Verifed) {
            metadata.nip05 = undefined;
          }
        }
      }

      this.store.store({ content: { publicKey, ...metadata }, id: event.id });
    });

    await Promise.all(fetchPromises);

    return this.store.getManyAsArray(metadataIds).map(metadata => metadata.content);
  }

  private async fetchWithTimeout(url: string, timeout = 2000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);

    return response;
  }

}