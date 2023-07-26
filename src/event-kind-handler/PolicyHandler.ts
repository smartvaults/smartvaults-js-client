import {
  type Event,
  Kind,
} from 'nostr-tools'

import { TagType, CoinstrKind } from '../enum'
import { getTagValues, buildEvent } from '../util'
import { NostrClient, type Store } from '../service'
import { EventKindHandler } from './EventKindHandler'
import { type BitcoinUtil, PublishedPolicy } from '../models'
import { type PublishedCompletedSpendingProposal, type PublishedCompletedProofOfReserveProposal, type PublishedSpendingProposal, type PublishedProofOfReserveProposal } from '../types'

export class PolicyHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly completedProposalsStore: Store
  private readonly proposalsStore: Store
  private readonly nostrClient: NostrClient
  private readonly bitcoinUtil: BitcoinUtil
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, any>>
  private readonly getCompletedProposalsByPolicyId: (policyId: string) => Promise<Map<string, (PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal)
    | Array<PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal>>>
  private readonly getProposalsByPolicyId: (policyId: string) => Promise<Map<string, (PublishedSpendingProposal | PublishedProofOfReserveProposal)
    | Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>>>
  constructor(store: Store, eventsStore: Store, completedProposalsStore: Store, proposalsStore: Store, nostrClient: NostrClient, bitcoinUtil: BitcoinUtil, getSharedKeysById: (ids: string[]) => Promise<Map<string, any>>,
    getCompletedProposalsByPolicyId: (policyId: string) => Promise<Map<string, (PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal)
      | Array<PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal>>>,
    getProposalsByPolicyId: (policyId: string) => Promise<Map<string, (PublishedSpendingProposal | PublishedProofOfReserveProposal)
      | Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>>>
  ) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.completedProposalsStore = completedProposalsStore
    this.proposalsStore = proposalsStore
    this.nostrClient = nostrClient
    this.bitcoinUtil = bitcoinUtil
    this.getSharedKeysById = getSharedKeysById
    this.getCompletedProposalsByPolicyId = getCompletedProposalsByPolicyId
    this.getProposalsByPolicyId = getProposalsByPolicyId
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

  private async getPolicyRelatedEvents(policyId: string): Promise<Map<CoinstrKind, any[]>> {
    const map = new Map<CoinstrKind, any[]>()
    const completedProposals = (await this.getCompletedProposalsByPolicyId(policyId)).values()
    const completedProposalsArray = Array.isArray(completedProposals) ? completedProposals : Array.from(completedProposals)
    const proposals = (await this.getProposalsByPolicyId(policyId)).values()
    const proposalsArray = Array.isArray(proposals) ? proposals : Array.from(proposals)
    map.set(CoinstrKind.CompletedProposal, completedProposalsArray)
    map.set(CoinstrKind.Proposal, proposalsArray)
    return map
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
          const policyRelatedEvents = await this.getPolicyRelatedEvents(id)
          const proposalRelatedEventsIds: string[] = policyRelatedEvents.get(CoinstrKind.Proposal)!.map(proposal => proposal.proposal_id)
          const completedProposalRelatedEventsIds: string[] = policyRelatedEvents.get(CoinstrKind.CompletedProposal)!.map(completedProposal => completedProposal.id)
          const policyRelatedEventsIds = [...proposalRelatedEventsIds, ...completedProposalRelatedEventsIds]
          const policyMembers = policy.nostrPublicKeys
          const membersTags = policyMembers.map(member => [TagType.PubKey, member])
          const eventIdsTags = Array.from(policyRelatedEventsIds.values()).flatMap(value => value).map(eventId => [TagType.Event, eventId])
          const tags = [...membersTags, ...eventIdsTags, [TagType.Event, id]]
          const deleteEvent = await buildEvent({
            kind: Kind.EventDeletion,
            content: '',
            tags,
          }, sharedKeyAuthenticator)
          const pub = this.nostrClient.publish(deleteEvent);
          promises.push(pub.onFirstOkOrCompleteFailure());
          policies.push(policy)
          const proposalRelatedEvents = policyRelatedEvents.get(CoinstrKind.Proposal)
          const completedProposalRelatedEvents = policyRelatedEvents.get(CoinstrKind.CompletedProposal)
          if (proposalRelatedEvents?.length) {
            this.proposalsStore.delete(proposalRelatedEvents)
          }
          if (completedProposalRelatedEvents?.length) {
            this.completedProposalsStore.delete(completedProposalRelatedEvents)
          }
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
