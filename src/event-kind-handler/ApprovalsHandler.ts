import { type Event, Kind } from 'nostr-tools'
import { ProposalType, TagType, ApprovalStatus } from '../enum'
import { type PublishedApprovedProposal, type BaseApprovedProposal, type SharedKeyAuthenticator } from '../types'
import { type Store, type NostrClient } from '../service'
import { getTagValues, fromNostrDate, buildEvent } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type Authenticator } from '@smontero/nostr-ual'
export class ApprovalsHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly nostrClient: NostrClient
  private readonly authenticator: Authenticator
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  constructor(store: Store, eventsStore: Store, nostrClient: NostrClient, authenticator: Authenticator, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.nostrClient = nostrClient
    this.authenticator = authenticator
    this.getSharedKeysById = getSharedKeysById
  }

  protected async _handle<K extends number>(approvalEvents: Array<Event<K>>): Promise<Array<PublishedApprovedProposal>> {
    const policiesIds = approvalEvents.map(proposal => getTagValues(proposal, TagType.Event)[1])
    const indexKey = 'approval_id'
    const approvalIds = approvalEvents.map(approval => approval.id)
    if (!approvalIds.length) return []
    const missingApprovalIds = this.store.missing(approvalIds, indexKey)
    if (missingApprovalIds.length === 0) {
      return this.store.getManyAsArray(approvalIds, indexKey)
    }

    const sharedKeys = await this.getSharedKeysById(policiesIds)
    const approvalPromises = approvalEvents.map(async approvedProposalEvent => {
      const policyId = getTagValues(approvedProposalEvent, TagType.Event)[1]
      const proposalId = getTagValues(approvedProposalEvent, TagType.Event)[0]
      const approvalId = approvedProposalEvent.id

      if (this.store.has(approvalId, indexKey)) {
        return { approvedProposal: this.store.get(approvalId, indexKey), rawEvent: approvedProposalEvent }
      }
      const sharedKeyAuthenticator = sharedKeys.get(policyId)?.sharedKeyAuthenticator
      if (!sharedKeyAuthenticator) return null
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
      return { approvedProposal: publishedApprovedProposal, rawEvent: approvedProposalEvent }
    })

    const results = await Promise.allSettled(approvalPromises);

    type ValidResultType = { approvedProposal: PublishedApprovedProposal, rawEvent: Event<K> };

    const validResults: ValidResultType[] = results.reduce((acc: ValidResultType[], result) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(result.value);
      }
      return acc;
    }, [] as ValidResultType[]);

    const approvedPublishedProposals = validResults.map(res => res!.approvedProposal)
    const rawApprovalEvents = validResults.map(res => res!.rawEvent)
    this.store.store(approvedPublishedProposals)
    this.eventsStore.store(rawApprovalEvents)

    return approvedPublishedProposals

  }

  private _getOwnedApprovals(ids: string[]): Map<string, PublishedApprovedProposal[]> {
    const pubKey = this.authenticator.getPublicKey();
    const storedApprovals: PublishedApprovedProposal[] = this.store.getManyAsArray(ids, 'approval_id');
    const ownedStoredApprovalsIds = storedApprovals.filter(approval => approval.approved_by === pubKey).map(approval => approval.proposal_id);
    return this.store.getMany(ownedStoredApprovalsIds, 'proposal_id');
  }

  protected async _delete(ids: string[]): Promise<any> {
    const ownedApprovalsMap = this._getOwnedApprovals(ids);
    const promises: Promise<any>[] = [];
    for (const [proposal_id, ownedApprovals] of ownedApprovalsMap.entries()) {
      const ownedApprovalsArray = Array.isArray(ownedApprovals) ? ownedApprovals : [ownedApprovals];
      const proposalEvent = this.eventsStore.get(proposal_id);
      if (!proposalEvent) continue;
      const proposalParticipants = getTagValues(proposalEvent, TagType.PubKey).map(pubkey => [TagType.PubKey, pubkey]);
      const eventTags: [TagType, string][] = ownedApprovalsArray.map(approval => [TagType.Event, approval.approval_id]);
      const deleteEvent = await buildEvent({
        kind: Kind.EventDeletion,
        content: '',
        tags: [...eventTags, ...proposalParticipants],
      }, this.authenticator);
      const pub = this.nostrClient.publish(deleteEvent);
      promises.push(pub.onFirstOkOrCompleteFailure());
      this.store.delete(ownedApprovalsArray);
      const rawEvents = ownedApprovalsArray.map(approval => this.eventsStore.get(approval.approval_id));
      this.eventsStore.delete(rawEvents);
    }
    await Promise.all(promises);
  }
}
