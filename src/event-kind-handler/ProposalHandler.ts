import { type Event } from 'nostr-tools'
import { TagType, ProposalType, ProposalStatus } from '../enum'
import { type SpendingProposal, type ProofOfReserveProposal, type PublishedSpendingProposal, type PublishedProofOfReserveProposal, type SharedKeyAuthenticator, type PublishedOwnedSigner } from '../types'
import { type Store } from '../service'
import { getTagValues, fromNostrDate } from '../util'
import { EventKindHandler } from './EventKindHandler'
export class ProposalHandler extends EventKindHandler {
  private readonly store: Store
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  private readonly checkPsbts: (proposalId: string) => Promise<boolean>
  private readonly getOwnedSigners: () => Promise<PublishedOwnedSigner[]>
  constructor(store: Store, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>, checkPsbts: (proposalId: string) => Promise<boolean>,
    getOwnedSigners: () => Promise<PublishedOwnedSigner[]>) {
    super()
    this.store = store
    this.getSharedKeysById = getSharedKeysById
    this.checkPsbts = checkPsbts
    this.getOwnedSigners = getOwnedSigners
  }

  private searchSignerInDescriptor(fingerprints: string[], descriptor: string): string | null {
    for (const fingerprint of fingerprints) {
      if (descriptor.includes(fingerprint)) {
        return fingerprint
      }
    }
    return null
  }

  protected async _handle<K extends number>(proposalEvents: Array<Event<K>>): Promise<Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>> {
    const proposalIds = proposalEvents.map(proposal => proposal.id)
    const indexKey = 'proposal_id'
    const missingProposalsIds = this.store.missing(proposalIds, indexKey)
    if (missingProposalsIds.length === 0) {
      return this.store.getManyAsArray(proposalIds, indexKey)
    }
    const decryptedProposals: any[] = []
    const policiesIds = proposalEvents.map(proposal => getTagValues(proposal, TagType.Event)[0])
    const sharedKeyAuthenticators = await this.getSharedKeysById(policiesIds)
    const signers = await this.getOwnedSigners()
    const fingerprints: string[] = signers.map(signer => signer.fingerprint)
    for (const proposalEvent of proposalEvents) {
      const storeValue = this.store.get(proposalEvent.id)
      if (storeValue) {
        decryptedProposals.push(storeValue)
        continue
      }
      const policyId = getTagValues(proposalEvent, TagType.Event)[0]
      const sharedKeyAuthenticator = sharedKeyAuthenticators.get(policyId)?.sharedKeyAuthenticator
      if (!sharedKeyAuthenticator) continue
      const decryptedProposalObj: SpendingProposal | ProofOfReserveProposal = await sharedKeyAuthenticator.decryptObj(proposalEvent.content)
      const type = decryptedProposalObj[ProposalType.Spending] ? ProposalType.Spending : ProposalType.ProofOfReserve
      const createdAt = fromNostrDate(proposalEvent.created_at)
      const status = await this.checkPsbts(proposalEvent.id) ? ProposalStatus.Signed : ProposalStatus.Unsigned
      const signerResult: string | null = this.searchSignerInDescriptor(fingerprints, decryptedProposalObj[type].descriptor)
      const signer = signerResult ?? 'Unknown'

      const publishedProposal: PublishedSpendingProposal | PublishedProofOfReserveProposal = {
        type,
        status,
        signer,
        ...decryptedProposalObj[type],
        createdAt,
        policy_id: policyId,
        proposal_id: proposalEvent.id
      }
      decryptedProposals.push(publishedProposal)
    }
    this.store.store(decryptedProposals)
    return decryptedProposals
  }
}
