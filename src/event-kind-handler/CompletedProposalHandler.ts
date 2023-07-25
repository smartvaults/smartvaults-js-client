import { type Event } from 'nostr-tools'
import { ProposalType, TagType } from '../enum'
import { type PublishedCompletedProofOfReserveProposal, type PublishedCompletedSpendingProposal, type CompletedProofOfReserveProposal, type CompletedSpendingProposal, type SharedKeyAuthenticator } from '../types'
import { type Store } from '../service'
import { getTagValues, fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type BitcoinUtil } from '../models'

export class CompletedProposalHandler extends EventKindHandler {
  private readonly store: Store
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  private readonly bitcoinUtil: BitcoinUtil
  constructor(store: Store, bitcoinUtil: BitcoinUtil, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>) {
    super()
    this.store = store
    this.bitcoinUtil = bitcoinUtil
    this.getSharedKeysById = getSharedKeysById
  }

  protected async _handle<K extends number>(completedProposalEvents: Array<Event<K>>): Promise<Array<PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal>> {
    const policiesIds = completedProposalEvents.map(proposal => getTagValues(proposal, TagType.Event)[1])
    const sharedKeyAuthenticators = await this.getSharedKeysById(policiesIds)
    const completedProposalsIds = completedProposalEvents.map(proposal => proposal.id)
    const missingCompletedProposalsIds = this.store.missing(completedProposalsIds)
    if (missingCompletedProposalsIds.length === 0) {
      return this.store.getManyAsArray(completedProposalsIds)
    }
    const completedProposals: Array<PublishedCompletedProofOfReserveProposal | PublishedCompletedSpendingProposal> = []
    for (const completedProposalEvent of completedProposalEvents) {
      const proposalId = getTagValues(completedProposalEvent, TagType.Event)[0]
      const completedProposalId = completedProposalEvent.id
      const storeValue = this.store.get(completedProposalId)
      if (storeValue) {
        completedProposals.push(storeValue)
        continue
      }
      const policyId = getTagValues(completedProposalEvent, TagType.Event)[1]
      const sharedKeyAuthenticator = sharedKeyAuthenticators.get(policyId)?.sharedKeyAuthenticator
      if (sharedKeyAuthenticator == null) continue
      const decryptedProposalObj: (CompletedProofOfReserveProposal | CompletedSpendingProposal) = await sharedKeyAuthenticator.decryptObj(completedProposalEvent.content)
      const type = decryptedProposalObj[ProposalType.Spending] ? ProposalType.Spending : ProposalType.ProofOfReserve
      let txId;
      if (type === ProposalType.Spending) {
        const spendingProposal: CompletedSpendingProposal = decryptedProposalObj as CompletedSpendingProposal;
        txId = this.bitcoinUtil.getTrxId(spendingProposal[type].tx)
      }
      const publishedCompleteProposal: PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal = {
        type,
        txId,
        ...decryptedProposalObj[type],
        policy_id: policyId,
        proposal_id: proposalId,
        completed_by: completedProposalEvent.pubkey,
        completion_date: fromNostrDate(completedProposalEvent.created_at),
        id: completedProposalEvent.id
      }
      completedProposals.push(publishedCompleteProposal)
    }
    this.store.store(completedProposals)
    return completedProposals
  }
}
