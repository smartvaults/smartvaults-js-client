import { type Event } from 'nostr-tools'
import { ProposalType, TagType } from '../enum'
import { type PublishedCompletedProofOfReserveProposal, type PublishedCompletedSpendingProposal, type CompletedProofOfReserveProposal, type CompletedSpendingProposal, type SharedKeyAuthenticator } from '../types'
import { type Store } from '../service'
import { getTagValues, fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'

export class CompletedProposalHandler extends EventKindHandler {
  private readonly store: Store
  constructor(store: Store) {
    super()
    this.store = store
  }

  protected async _handle<K extends number>(completedProposalEvents: Array<Event<K>>, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>): Promise<Array<PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal>> {
    const policiesIds = completedProposalEvents.map(proposal => getTagValues(proposal, TagType.Event)[1])
    const sharedKeyAuthenticators = await getSharedKeysById(policiesIds)
    const completedProposalsIds = completedProposalEvents.map(proposal => proposal.id)
    const missingCompletedProposalsIds = this.store.missing(completedProposalsIds)
    if (missingCompletedProposalsIds.length === 0) {
      return this.store.getManyAsArray(completedProposalsIds)
    }
    const completedProposals: Array<PublishedCompletedProofOfReserveProposal | PublishedCompletedSpendingProposal> = []
    for (const completedProposalEvent of completedProposalEvents) {
      const proposalId = getTagValues(completedProposalEvent, TagType.Event)[0]
      const storeValue = this.store.get(proposalId)
      if (storeValue) {
        completedProposals.push(storeValue)
        continue
      }
      const policyId = getTagValues(completedProposalEvent, TagType.Event)[1]
      const sharedKeyAuthenticator = sharedKeyAuthenticators.get(policyId)?.sharedKeyAuthenticator
      if (sharedKeyAuthenticator == null) continue
      const decryptedProposalObj: (CompletedProofOfReserveProposal | CompletedSpendingProposal) = await sharedKeyAuthenticator.decryptObj(completedProposalEvent.content)
      const type = decryptedProposalObj[ProposalType.Spending] ? ProposalType.Spending : ProposalType.ProofOfReserve
      const publishedCompleteProposal = {
        type,
        ...decryptedProposalObj[type],
        policy_id: policyId,
        proposal_id: proposalId,
        completed_by: completedProposalEvent.pubkey,
        completion_date: fromNostrDate(completedProposalEvent.created_at)
      }
      completedProposals.push(publishedCompleteProposal)
    }
    this.store.store(completedProposals)
    return completedProposals
  }
}