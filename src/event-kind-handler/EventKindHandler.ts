import {
  type Event,
} from 'nostr-tools'

export abstract class EventKindHandler {

  async handle<K extends number>(events: Event<K> | Event<K>[]): Promise<any> {
    events = Array.isArray(events) ? events : [events]
    return this._handle(events)
  }

  protected abstract _handle<K extends number>(events: Event<K>[]): Promise<any>
}