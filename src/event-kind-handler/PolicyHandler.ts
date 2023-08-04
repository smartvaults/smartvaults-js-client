import {
  type Event,
  Kind,
} from 'nostr-tools'

import { TagType, CoinstrKind } from '../enum'
import { getTagValues, buildEvent } from '../util'
import { type NostrClient, type Store } from '../service'
import { EventKindHandler } from './EventKindHandler'
import { type BitcoinUtil, PublishedPolicy } from '../models'
import {
  type PublishedCompletedSpendingProposal, type PublishedCompletedProofOfReserveProposal, type PublishedSpendingProposal, type PublishedProofOfReserveProposal,
  type PublishedApprovedProposal, type SharedKeyAuthenticator
} from '../types'
import { type Authenticator } from '@smontero/nostr-ual'

export class PolicyHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly completedProposalsStore: Store
  private readonly proposalsStore: Store
  private readonly approvalsStore: Store
  private readonly sharedKeysStore: Store
  private readonly nostrClient: NostrClient
  private readonly bitcoinUtil: BitcoinUtil
  private readonly authenticator: Authenticator
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  private readonly getCompletedProposalsByPolicyId: (policyId: string) => Promise<Map<string, (PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal)
    | Array<PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal>>>
  private readonly getProposalsByPolicyId: (policyId: string) => Promise<Map<string, (PublishedSpendingProposal | PublishedProofOfReserveProposal)
    | Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>>>

  private readonly getApprovalsByPolicyId: (policy_ids: string[] | string | string) => Promise<Map<string, (PublishedApprovedProposal)
    | Array<PublishedApprovedProposal>>>
  constructor(store: Store, eventsStore: Store, completedProposalsStore: Store, proposalsStore: Store, approvalsStore: Store, sharedKeysStore: Store, nostrClient: NostrClient, bitcoinUtil: BitcoinUtil, authenticator: Authenticator,
    getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>,
    getCompletedProposalsByPolicyId: (policyId: string) => Promise<Map<string, (PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal)
      | Array<PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal>>>,
    getProposalsByPolicyId: (policyId: string) => Promise<Map<string, (PublishedSpendingProposal | PublishedProofOfReserveProposal)
      | Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>>>,
    getApprovalsByPolicyId: (policy_ids: string[] | string | string) => Promise<Map<string, (PublishedApprovedProposal)
      | Array<PublishedApprovedProposal>>>
  ) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.completedProposalsStore = completedProposalsStore
    this.proposalsStore = proposalsStore
    this.approvalsStore = approvalsStore
    this.sharedKeysStore = sharedKeysStore
    this.nostrClient = nostrClient
    this.bitcoinUtil = bitcoinUtil
    this.authenticator = authenticator
    this.getSharedKeysById = getSharedKeysById
    this.getCompletedProposalsByPolicyId = getCompletedProposalsByPolicyId
    this.getProposalsByPolicyId = getProposalsByPolicyId
    this.getApprovalsByPolicyId = getApprovalsByPolicyId
  }

  protected async _handle<K extends number>(policyEvents: Array<Event<K>>): Promise<Array<PublishedPolicy>> {
    let policyIds = policyEvents.map(policy => policy.id)
    if (!policyIds.length) return []
    policyIds = this.store.missing(policyIds)
    const policyIdSharedKeyAuthenticatorMap = await this.getSharedKeysById(policyIds)

    const policyPromises = policyEvents.map(async policyEvent => {
      const {
        id: policyId
      } = policyEvent

      if (this.store.has(policyId)) {
        return { policy: this.store.get(policyId), rawEvent: policyEvent }
      }
      const sharedKeyAuthenticator = policyIdSharedKeyAuthenticatorMap.get(policyId)?.sharedKeyAuthenticator
      if (!sharedKeyAuthenticator) return null
      const policyContent = await sharedKeyAuthenticator.decryptObj(policyEvent.content)
      let publishedPolicy: PublishedPolicy;
      try {
        publishedPolicy = PublishedPolicy.fromPolicyAndEvent({
          policyContent,
          policyEvent,
          bitcoinUtil: this.bitcoinUtil,
          nostrPublicKeys: getTagValues(policyEvent, TagType.PubKey),
          sharedKeyAuth: sharedKeyAuthenticator
        })
      } catch (e) {
        console.error(`Error parsing policy ${policyId}: ${String(e)}`);
        return null
      }
      return { policy: publishedPolicy, rawEvent: policyEvent }
    })

    const results = await Promise.allSettled(policyPromises)

    const validResults = results.reduce((acc, result) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(result.value);
      }
      return acc;
    }, [] as { policy: PublishedPolicy, rawEvent: Event<K> }[]);
    const policies = validResults.map(res => res!.policy)
    const rawPolicyEvents = validResults.map(res => res!.rawEvent)

    this.store.store(policies)
    this.eventsStore.store(rawPolicyEvents)

    return policies

  }

  private async getPolicyRelatedEvents(policyId: string): Promise<Map<CoinstrKind, any[]>> {
    const map = new Map<CoinstrKind, any[]>()
    const completedProposals = Array.from((await this.getCompletedProposalsByPolicyId(policyId)).values()).flat()
    const proposals = Array.from((await this.getProposalsByPolicyId(policyId)).values()).flat()
    const approvals = Array.from((await this.getApprovalsByPolicyId(policyId)).values()).flat()
    const sharedKeys = Array.from((await this.getSharedKeysById([policyId])).values()).flat()
    map.set(CoinstrKind.ApprovedProposal, approvals)
    map.set(CoinstrKind.CompletedProposal, completedProposals)
    map.set(CoinstrKind.Proposal, proposals)
    map.set(CoinstrKind.SharedKey, sharedKeys)
    return map
  }

  protected async _delete<K extends number>(ids: string[]): Promise<any> {
    const policies: PublishedPolicy[] = []
    const rawPolicyRelatedEvents: Event<K>[] = []
    const promises: Promise<any>[] = []
    const pubKey = this.authenticator.getPublicKey()
    for (const id of ids) {
      const policy: PublishedPolicy = this.store.get(id)
      if (policy) {
        const sharedKeyAuthenticator = policy.sharedKeyAuth
        const policyRelatedEvents = await this.getPolicyRelatedEvents(id)
        if (sharedKeyAuthenticator) {
          policies.push(policy)
          const tags: [TagType.Event | TagType.PubKey, string][] = [[TagType.Event, id]]
          const proposalRelatedEvents: (PublishedSpendingProposal | PublishedProofOfReserveProposal)[] | undefined = policyRelatedEvents.get(CoinstrKind.Proposal)
          const completedProposalRelatedEvents: (PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal)[] | undefined = policyRelatedEvents.get(CoinstrKind.CompletedProposal)
          const approvalsRelatedEvents: PublishedApprovedProposal[] | undefined = (policyRelatedEvents.get(CoinstrKind.ApprovedProposal))?.filter(approval => approval.approved_by === pubKey)
          const sharedKeysRelatedEvents: SharedKeyAuthenticator[] | undefined = policyRelatedEvents.get(CoinstrKind.SharedKey)?.filter(sharedKey => sharedKey.creator === pubKey)
          const policyMembers = policy.nostrPublicKeys
          const membersTags: [TagType.PubKey, string][] = policyMembers.map(member => [TagType.PubKey, member])
          const rawSharedKeyAuthEvents: Event<K>[] = []
          const rawAutoredEvents: Event<K>[] = []
          const rawPolicyEvent: Event<K> = this.eventsStore.get(id)

          tags.push(...membersTags)

          if (proposalRelatedEvents?.length || completedProposalRelatedEvents?.length) {
            const proposalRelatedEventsIds: string[] = policyRelatedEvents.get(CoinstrKind.Proposal)!.map(proposal => proposal.proposal_id)
            const completedProposalRelatedEventsIds: string[] = policyRelatedEvents.get(CoinstrKind.CompletedProposal)!.map(completedProposal => completedProposal.id)
            const policyRelatedEventsIds: string[] = [...proposalRelatedEventsIds, ...completedProposalRelatedEventsIds]
            const eventIdsTags: [TagType.Event, string][] = policyRelatedEventsIds.map(eventId => [TagType.Event, eventId])
            tags.push(...eventIdsTags)
            rawSharedKeyAuthEvents.push(...policyRelatedEventsIds.map(eventId => this.eventsStore.get(eventId)))
          }

          const deleteEvent = await buildEvent({
            kind: Kind.EventDeletion,
            content: '',
            tags,
          }, sharedKeyAuthenticator)
          const pub = this.nostrClient.publish(deleteEvent);
          promises.push(pub.onFirstOkOrCompleteFailure());


          if (approvalsRelatedEvents?.length || sharedKeysRelatedEvents?.length) {
            const approvalsRelatedEventsIds = approvalsRelatedEvents!.map(approval => approval.approval_id)
            const sharedKeysRelatedEventsIds = sharedKeysRelatedEvents!.map(sharedKey => sharedKey.id)
            const autoredRelatedEventsIds = [...approvalsRelatedEventsIds, ...sharedKeysRelatedEventsIds]
            const autoredEventsIdsTags = autoredRelatedEventsIds.map(eventId => [TagType.Event, eventId])
            const autoredDeleteEvent = await buildEvent({
              kind: Kind.EventDeletion,
              content: '',
              tags: [...autoredEventsIdsTags, ...membersTags]
            }, this.authenticator)
            const autoredPub = this.nostrClient.publish(autoredDeleteEvent);
            promises.push(autoredPub.onFirstOkOrCompleteFailure());
            rawAutoredEvents.push(...autoredRelatedEventsIds.map(eventId => this.eventsStore.get(eventId)))
          }

          if (proposalRelatedEvents?.length) {
            this.proposalsStore.delete(proposalRelatedEvents)
          }
          if (completedProposalRelatedEvents?.length) {
            this.completedProposalsStore.delete(completedProposalRelatedEvents)
          }
          if (approvalsRelatedEvents?.length) {
            this.approvalsStore.delete(approvalsRelatedEvents)
          }
          if (sharedKeysRelatedEvents?.length) {
            this.sharedKeysStore.delete(sharedKeysRelatedEvents)
          }
          const allRawEvents = [...rawSharedKeyAuthEvents, ...rawAutoredEvents, rawPolicyEvent]
          if (allRawEvents.length) {
            rawPolicyRelatedEvents.push(...allRawEvents)
          }
        }
      }
    }
    await Promise.all(promises)
    this.store.delete(policies)
    this.eventsStore.delete(rawPolicyRelatedEvents)
  }

}
