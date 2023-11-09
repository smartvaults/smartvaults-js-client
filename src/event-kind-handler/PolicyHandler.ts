import {
  type Event,
  Kind
} from 'nostr-tools'

import { TagType, SmartVaultsKind } from '../enum'
import { getTagValues, buildEvent, type PaginationOpts } from '../util'
import { type NostrClient, type Store } from '../service'
import { EventKindHandler } from './EventKindHandler'
import { type BitcoinUtil, PublishedPolicy } from '../models'
import { type ActivePublishedProposal, type PublishedApprovedProposal, type SharedKeyAuthenticator, type PublishedSharedSigner, type PublishedOwnedSigner, type PublishedLabel, type CompletedPublishedProposal } from '../types'
import { type Authenticator } from '@smontero/nostr-ual'
export class PolicyHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly completedProposalsStore: Store
  private readonly proposalsStore: Store
  private readonly approvalsStore: Store
  private readonly sharedKeysStore: Store
  private readonly LabelStore: Store
  private readonly nostrClient: NostrClient
  private readonly bitcoinUtil: BitcoinUtil
  private readonly authenticator: Authenticator
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  private readonly getCompletedProposalsByPolicyId: (policyId: string) => Promise<Map<string, CompletedPublishedProposal
    | Array<CompletedPublishedProposal>>>
  private readonly getProposalsByPolicyId: (policyId: string[] | string) => Promise<Map<string, ActivePublishedProposal
    | Array<ActivePublishedProposal>>>

  private readonly getApprovalsByPolicyId: (policy_ids: string[] | string | string) => Promise<Map<string, PublishedApprovedProposal
    | Array<PublishedApprovedProposal>>>
  private readonly getSharedSigners: (publicKeys?: string | string[]) => Promise<PublishedSharedSigner[]>
  private readonly getOwnedSigners: () => Promise<PublishedOwnedSigner[]>
  private readonly getLabelsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, PublishedLabel | Array<PublishedLabel>>>
  constructor(store: Store, eventsStore: Store, completedProposalsStore: Store, proposalsStore: Store, approvalsStore: Store, sharedKeysStore: Store, labelStore: Store, nostrClient: NostrClient, bitcoinUtil: BitcoinUtil, authenticator: Authenticator,
    getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>,
    getCompletedProposalsByPolicyId: (policyId: string) => Promise<Map<string, CompletedPublishedProposal
      | Array<CompletedPublishedProposal>>>,
    getProposalsByPolicyId: (policyId: string[] | string) => Promise<Map<string, ActivePublishedProposal
      | Array<ActivePublishedProposal>>>,
    getApprovalsByPolicyId: (policy_ids: string[] | string | string) => Promise<Map<string, PublishedApprovedProposal
      | Array<PublishedApprovedProposal>>>,
    getSharedSigners: (publicKeys?: string | string[]) => Promise<Array<PublishedSharedSigner>>,
    getOwnedSigners: () => Promise<PublishedOwnedSigner[]>,
    getLabelsByPolicyId: (policy_ids: string[] | string, paginationOpts?: PaginationOpts) => Promise<Map<string, PublishedLabel | Array<PublishedLabel>>>,
  ) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.completedProposalsStore = completedProposalsStore
    this.proposalsStore = proposalsStore
    this.approvalsStore = approvalsStore
    this.sharedKeysStore = sharedKeysStore
    this.LabelStore = labelStore
    this.nostrClient = nostrClient
    this.bitcoinUtil = bitcoinUtil
    this.authenticator = authenticator
    this.getSharedKeysById = getSharedKeysById
    this.getCompletedProposalsByPolicyId = getCompletedProposalsByPolicyId
    this.getProposalsByPolicyId = getProposalsByPolicyId
    this.getApprovalsByPolicyId = getApprovalsByPolicyId
    this.getSharedSigners = getSharedSigners
    this.getOwnedSigners = getOwnedSigners
    this.getLabelsByPolicyId = getLabelsByPolicyId
  }

  protected async _handle<K extends number>(policyEvents: Array<Event<K>>): Promise<Array<PublishedPolicy>> {
    let policyIds = policyEvents.map(policy => policy.id)
    if (!policyIds?.length) return []
    const missingPolicyIds = this.store.missing(policyIds)
    if (missingPolicyIds?.length === 0) {
      return this.store.getManyAsArray(policyIds)
    }
    const policyIdSharedKeyAuthenticatorMap = await this.getSharedKeysById(missingPolicyIds)
    const missingPolicyEvents = policyEvents.filter(policyEvent => missingPolicyIds.includes(policyEvent.id))
    const policyPromises = missingPolicyEvents.map(async policyEvent => {
      const {
        id: policyId
      } = policyEvent

      if (this.store.has(policyId)) {
        return { policy: this.store.get(policyId), rawEvent: policyEvent }
      }
      const sharedKeyAuthenticator = policyIdSharedKeyAuthenticatorMap.get(policyId)?.sharedKeyAuthenticator
      if (!sharedKeyAuthenticator) return null
      const policyContent = await sharedKeyAuthenticator.decryptObj(policyEvent.content)
      const nostrPublicKeys = getTagValues(policyEvent, TagType.PubKey)
      let publishedPolicy: PublishedPolicy;
      try {
        publishedPolicy = PublishedPolicy.fromPolicyAndEvent({
          policyContent,
          policyEvent,
          bitcoinUtil: this.bitcoinUtil,
          nostrPublicKeys,
          sharedKeyAuth: sharedKeyAuthenticator
        },
          this.getSharedSigners,
          this.getOwnedSigners,
          this.getProposalsByPolicyId,
          this.getLabelsByPolicyId,
          this.LabelStore
        )
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

  private async getPolicyRelatedEvents(policyId: string): Promise<Map<SmartVaultsKind, any[]>> {
    const map = new Map<SmartVaultsKind, any[]>()
    const completedProposals = Array.from((await this.getCompletedProposalsByPolicyId(policyId)).values()).flat()
    const proposals = Array.from((await this.getProposalsByPolicyId(policyId)).values()).flat()
    const approvals = Array.from((await this.getApprovalsByPolicyId(policyId)).values()).flat()
    const sharedKeys = Array.from((await this.getSharedKeysById([policyId])).values()).flat()
    map.set(SmartVaultsKind.ApprovedProposal, approvals)
    map.set(SmartVaultsKind.CompletedProposal, completedProposals)
    map.set(SmartVaultsKind.Proposal, proposals)
    map.set(SmartVaultsKind.SharedKey, sharedKeys)
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
        const policyBalance = (await policy.getBalance()).totalBalance()
        if (policyBalance > 0) {
          throw new Error(`Cannot delete vault ${id} with non-zero balance ${policyBalance}`)
        }
        const sharedKeyAuthenticator = policy.sharedKeyAuth
        const policyRelatedEvents = await this.getPolicyRelatedEvents(id)
        if (sharedKeyAuthenticator) {
          policies.push(policy)
          const tags: [TagType.Event | TagType.PubKey, string][] = [[TagType.Event, id]]
          const proposalRelatedEvents: ActivePublishedProposal[] | undefined = policyRelatedEvents.get(SmartVaultsKind.Proposal)
          const completedProposalRelatedEvents: CompletedPublishedProposal[] | undefined = policyRelatedEvents.get(SmartVaultsKind.CompletedProposal)
          const approvalsRelatedEvents: PublishedApprovedProposal[] | undefined = (policyRelatedEvents.get(SmartVaultsKind.ApprovedProposal))?.filter(approval => approval.approved_by === pubKey)
          const sharedKeysRelatedEvents: SharedKeyAuthenticator[] | undefined = policyRelatedEvents.get(SmartVaultsKind.SharedKey)?.filter(sharedKey => sharedKey.creator === pubKey)
          const policyMembers = policy.nostrPublicKeys
          const membersTags: [TagType.PubKey, string][] = policyMembers.map(member => [TagType.PubKey, member])
          const rawSharedKeyAuthEvents: Event<K>[] = []
          const rawAutoredEvents: Event<K>[] = []
          const rawPolicyEvent: Event<K> = this.eventsStore.get(id)

          tags.push(...membersTags)

          if (proposalRelatedEvents?.length || completedProposalRelatedEvents?.length) {
            const proposalRelatedEventsIds: string[] = policyRelatedEvents.get(SmartVaultsKind.Proposal)!.map(proposal => proposal.proposal_id)
            const completedProposalRelatedEventsIds: string[] = policyRelatedEvents.get(SmartVaultsKind.CompletedProposal)!.map(completedProposal => completedProposal.id)
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
          if (allRawEvents?.length) {
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
