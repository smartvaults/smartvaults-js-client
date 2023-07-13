import { type Event } from 'nostr-tools'
import { TagType, ProposalType } from '../enum'
import { type SpendingProposal, type ProofOfReserveProposal, type PublishedSpendingProposal, type PublishedProofOfReserveProposal } from '../types'
import { type Store } from '../service'
import { getTagValues } from '../util'
import { EventKindHandler } from './EventKindHandler'
export class ProposalHandler extends EventKindHandler {
  private readonly store: Store
  constructor(store: Store) {
    super()
    this.store = store
  }

  protected async _handle<K extends number>(proposalEvents: Array<Event<K>>, getSharedKeysById: any): Promise<Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>> {
    const proposalIds = proposalEvents.map(proposal => proposal.id)
    const missingProposalsIds = this.store.missing(proposalIds)
    if (missingProposalsIds.length === 0) {
      return this.store.getManyAsArray(proposalIds)
    }
    const decryptedProposals: any[] = []
    const policiesIds = proposalEvents.map(proposal => getTagValues(proposal, TagType.Event)[0])
    const sharedKeyAuthenticators = await getSharedKeysById(policiesIds)
    for (const proposalEvent of proposalEvents) {
      const storeValue = this.store.get(proposalEvent.id)
      if (storeValue) {
        decryptedProposals.push(storeValue)
        continue
      }
      const policyId = getTagValues(proposalEvent, TagType.Event)[0]
      const sharedKeyAuthenticator = sharedKeyAuthenticators.get(policyId).sharedKeyAuthenticator
      if (!sharedKeyAuthenticator) continue
      const decryptedProposal: SpendingProposal | ProofOfReserveProposal = await sharedKeyAuthenticator.decryptObj(proposalEvent.content)
      const type = 'to_address' in decryptedProposal ? ProposalType.Spending : ProposalType.ProofOfReserve
      const publishedProposal: PublishedSpendingProposal | PublishedProofOfReserveProposal = {
        ...decryptedProposal,
        type,
        policy_id: policyId,
        proposal_id: proposalEvent.id
      }
      decryptedProposals.push(publishedProposal)
    }
    this.store.store(decryptedProposals)
    return decryptedProposals
  }
}
