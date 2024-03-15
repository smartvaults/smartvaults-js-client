import { type Event, Kind } from 'nostr-tools'
import { TagType, ProposalType, ProposalStatus, SmartVaultsKind } from '../enum'
import { type SpendingProposal, type PublishedSpendingProposal, type PublishedProofOfReserveProposal, type SharedKeyAuthenticator, type PublishedOwnedSigner, type PublishedApprovedProposal, type PublishedKeyAgentPaymentProposal, type KeyAgentPaymentProposal, type ProofOfReserveProposal, type ActivePublishedProposal } from '../types'
import { type Store, type NostrClient } from '../service'
import { getTagValues, fromNostrDate, buildEvent, BitcoinExchangeRate } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type PublishedPolicy, type BitcoinUtil } from '../models'
import { type Authenticator } from '@smontero/nostr-ual'

export class ProposalHandler extends EventKindHandler {
  private readonly store: Store
  private readonly eventsStore: Store
  private readonly approvalsStore: Store
  private readonly nostrClient: NostrClient
  private readonly bitcoinUtil: BitcoinUtil
  private readonly authenticator: Authenticator
  private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
  private readonly checkPsbts: (proposalId: string) => Promise<boolean>
  private readonly getOwnedSigners: () => Promise<PublishedOwnedSigner[]>
  private readonly getApprovalsByProposalId: (proposal_ids?: string[] | string) => Promise<Map<string, Array<PublishedApprovedProposal>>>
  private readonly bitcoinExchangeRate: BitcoinExchangeRate = BitcoinExchangeRate.getInstance();
  private readonly getPoliciesById: (policy_ids: string[]) => Promise<Map<string, PublishedPolicy>>
  constructor(
    store: Store,
    eventsStore: Store,
    approvalsStore: Store,
    nostrClient: NostrClient,
    bitcoinUtil: BitcoinUtil,
    authenticator: Authenticator,
    getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>, checkPsbts: (proposalId: string) => Promise<boolean>,
    getOwnedSigners: () => Promise<Array<PublishedOwnedSigner>>,
    getApprovalsByProposalId: (proposal_ids?: string[] | string) => Promise<Map<string, Array<PublishedApprovedProposal>>>,
    getPoliciesById: (policy_ids: string[]) => Promise<Map<string, PublishedPolicy>>) {
    super()
    this.store = store
    this.eventsStore = eventsStore
    this.approvalsStore = approvalsStore
    this.nostrClient = nostrClient
    this.bitcoinUtil = bitcoinUtil
    this.authenticator = authenticator
    this.getSharedKeysById = getSharedKeysById
    this.checkPsbts = checkPsbts
    this.getOwnedSigners = getOwnedSigners
    this.getApprovalsByProposalId = getApprovalsByProposalId
    this.getPoliciesById = getPoliciesById
  }

