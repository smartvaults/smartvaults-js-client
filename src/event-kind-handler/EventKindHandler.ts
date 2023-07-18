import {
  type Event,
} from 'nostr-tools'

export abstract class EventKindHandler {

  async handle<K extends number>(events: Event<K> | Event<K>[], callback?: any, callback2?: any): Promise<any> {
    events = Array.isArray(events) ? events : [events]
    return this._handle(events, callback, callback2)
  }

  protected abstract _handle<K extends number>(events: Event<K>[], callback?: any, callback2?: any): Promise<any>
}