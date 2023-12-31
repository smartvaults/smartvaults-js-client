import {
  type Event,
} from 'nostr-tools'

export abstract class EventKindHandler {

  async handle<K extends number>(events: Event<K> | Event<K>[]): Promise<any> {
    events = Array.isArray(events) ? events : [events]
    return this._handle(events)
  }

  async delete(ids: string | string[]): Promise<any> {
    ids = Array.isArray(ids) ? ids : [ids]
    return this._delete(ids)
  }

  protected abstract _handle<K extends number>(events: Event<K>[]): Promise<any>

  protected _delete(_: string[]): Promise<any> {
    throw new Error('Method not implemented.');
  }
}