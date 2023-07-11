import {
  type Event,
} from 'nostr-tools'

import {  TagType } from '../enum'
import { getTagValues } from '../util'
import { Store } from "../service";
import { EventKindHandler } from "./EventKindHandler"
import { BitcoinUtil, PublishedPolicy } from '../models';

export class PolicyHandler extends EventKindHandler {
  private store: Store
  private bitcoinUtil: BitcoinUtil
  constructor( store: Store, bitcoinUtil: BitcoinUtil) {
    super()
    this.store = store
    this.bitcoinUtil = bitcoinUtil
  }

  protected async _handle<K extends number>(policyEvents: Event<K>[], getSharedKeysById: (ids: string[]) => Promise<Map<string, any>>): Promise<any[]> {
    let policyIds = policyEvents.map(policy => policy.id)
    policyIds = this.store.missing(policyIds)
    const policyIdSharedKeyAuthenticatorMap = await getSharedKeysById(policyIds)

    const policies: PublishedPolicy[] = []
    for (const policyEvent of policyEvents) {
      const {
        id: policyId
      } = policyEvent
      if (this.store.has(policyId)) {
        policies.push(this.store.get(policyId))
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
    }
    this.store.store(policies)
    return policies
  }
}