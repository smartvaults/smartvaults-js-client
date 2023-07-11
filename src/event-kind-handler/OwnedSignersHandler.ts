import { type Event } from 'nostr-tools'
import { PublishedOwnedSigner, BaseOwnedSigner } from '../types'
import { NostrClient, Store } from "../service";
import { fromNostrDate } from '../util'
import { EventKindHandler } from "./EventKindHandler"
import { Authenticator } from '@smontero/nostr-ual';
import { BitcoinUtil } from '../models';

export class OwnedSignerHandler extends EventKindHandler {

  private store: Store
  private authenticator!: Authenticator
  constructor(_: NostrClient, authenticator: Authenticator, store: Store, __: BitcoinUtil) {
    super()
    this.store = store
    this.authenticator = authenticator
  }
  protected async _handle<K extends number>(ownedSignersEvents: Event<K>[]): Promise<PublishedOwnedSigner[]> {
    const signers: PublishedOwnedSigner[] = [];
    for (const signersEvent of ownedSignersEvents) {
      const storeValue = this.store.get(signersEvent.id)
      if (storeValue) {
        signers.push(storeValue)
        continue
      }
      const baseDecryptedSigner: BaseOwnedSigner = await this.authenticator.decryptObj(signersEvent.content, signersEvent.pubkey)
      signers.push({ ...baseDecryptedSigner, id: signersEvent.id, ownerPubKey: signersEvent.pubkey, createdAt: fromNostrDate(signersEvent.created_at) });
    }
    this.store.store(signers)
    return signers;
  }

}