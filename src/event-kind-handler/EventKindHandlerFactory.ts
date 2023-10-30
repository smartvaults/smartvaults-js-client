import { EventKindHandler } from "./EventKindHandler";
import { PolicyHandler } from "./PolicyHandler";
import { SmartVaults } from "../SmartVaults";
import { SmartVaultsKind, StoreKind } from "../enum";
import { SharedKeyHandler } from "./SharedKeyHandler";
import { ProposalHandler } from "./ProposalHandler";
import { ApprovalsHandler } from "./ApprovalsHandler";
import { CompletedProposalHandler } from "./CompletedProposalHandler";
import { SharedSignerHandler } from "./SharedSignersHandler"
import { OwnedSignerHandler } from "./OwnedSignersHandler";
import { MetadataHandler } from "./MetadataHandler";
import { ContactsHandler } from "./ContactsHandler";
import { EventDeletionHandler } from "./EventDeletionHandler";
import { LabelsHandler } from "./LabelsHandler";
import { SignerOfferingsHandler } from "./SignerOfferingsHandler";
import { Kind } from "nostr-tools";
import { VerifiedKeyAgentsHandler } from "./VerifiedKeyAgentsHandler";
export class EventKindHandlerFactory {
  private smartVaults: SmartVaults
  private handlers: Map<number, EventKindHandler>
  constructor(smartVaults: SmartVaults) {
    this.smartVaults = smartVaults
    this.handlers = new Map()
  }

  getHandler(eventKind: number): EventKindHandler {
    if (!this.handlers.has(eventKind)) {
      const {
        authenticator,
        bitcoinUtil,
        nostrClient,
        stores
      } = this.smartVaults
      const getSharedKeysById = this.smartVaults.getSharedKeysById
      const checkPsbts = this.smartVaults.checkPsbts
      const getOwnedSigners = this.smartVaults.getOwnedSigners
      const getCompletedProposalsByPolicyId = this.smartVaults.getCompletedProposalsByPolicyId
      const getProposalsByPolicyId = this.smartVaults.getProposalsByPolicyId
      const getApprovalsByPolicyId = this.smartVaults.getApprovalsByPolicyId
      const getApprovalsByProposalId = this.smartVaults.getApprovals
      const getSharedSigners = this.smartVaults.getSharedSigners
      const getLabelsByPolicyId = this.smartVaults.getLabelsByPolicyId
      const extractKey = this.smartVaults.extractKey
      const eventsStore = stores.get(StoreKind.Events)!
      const completedProposalsStore = stores.get(SmartVaultsKind.CompletedProposal)!
      const proposalsStore = stores.get(SmartVaultsKind.Proposal)!
      const approvalsStore = stores.get(SmartVaultsKind.ApprovedProposal)!
      const sharedKeysStore = stores.get(SmartVaultsKind.SharedKey)!
      const labelStore = stores.get(SmartVaultsKind.Labels)!
      const network = this.smartVaults.network
      switch (eventKind) {
        case SmartVaultsKind.Policy:
          this.handlers.set(eventKind, new PolicyHandler(stores.get(eventKind)!, eventsStore, completedProposalsStore, proposalsStore, approvalsStore, sharedKeysStore, labelStore, nostrClient, bitcoinUtil, authenticator,
            getSharedKeysById, getCompletedProposalsByPolicyId, getProposalsByPolicyId, getApprovalsByPolicyId, getSharedSigners, getOwnedSigners, getLabelsByPolicyId))
          break
        case SmartVaultsKind.Proposal:
          this.handlers.set(eventKind, new ProposalHandler(stores.get(eventKind)!, eventsStore, approvalsStore, nostrClient, bitcoinUtil, authenticator, getSharedKeysById, checkPsbts, getOwnedSigners, getApprovalsByProposalId))
          break
        case SmartVaultsKind.ApprovedProposal:
          this.handlers.set(eventKind, new ApprovalsHandler(stores.get(eventKind)!, eventsStore, nostrClient, authenticator, getSharedKeysById))
          break
        case SmartVaultsKind.SharedKey:
          this.handlers.set(eventKind, new SharedKeyHandler(authenticator, stores.get(eventKind)!, eventsStore))
          break
        case SmartVaultsKind.CompletedProposal:
          this.handlers.set(eventKind, new CompletedProposalHandler(stores.get(eventKind)!, eventsStore, nostrClient, bitcoinUtil, getSharedKeysById))
          break
        case SmartVaultsKind.SharedSigners:
          this.handlers.set(eventKind, new SharedSignerHandler(authenticator, stores.get(eventKind)!, eventsStore, network, extractKey))
          break
        case SmartVaultsKind.Signers:
          this.handlers.set(eventKind, new OwnedSignerHandler(authenticator, nostrClient, stores.get(eventKind)!, eventsStore, network, extractKey))
          break
        case Kind.Metadata:
          this.handlers.set(eventKind, new MetadataHandler(stores.get(eventKind)!))
          break
        case Kind.Contacts:
          this.handlers.set(eventKind, new ContactsHandler())
          break
        case Kind.EventDeletion:
          this.handlers.set(eventKind, new EventDeletionHandler(stores))
          break
        case SmartVaultsKind.Labels:
          this.handlers.set(eventKind, new LabelsHandler(stores.get(eventKind)!, eventsStore, getSharedKeysById))
          break
        case SmartVaultsKind.VerifiedKeyAgents:
          this.handlers.set(eventKind, new VerifiedKeyAgentsHandler())
          break
        case SmartVaultsKind.SignerOffering:
          this.handlers.set(eventKind, new SignerOfferingsHandler(stores.get(eventKind)!, eventsStore))
          break
        default:
          throw new Error(`There is no handler for event kind: ${eventKind}`)

      }
    }
    return this.handlers.get(eventKind)!
  }
}