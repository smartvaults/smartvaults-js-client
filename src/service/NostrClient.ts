import {
  Event,
  SimplePool,
  Filter,
  type Sub,
  type SubscriptionOptions,
} from 'nostr-tools'

import {
  type PubPool,
  type PubPoolResult
} from './types'

export class NostrClient {
  private pool: SimplePool
  private relays: string[]

  constructor(relays: string[], options: { eoseSubTimeout?: number; getTimeout?: number } = {}) {
    this.pool = new SimplePool(options)
    this.relays = relays
  }

  addRelays(relays: string[]) {
    for (let r of relays) {
      this.addRelay(r)
    }
  }

  addRelay(relay: string) {
    if (!this.relays.includes(relay)) {
      this.relays.push(relay)
    }
  }

  removeRelays(relays: string[]) {
    for (let r of relays) {
      this.removeRelay(r)
    }
  }

  removeRelay(relay: string) {
    let pos = this.relays.indexOf(relay)
    if (pos !== -1) {
      this.relays.splice(pos, 1)
      this.pool.close([relay])
    }
  }

  get<K extends number = number>(
    filter: Filter<K>,
    opts?: SubscriptionOptions
  ): Promise<Event<K> | null> {
    return this.pool.get(this.relays, filter, opts)
  }

  list<K extends number = number>(
    filters: Filter<K>[],
    opts?: SubscriptionOptions
  ): Promise<Event<K>[]> {
    return this.pool.list(this.relays, filters, opts)
  }

  publish(event: Event<number>): PubPool {
    let numRelays = this.relays.length
    const pub = this.pool.publish(this.relays, event)
    let listeners: Set<any> = new Set()
    let result: PubPoolResult = {
      ok: [],
      failed: []
    }
    function onResponse(status, relay) {
      result[status].push(relay)
      numRelays--
      if (numRelays <= 0) {
        listeners.forEach(cb => { cb(result) })
        listeners = new Set()
      }
    }
    pub.on('ok', (relay) => {
      onResponse('ok', relay)
    })
    pub.on('failed', (relay) => {
      onResponse('failed', relay)
    })
    return {
      on(type, cb) {
        if (type === 'complete') {
          listeners.add(cb)
        } else {
          pub.on(type, cb)
        }
      },

      off(type, cb) {
        if (type === 'complete') {
          listeners.delete(cb)
        } else {
          pub.off(type, cb)
        }
      },

      completePromise() {
        return new Promise(resolve => {
          this.on('complete', resolve)
        })
      },

      onFirstOkOrCompleteFailure() {
        return new Promise((resolve, reject) => {
          pub.on('ok', () => resolve)
          this.on('complete', (r) => {
            if (r.ok.length) {
              resolve()
            } else {
              reject(new Error('Message could not published'))
            }
          })
        })
      }

    }
  }


  sub<K extends number = number>(
    filters: Filter<K>[],
    onEventFn?: (element: Event) => void,
    opts?: SubscriptionOptions
  ): Sub<K> {
    const sub = this.pool.sub(this.relays, filters, opts)
    if (onEventFn) {
      sub.on('event', event => {
        onEventFn(event)
      })
    }
    return sub
  }

  disconnect(): void {
    this.pool.close(this.relays)
  }

}