import {
  type Event,
  Kind,
} from 'nostr-tools'

import { TagType } from '../enum'
import { getTagValues, buildEvent } from '../util'
import { NostrClient, type Store } from '../service'
import { EventKindHandler } from './EventKindHandler'
import { type BitcoinUtil, PublishedPolicy } from '../models'

export class PolicyHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly nostrClient: NostrClient
  private readonly bitcoinUtil: BitcoinUtil
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, any>>
  constructor(store: Store, eventsStore: Store, nostrClient: NostrClient, bitcoinUtil: BitcoinUtil, getSharedKeysById: (ids: string[]) => Promise<Map<string, any>>) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.nostrClient = nostrClient
    this.bitcoinUtil = bitcoinUtil
    this.getSharedKeysById = getSharedKeysById
  }

  protected async _handle<K extends number>(policyEvents: Array<Event<K>>): Promise<any[]> {
    let policyIds = policyEvents.map(policy => policy.id)
    policyIds = this.store.missing(policyIds)
    const policyIdSharedKeyAuthenticatorMap = await this.getSharedKeysById(policyIds)

    const policies: PublishedPolicy[] = []
    const rawPolicyEvents: Array<Event<K>> = []
    for (const policyEvent of policyEvents) {
      const {
        id: policyId
      } = policyEvent
      if (this.store.has(policyId)) {
        policies.push(this.store.get(policyId))
        rawPolicyEvents.push(policyEvent)
        continue
      }
      const sharedKeyAuthenticator = policyIdSharedKeyAuthenticatorMap.get(policyId).sharedKeyAuthenticator
      if (!sharedKeyAuthenticator) continue
      const policyContent = await sharedKeyAuthenticator.decryptObj(policyEvent.content)
      policies.push(PublishedPolicy.fromPolicyAndEvent({
        policyContent,
        policyEvent,
        bitcoinUtil: this.bitcoinUtil,
        nostrPublicKeys: getTagValues(policyEvent, TagType.PubKey),
        sharedKeyAuth: sharedKeyAuthenticator
      }))
      rawPolicyEvents.push(policyEvent)
    }
    this.store.store(policies)
    this.eventsStore.store(rawPolicyEvents)
    return policies
  }

  protected async _delete<K extends number>(ids: string[]): Promise<any> {
    const policies: PublishedPolicy[] = []
    const rawPolicyEvents: Event<K>[] = []
    const promises: Promise<any>[] = []
    for (const id of ids) {
      const policy: PublishedPolicy = this.store.get(id)
      if (policy) {
        const sharedKeyAuthenticator = policy.sharedKeyAuth
        if (sharedKeyAuthenticator) {
          const policyMembers = policy.nostrPublicKeys
          const membersTags = policyMembers.map(member => [TagType.PubKey, member])
          const tags = [...membersTags, [TagType.Event, id]]
          const deleteEvent = await buildEvent({
            kind: Kind.EventDeletion,
            content: '',
            tags,
          }, sharedKeyAuthenticator)
          const pub = this.nostrClient.publish(deleteEvent);
          promises.push(pub.onFirstOkOrCompleteFailure());
          policies.push(policy)
          const rawEvent = this.eventsStore.get(id)
          if (rawEvent) {
            rawPolicyEvents.push(rawEvent)
          }
        }
      }
    }
    await Promise.all(promises)
    this.store.delete(policies)
    this.eventsStore.delete(rawPolicyEvents)
  }

}