  protected async _handle<K extends number>(proposalEvents: Array<Event<K>>): Promise<Array<ActivePublishedProposal | PublishedKeyAgentPaymentProposal>> {
    const proposalIds = proposalEvents.map(proposal => proposal.id)
    if (!proposalIds.length) return []
    const policiesIds = proposalEvents.map(proposal => getTagValues(proposal, TagType.Event)[0])
    const sharedKeyAuthenticators = await this.getSharedKeysById(policiesIds)
    const statusPromises = proposalIds.map(proposalId =>
      this.checkPsbts(proposalId).then(status => ({ proposalId, status: status ? ProposalStatus.Signed : ProposalStatus.Unsigned }))
    );

    const [statusResults, ownedSigners] = await Promise.all([await Promise.all(statusPromises), this.getOwnedSigners()])

    const bitcoinExchangeRate = await this.bitcoinExchangeRate.getExchangeRate();
    const activeFiatCurrency = this.bitcoinExchangeRate.getActiveFiatCurrency();
    const proposalsStatusMap = new Map(statusResults.map(res => [res.proposalId, res.status]));

    const decryptedProposals: Array<ActivePublishedProposal | PublishedKeyAgentPaymentProposal> = []
    const rawEvents: Array<Event<K>> = []

    const decryptPromises: Promise<any>[] = proposalEvents.map(async (proposalEvent) => {
      const storedProposal: PublishedSpendingProposal | PublishedKeyAgentPaymentProposal = this.store.get(proposalEvent.id, 'proposal_id')

      if (storedProposal) {
        const proposalStatus = proposalsStatusMap.get(proposalEvent.id);
        const isCurrencyChanged = storedProposal.activeFiatCurrency !== activeFiatCurrency;
        const isExchangeRateChanged = storedProposal.bitcoinExchangeRate !== bitcoinExchangeRate;
        const isStatusChanged = proposalStatus !== storedProposal.status;
        const shouldIncludeFiat = 'amount' in storedProposal && storedProposal.amount > 0;

        let updatedProposal: PublishedSpendingProposal | PublishedKeyAgentPaymentProposal = { ...storedProposal };
        let shouldUpdate = false;

        if (proposalStatus && isStatusChanged) {
          updatedProposal.status = proposalStatus;
          shouldUpdate = true;
        }

        if (bitcoinExchangeRate && shouldIncludeFiat && (isCurrencyChanged || isExchangeRateChanged)) {
          const [amountFiat, feeFiat] = await this.bitcoinExchangeRate.convertToFiat([storedProposal.amount, storedProposal.fee], bitcoinExchangeRate);
          updatedProposal = {
            ...updatedProposal,
            amountFiat,
            feeFiat,
            activeFiatCurrency,
            bitcoinExchangeRate,
          };
          shouldUpdate = true;
        }

        if (shouldUpdate) {
          this.store.delete([storedProposal]);
          return { decryptedProposal: updatedProposal, rawEvent: proposalEvent };
        }

        return { decryptedProposal: storedProposal, rawEvent: proposalEvent };
      }

      const policyId = getTagValues(proposalEvent, TagType.Event)[0]
      const sharedKeyAuthenticator = sharedKeyAuthenticators.get(policyId)?.sharedKeyAuthenticator

      if (!sharedKeyAuthenticator) return null

      return sharedKeyAuthenticator.decryptObj(proposalEvent.content).then(async (decryptedProposalObj: SpendingProposal | KeyAgentPaymentProposal | ProofOfReserveProposal) => {
        const type = Object.keys(decryptedProposalObj)[0] as ProposalType;
        const proposalContent = decryptedProposalObj[type]
        const createdAt = fromNostrDate(proposalEvent.created_at)
        const policy = (await this.getPoliciesById([policyId])).get(policyId)
        const signers = await policy?.getExpectedSigners(proposalContent, ownedSigners) || []
        const psbt = proposalContent.psbt
        const utxos = this.bitcoinUtil.getPsbtUtxos(psbt)
        const fee = Number(this.bitcoinUtil.getFee(psbt))
        const status = proposalsStatusMap.get(proposalEvent.id) ?? ProposalStatus.Unsigned
        const shouldIncludeFiat = 'amount' in proposalContent && proposalContent.amount > 0
        let publishedProposal: ActivePublishedProposal;
        const commonProps = {
          type,
          signers,
          fee,
          utxos,
          createdAt,
          policy_id: policyId,
          proposal_id: proposalEvent.id,
          status,
        };
        if (type === ProposalType.Spending) {
          publishedProposal = {
            ...proposalContent,
            ...commonProps,
          } as PublishedSpendingProposal
        } else if (type === ProposalType.KeyAgentPayment) {
          publishedProposal = {
            ...proposalContent,
            ...commonProps,
          } as PublishedKeyAgentPaymentProposal
        } else {
          publishedProposal = {
            ...proposalContent,
            ...commonProps,
          } as PublishedProofOfReserveProposal
        }
        if (bitcoinExchangeRate && shouldIncludeFiat) {
          const [amountFiat, feeFiat] = await this.bitcoinExchangeRate.convertToFiat([proposalContent.amount, fee], bitcoinExchangeRate)
          publishedProposal = publishedProposal as PublishedSpendingProposal | PublishedKeyAgentPaymentProposal
          publishedProposal.amountFiat = amountFiat
          publishedProposal.feeFiat = feeFiat
          publishedProposal.activeFiatCurrency = activeFiatCurrency
          publishedProposal.bitcoinExchangeRate = bitcoinExchangeRate
        }
        return { decryptedProposal: publishedProposal, rawEvent: proposalEvent }
      });
    })

    const results = await Promise.allSettled(decryptPromises)
    const validResults = results.reduce((acc, result) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(result.value);
      }
      return acc;
    }, [] as { decryptedProposal: ActivePublishedProposal, rawEvent: Event<K> }[]);

    decryptedProposals.push(...validResults.map(res => res!.decryptedProposal))
    rawEvents.push(...validResults.map(res => res!.rawEvent))

    this.store.store(decryptedProposals)
    this.eventsStore.store(rawEvents)
    return decryptedProposals
  }

  private async getProposalRelatedEvents(proposalIds: string[]): Promise<Map<SmartVaultsKind, any[]>> {
    const map: Map<SmartVaultsKind, any[]> = new Map()
    const approvals = Array.from((await this.getApprovalsByProposalId(proposalIds)).values()).flat()
    map.set(SmartVaultsKind.ApprovedProposal, approvals)
    return map
  }

  protected async _delete(proposalIds: string[]): Promise<void> {
    const promises: Promise<void>[] = []
    const eventsToDelete: Array<Event<any>> = []
    const approvalsEventsToDelete: Array<PublishedApprovedProposal> = []
    const rawEventsToDelete: Array<Event<any>> = []
    const pubKey = this.authenticator.getPublicKey()
    for (const proposalId of proposalIds) {
      const proposalEvent = this.eventsStore.get(proposalId)
      if (!proposalEvent) continue
      const proposalRelatedEvents = await this.getProposalRelatedEvents([proposalId])
      const approvalsRelatedEvents: Array<PublishedApprovedProposal> | undefined = (proposalRelatedEvents.get(SmartVaultsKind.ApprovedProposal))?.filter(approval => approval.approved_by === pubKey)
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

      if (approvalsRelatedEvents?.length) {
        const approvalsIds = approvalsRelatedEvents.map(approval => approval.approval_id)
        const approvalsRawEventsToDelete = approvalsRelatedEvents.map(approval => this.eventsStore.get(approval.approval_id))
        const approvalsTags: Array<[TagType, string]> = approvalsIds.map(approvalId => [TagType.Event, approvalId])
        const deleteApprovalsEvent = await buildEvent({
          kind: Kind.EventDeletion,
          tags: [...approvalsTags, ...participantsTags],
          content: ''
        }, this.authenticator)
        const pubApprovals = this.nostrClient.publish(deleteApprovalsEvent);
        approvalsEventsToDelete.push(...approvalsRelatedEvents)
        rawEventsToDelete.push(...approvalsRawEventsToDelete)
        promises.push(pubApprovals.onFirstOkOrCompleteFailure());
      }
    }

    await Promise.all(promises)
    this.store.delete(eventsToDelete)
    this.approvalsStore.delete(approvalsEventsToDelete)
    this.eventsStore.delete(rawEventsToDelete)
  }

}
