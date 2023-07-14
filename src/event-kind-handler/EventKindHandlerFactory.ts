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
      switch (eventKind) {
        case CoinstrKind.Policy:
          this.handlers.set(eventKind, new PolicyHandler(stores.get(eventKind)!, bitcoinUtil))
          break
        case CoinstrKind.Proposal:
          this.handlers.set(eventKind, new ProposalHandler(stores.get(eventKind)!))
          break
        case CoinstrKind.ApprovedProposal:
          this.handlers.set(eventKind, new ApprovalsHandler(stores.get(eventKind)!))
          break
        case CoinstrKind.SharedKey:
          this.handlers.set(eventKind, new SharedKeyHandler(authenticator, stores.get(eventKind)!))
          break
        case CoinstrKind.CompletedProposal:
          this.handlers.set(eventKind, new CompletedProposalHandler(stores.get(eventKind)!))
          break
        case CoinstrKind.SharedSigners:
          this.handlers.set(eventKind, new SharedSignerHandler(authenticator, stores.get(eventKind)!))
          break
        case CoinstrKind.Signers:
          this.handlers.set(eventKind, new OwnedSignerHandler(nostrClient, authenticator, stores.get(eventKind)!, bitcoinUtil))
          break
        default:
          throw new Error(`There is no handler for event kind: ${eventKind}`)

      }
    }
    return this.handlers.get(eventKind)!
  }
}