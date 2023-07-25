import { EventKindHandler } from "./EventKindHandler";
import { PolicyHandler } from "./PolicyHandler";
import { Coinstr } from "../Coinstr";
import { CoinstrKind } from "../enum";
import { SharedKeyHandler } from "./SharedKeyHandler";
import { ProposalHandler } from "./ProposalHandler";
import { ApprovalsHandler } from "./ApprovalsHandler";
import { CompletedProposalHandler } from "./CompletedProposalHandler";
import { SharedSignerHandler } from "./SharedSignersHandler"
import { OwnedSignerHandler } from "./OwnedSignersHandler";
import { MetadataHandler } from "./MetadataHandler";
import { ContactsHandler } from "./ContactsHandler";
import { EventDeletionHandler } from "./EventDeletionHandler";
import { Kind } from "nostr-tools";
export class EventKindHandlerFactory {
  private coinstr: Coinstr
  private handlers: Map<number, EventKindHandler>
  constructor(coinstr: Coinstr) {
    this.coinstr = coinstr
    this.handlers = new Map()
  }

  getHandler(eventKind: number): EventKindHandler {
    if (!this.handlers.has(eventKind)) {
      const {
        authenticator,
        bitcoinUtil,
        nostrClient,
        stores
      } = this.coinstr
      const getSharedKeysById = this.coinstr.getSharedKeysById
      const checkPsbts = this.coinstr.checkPsbts
      const getOwnedSigners = this.coinstr.getOwnedSigners
      const eventsStore = stores.get(1234)!
      switch (eventKind) {
        case CoinstrKind.Policy:
          this.handlers.set(eventKind, new PolicyHandler(stores.get(eventKind)!, eventsStore, nostrClient, bitcoinUtil, getSharedKeysById))
          break
        case CoinstrKind.Proposal:
          this.handlers.set(eventKind, new ProposalHandler(stores.get(eventKind)!, eventsStore, nostrClient, getSharedKeysById, checkPsbts, getOwnedSigners))
          break
        case CoinstrKind.ApprovedProposal:
          this.handlers.set(eventKind, new ApprovalsHandler(stores.get(eventKind)!, eventsStore, nostrClient, authenticator, getSharedKeysById))
          break
        case CoinstrKind.SharedKey:
          this.handlers.set(eventKind, new SharedKeyHandler(authenticator, stores.get(eventKind)!))
          break
        case CoinstrKind.CompletedProposal:
          this.handlers.set(eventKind, new CompletedProposalHandler(stores.get(eventKind)!, eventsStore, nostrClient, bitcoinUtil, getSharedKeysById))
          break
        case CoinstrKind.SharedSigners:
          this.handlers.set(eventKind, new SharedSignerHandler(authenticator, stores.get(eventKind)!, eventsStore))
          break
        case CoinstrKind.Signers:
          this.handlers.set(eventKind, new OwnedSignerHandler(authenticator, nostrClient, stores.get(eventKind)!, eventsStore))
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
        default:
          throw new Error(`There is no handler for event kind: ${eventKind}`)

      }
    }
    return this.handlers.get(eventKind)!
  }
}