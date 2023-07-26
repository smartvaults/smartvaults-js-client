import { type Event, Kind } from 'nostr-tools'
import { TagType, ProposalType, ProposalStatus } from '../enum'
import { type SpendingProposal, type ProofOfReserveProposal, type PublishedSpendingProposal, type PublishedProofOfReserveProposal, type SharedKeyAuthenticator, type PublishedOwnedSigner } from '../types'
import { type Store, type NostrClient } from '../service'
import { getTagValues, fromNostrDate, buildEvent } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type BitcoinUtil } from '../models'
export class ProposalHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly nostrClient: NostrClient
  private readonly bitcoinUtil: BitcoinUtil
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  private readonly checkPsbts: (proposalId: string) => Promise<boolean>
  private readonly getOwnedSigners: () => Promise<PublishedOwnedSigner[]>
  constructor(store: Store, eventsStore: Store, nostrClient: NostrClient, bitcoinUtil: BitcoinUtil, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>, checkPsbts: (proposalId: string) => Promise<boolean>,
    getOwnedSigners: () => Promise<PublishedOwnedSigner[]>) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.nostrClient = nostrClient
    this.bitcoinUtil = bitcoinUtil
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
    const rawEvents: Array<Event<K>> = []
    const policiesIds = proposalEvents.map(proposal => getTagValues(proposal, TagType.Event)[0])
    const sharedKeyAuthenticators = await this.getSharedKeysById(policiesIds)
    const signers = await this.getOwnedSigners()
    const fingerprints: string[] = signers.map(signer => signer.fingerprint)
    for (const proposalEvent of proposalEvents) {
      const storeValue = this.store.get(proposalEvent.id)
      if (storeValue) {
        decryptedProposals.push(storeValue)
        rawEvents.push(proposalEvent)
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
      const psbt = decryptedProposalObj[type].psbt
      const fee = this.bitcoinUtil.getFee(psbt)
      const publishedProposal: PublishedSpendingProposal | PublishedProofOfReserveProposal = {
        type,
        status,
        signer,
        fee,
        ...decryptedProposalObj[type],
        createdAt,
        policy_id: policyId,
        proposal_id: proposalEvent.id
      }
      decryptedProposals.push(publishedProposal)
      rawEvents.push(proposalEvent)
    }
    this.store.store(decryptedProposals)
    this.eventsStore.store(rawEvents)
    return decryptedProposals
  }


  protected async _delete(proposalIds: string[]): Promise<void> {
    const promises: Promise<void>[] = []
    const eventsToDelete: Array<Event<any>> = []
    const rawEventsToDelete: Array<Event<any>> = []
    for (const proposalId of proposalIds) {
      const proposalEvent = this.eventsStore.get(proposalId)
      if (!proposalEvent) continue
      const proposalParticipants = getTagValues(proposalEvent, TagType.PubKey)
      const policyId = getTagValues(proposalEvent, TagType.Event)[0]
      const sharedKeyAuth = await this.getSharedKeysById([policyId])
      const sharedKeyAuthenticator = sharedKeyAuth.get(policyId)?.sharedKeyAuthenticator
      if (!sharedKeyAuthenticator) continue
      const eventTag: [TagType, string][] = [[TagType.Event, proposalId]];
      const participantsTags: [TagType, string][] = proposalParticipants?.map(participant => [TagType.PubKey, participant]) ?? []
      const tags: [TagType, string][] = [...eventTag, ...participantsTags]
      const deleteEvent = await buildEvent({
        kind: Kind.EventDeletion,
        tags,
        content: ''
      }, sharedKeyAuthenticator)
      const pub = this.nostrClient.publish(deleteEvent);
      eventsToDelete.push(this.store.get(proposalId, 'proposal_id'))
      rawEventsToDelete.push(proposalEvent)
      promises.push(pub.onFirstOkOrCompleteFailure());
    }
    await Promise.all(promises)
    this.store.delete(eventsToDelete)
    this.eventsStore.delete(rawEventsToDelete)
  }

}
