import { Kind, type Event } from 'nostr-tools'
import { TagType, StoreKind } from '../enum'
import { type Store } from '../service'
import { getTagValues } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { Chat } from '../models/Chat'
export class EventDeletionHandler extends EventKindHandler {
  private readonly stores: Map<number, Store>
  private readonly getChat: () => Chat
  constructor(stores: Map<number, Store>, getChat: () => Chat) {
    super()
    this.stores = stores
    this.getChat = getChat
  }


  protected async _handle<K extends number>(deletionEvents: Array<Event<K>>): Promise<Array<Map<K, string[]>>> {
    const rawEventsToDelete: Array<Event<K>> = []
    const payloadMap = new Map<K, string[]>()
    const eventsStore = this.stores.get(StoreKind.Events)!
    for (const deletionEvent of deletionEvents) {
      const ids: string[] = getTagValues(deletionEvent, TagType.Event);
      const rawEvents: Array<Event<K>> = eventsStore.getManyAsArray(ids)
      for (const event of rawEvents) {
        if (deletionEvent.pubkey === event.pubkey) {
          const { kind, id } = event;
          const storeKind = this.stores.get(kind)!;
          const storedValue = storeKind.get(id);
          if (storeKind) {
            storeKind.delete(storedValue);
            if (kind === Kind.EncryptedDirectMessage) {
              try {
                const conversation = await this.getChat().getConversation(storedValue.conversationId)
                conversation.messages.remove(storedValue.id)
                const messageDeleted = { ...storedValue, message: "This message has been deleted" }
                conversation.messages.insertSorted(messageDeleted)
                conversation.hasUnreadMessages = true
              } catch (e) {
                console.log(e)
              }
            }
            rawEventsToDelete.push(event);
            const existingPayload = payloadMap.get(kind) || [];
            existingPayload.push(id);
            payloadMap.set(kind, existingPayload);
            const eventDeleteStore = this.stores.get(Kind.EventDeletion)
            if (eventDeleteStore) {
              eventDeleteStore.store({ id: event.id, kind: event.kind })
            } else {
              console.log(`EventDeletion store not found`)
            }
          }
        }
      };
    }
    eventsStore.delete(rawEventsToDelete)
    return [payloadMap]
  }
}
