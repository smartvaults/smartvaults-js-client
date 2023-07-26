import { type Event } from 'nostr-tools'
import { TagType } from '../enum'
import { type Store } from '../service'
import { getTagValues } from '../util'
import { EventKindHandler } from './EventKindHandler'
export class EventDeletionHandler extends EventKindHandler {
  private readonly stores: Map<number, Store>
  constructor(stores: Map<number, Store>) {
    super()
    this.stores = stores
  }


  protected async _handle<K extends number>(deletionEvents: Array<Event<K>>): Promise<Array<Map<K, string[]>>> {
    const rawEventsToDelete: Array<Event<K>> = []
    const payloadMap = new Map<K, string[]>()
    const eventsStore = this.stores.get(1234)!
    for (const deletionEvent of deletionEvents) {
      const ids: string[] = getTagValues(deletionEvent, TagType.Event);
      const rawEvents: Array<Event<K>> = eventsStore.getManyAsArray(ids)
      rawEvents.forEach((event) => {
        if (deletionEvent.pubkey === event.pubkey) {
          const { kind, id } = event;
          const storeKind = this.stores.get(kind)!;
          const storedValue = storeKind.get(id);
          if (storeKind) {
            storeKind.delete(storedValue);
            rawEventsToDelete.push(event);
            const existingPayload = payloadMap.get(kind) || [];
            existingPayload.push(id);
            payloadMap.set(kind, existingPayload);
          }
        }
      });
    }
    eventsStore.delete(rawEventsToDelete)
    return [payloadMap]
  }
}
