import {
  type Event,
} from 'nostr-tools'

import { CoinstrKind, TagType } from '../enum'
import { NostrClient, Store } from "../service";
import { filterBuilder, getTagValues } from '../util'

import { EventKindHandler } from "./EventKindHandler"
import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual';
import { BitcoinUtil, PublishedPolicy } from '../models';

export class PolicyHandler extends EventKindHandler {
  private nostrClient: NostrClient
  private authenticator: Authenticator
  private store: Store
  private bitcoinUtil: BitcoinUtil
  constructor(nostrClient: NostrClient, authenticator: Authenticator, store: Store, bitcoinUtil: BitcoinUtil) {
    super()
    this.nostrClient = nostrClient
    this.authenticator = authenticator
    this.store = store
    this.bitcoinUtil = bitcoinUtil
  }

  protected async _handle<K extends number>(policyEvents: Event<K>[]): Promise<any[]> {
    let policyIds = policyEvents.map(policy => policy.id)
    policyIds = this.store.missing(policyIds)
    const policyIdSharedKeyMap = {}

    if (policyIds.length) {
      const sharedKeysFilter = filterBuilder()
        .kinds(CoinstrKind.SharedKey)
        .events(policyIds)
        .pubkeys(this.authenticator.getPublicKey())
        .toFilters()
      const sharedKeyEvents = await this.nostrClient.list<CoinstrKind.Policy>(sharedKeysFilter)

      for (const sharedKeyEvent of sharedKeyEvents) {
        const eventIds = getTagValues(sharedKeyEvent, TagType.Event)
        eventIds.forEach(id => policyIdSharedKeyMap[id] = sharedKeyEvent)
      }
    }

    const policies: PublishedPolicy[] = []
    for (const policyEvent of policyEvents) {
      const {
        id: policyId
      } = policyEvent
      if (this.store.has(policyId)) {
        policies.push(this.store.get(policyId))
        continue
      }
      const sharedKeyEvent = policyIdSharedKeyMap[policyId]
      if (!sharedKeyEvent) {
        console.error(`Shared Key for policy id: ${policyId} not found`)
        continue
      }
      const sharedKey = await this.authenticator.decrypt(
        sharedKeyEvent.content,
        sharedKeyEvent.pubkey
      )
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
      const policyContent = await sharedKeyAuthenticator.decryptObj(policyEvent.content)
      if (policyContent.descriptor === 'vault descriptor') {
        console.log("policyId: ", policyId)
        console.log("sharedKey: ", sharedKey)
      }
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