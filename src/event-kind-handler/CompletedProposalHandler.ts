import { type Event, Kind } from 'nostr-tools'
import { ProposalType, TagType } from '../enum'
import { type SharedKeyAuthenticator, CompletedPublishedProposal, CompletedProposal } from '../types'
import { type Store, type NostrClient } from '../service'
import { getTagValues, fromNostrDate, buildEvent } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type BitcoinUtil } from '../models'

export class CompletedProposalHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly nostrClient: NostrClient
  private readonly bitcoinUtil: BitcoinUtil
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  constructor(store: Store, eventsStore: Store, nostrClient: NostrClient, bitcoinUtil: BitcoinUtil, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.nostrClient = nostrClient
    this.bitcoinUtil = bitcoinUtil
    this.getSharedKeysById = getSharedKeysById
  }

  protected async _handle<K extends number>(completedProposalEvents: Array<Event<K>>): Promise<Array<CompletedPublishedProposal>> {
    if (!completedProposalEvents.length) return []
    const policiesIds = completedProposalEvents.map(proposal => getTagValues(proposal, TagType.Event)[1])
    const completedProposalsIds = completedProposalEvents.map(proposal => proposal.id)
    const missingCompletedProposalsIds = this.store.missing(completedProposalsIds)
    const rawCompletedProposals: Array<Event<K>> = []
    if (missingCompletedProposalsIds.length === 0) {
      return this.store.getManyAsArray(completedProposalsIds)
    }

    const sharedKeyAuthenticators = await this.getSharedKeysById(policiesIds)
    const completedProposalsPromises = completedProposalEvents.map(async (completedProposalEvent) => {
      const proposalId = getTagValues(completedProposalEvent, TagType.Event)[0]
      const completedProposalId = completedProposalEvent.id
      const storeValue = this.store.get(completedProposalId)
      if (storeValue) {
        rawCompletedProposals.push(completedProposalEvent)
        return storeValue
      }
      const policyId = getTagValues(completedProposalEvent, TagType.Event)[1]
      const sharedKeyAuthenticator = sharedKeyAuthenticators.get(policyId)?.sharedKeyAuthenticator
      if (sharedKeyAuthenticator == null) return null

      const decryptedProposalObj: CompletedProposal = await sharedKeyAuthenticator.decryptObj(completedProposalEvent.content)
      const type = Object.keys(decryptedProposalObj)[0] as ProposalType
      const completedProposal = decryptedProposalObj[type]
      const isSpending = 'tx' in completedProposal
      let txId;
      if (isSpending) {
        txId = this.bitcoinUtil.getTrxId(completedProposal.tx)
      }
      const publishedCompleteProposal: CompletedPublishedProposal = {
        type,
        txId,
        ...completedProposal,
        policy_id: policyId,
        proposal_id: proposalId,
        completed_by: completedProposalEvent.pubkey,
        completion_date: fromNostrDate(completedProposalEvent.created_at),
        id: completedProposalEvent.id
      }
      rawCompletedProposals.push(completedProposalEvent)
      return publishedCompleteProposal
    });

    const results = await Promise.allSettled(completedProposalsPromises);

    const completedProposals = results.reduce((acc, result) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(result.value);
      }
      return acc;
    }, [] as Array<CompletedPublishedProposal>);

    this.store.store(completedProposals)
    this.eventsStore.store(rawCompletedProposals)
    return completedProposals
  }


  protected async _delete<K extends number>(ids: string[]): Promise<void> {
    const promises: Promise<void>[] = []
    const completedProposals: Array<CompletedPublishedProposal> = []
    const rawCompletedProposals: Array<Event<K>> = []
    for (const id of ids) {
      const completedProposal: CompletedPublishedProposal = this.store.get(id)
      if (completedProposal) {
        const policyId = completedProposal.policy_id
        const sharedKeyAuthenticator = (await this.getSharedKeysById([policyId])).get(policyId)?.sharedKeyAuthenticator
        if (sharedKeyAuthenticator?.getPublicKey() === completedProposal.completed_by) {
          const completedProposalEvent: Event<K> = this.eventsStore.get(id)
          if (!completedProposalEvent) continue
          const policyMembers: [TagType, string][] = getTagValues(completedProposalEvent, TagType.PubKey).map(pubkey => [TagType.PubKey, pubkey])
          const deleteEvent = await buildEvent({
            kind: Kind.EventDeletion,
            content: '',
            tags: [...policyMembers, [TagType.Event, id]],
          }, sharedKeyAuthenticator);
          const pub = this.nostrClient.publish(deleteEvent);
          promises.push(pub.onFirstOkOrCompleteFailure());
          completedProposals.push(completedProposal)
          rawCompletedProposals.push(completedProposalEvent)
        }
      }
    }
    await Promise.all(promises)
    this.store.delete(completedProposals)
    this.eventsStore.delete(rawCompletedProposals)
  }
}
