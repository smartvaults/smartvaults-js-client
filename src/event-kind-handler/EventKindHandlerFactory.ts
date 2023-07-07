import { EventKindHandler } from "./EventKindHandler";
import { PolicyHandler } from "./PolicyHandler";
import { Coinstr } from "../Coinstr";
import { CoinstrKind } from "../enum";


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
          this.handlers.set(eventKind, new PolicyHandler(nostrClient, authenticator, stores.get(eventKind)!, bitcoinUtil))
          break
        default:
          throw new Error(`There is no handler for event kind: ${eventKind}`)

      }
    }
    return this.handlers.get(eventKind)!
  }
}