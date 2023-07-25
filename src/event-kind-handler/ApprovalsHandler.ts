import { type Event } from 'nostr-tools'
import { ProposalType, TagType, ApprovalStatus } from '../enum'
import { type PublishedApprovedProposal, type BaseApprovedProposal, type SharedKeyAuthenticator } from '../types'
import { type Store } from '../service'
import { getTagValues, fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'

export class ApprovalsHandler extends EventKindHandler {
  private readonly store: Store
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  constructor(store: Store, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>) {
    super()
    this.store = store
    this.getSharedKeysById = getSharedKeysById

  }

  protected async _handle<K extends number>(approvalEvents: Array<Event<K>>): Promise<PublishedApprovedProposal[]> {
    const policiesIds = approvalEvents.map(proposal => getTagValues(proposal, TagType.Event)[1])
    const sharedKeys = await this.getSharedKeysById(policiesIds)
    const indexKey = 'approval_id'
    const approvedPublishedProposals: PublishedApprovedProposal[] = []
    const approvalIds = approvalEvents.map(approval => approval.id)
    const missingApprovalIds = this.store.missing(approvalIds, indexKey)
    if (missingApprovalIds.length === 0) {
      return this.store.getManyAsArray(approvalIds, indexKey)
    }
    for (const approvedProposalEvent of approvalEvents) {
      const policyId = getTagValues(approvedProposalEvent, TagType.Event)[1]
      const proposalId = getTagValues(approvedProposalEvent, TagType.Event)[0]
      const approvalId = approvedProposalEvent.id

      if (this.store.has(approvalId, indexKey)) {
        approvedPublishedProposals.push(this.store.get(approvalId, indexKey))
        continue
      }
      const sharedKeyAuthenticator = sharedKeys.get(policyId)?.sharedKeyAuthenticator
      if (sharedKeyAuthenticator == null) {
        continue
      }
      const decryptedProposalObj: BaseApprovedProposal = await sharedKeyAuthenticator.decryptObj(approvedProposalEvent.content)
      const type = decryptedProposalObj[ProposalType.Spending] ? ProposalType.Spending : ProposalType.ProofOfReserve
      const expirationDate = fromNostrDate(getTagValues(approvedProposalEvent, TagType.Expiration)[0])

      const publishedApprovedProposal: PublishedApprovedProposal = {
        type,
        ...decryptedProposalObj[type],
        policy_id: policyId,
        proposal_id: proposalId,
        approval_id: approvalId,
        approved_by: approvedProposalEvent.pubkey,
        approval_date: fromNostrDate(approvedProposalEvent.created_at),
        expiration_date: expirationDate,
        status: expirationDate < new Date() ? ApprovalStatus.Expired : ApprovalStatus.Active
      }
      approvedPublishedProposals.push(publishedApprovedProposal)
    }
    this.store.store(approvedPublishedProposals)
    return approvedPublishedProposals
  }
}
