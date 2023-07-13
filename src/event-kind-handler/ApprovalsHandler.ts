import { type Event } from 'nostr-tools'
import { TagType } from '../enum'
import { type PublishedApprovedProposal, type BaseApprovedProposal, type SharedKeyAuthenticator } from '../types'
import { type Store } from '../service'
import { getTagValues, fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'

export class ApprovalsHandler extends EventKindHandler {
  private readonly store: Store
  constructor(store: Store) {
    super()
    this.store = store
  }

  protected async _handle<K extends number>(approvalEvents: Array<Event<K>>, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>): Promise<PublishedApprovedProposal[]> {
    const policiesIds = approvalEvents.map(proposal => getTagValues(proposal, TagType.Event)[1])
    const sharedKeys = await getSharedKeysById(policiesIds)
    const approvedPublishedProposals: PublishedApprovedProposal[] = []

    for (const approvedProposalEvent of approvalEvents) {
      const policyId = getTagValues(approvedProposalEvent, TagType.Event)[1]
      const proposalId = getTagValues(approvedProposalEvent, TagType.Event)[0]
      const approvalId = approvedProposalEvent.id
      const indexKey = 'approval_id'

      if (this.store.has(approvalId, indexKey)) {
        approvedPublishedProposals.push(this.store.get(approvalId, indexKey))
        continue
      }
      const sharedKeyAuthenticator = sharedKeys.get(policyId)?.sharedKeyAuthenticator
      if (sharedKeyAuthenticator == null) {
        continue
      }
      const decryptedProposal: BaseApprovedProposal = await sharedKeyAuthenticator.decryptObj(approvedProposalEvent.content)
      const expirationDate = fromNostrDate(getTagValues(approvedProposalEvent, TagType.Expiration)[0])

      const publishedApprovedProposal: PublishedApprovedProposal = {
        ...decryptedProposal,
        policy_id: policyId,
        proposal_id: proposalId,
        approval_id: approvalId,
        approved_by: approvedProposalEvent.pubkey,
        approval_date: fromNostrDate(approvedProposalEvent.created_at),
        expiration_date: expirationDate,
        status: expirationDate < new Date() ? 'expired' : 'active'
      }
      approvedPublishedProposals.push(publishedApprovedProposal)
    }
    this.store.store(approvedPublishedProposals)
    return approvedPublishedProposals
  }
}
