import { type Event } from 'nostr-tools'
import { PublishedSharedSigner, BaseSharedSigner } from '../types'
import { Store } from "../service";
import { fromNostrDate } from '../util'
import { EventKindHandler } from "./EventKindHandler"
import { Authenticator } from '@smontero/nostr-ual';

export class SharedSignerHandler extends EventKindHandler {

  private store: Store
  private authenticator!: Authenticator
  constructor(authenticator: Authenticator, store: Store) {
    super()
    this.store = store
    this.authenticator = authenticator
  }
  protected async _handle<K extends number>(sharedSignersEvents: Event<K>[]): Promise<PublishedSharedSigner[]> {
    const signers: PublishedSharedSigner[] = [];
    for (const event of sharedSignersEvents) {
      const storeValue = this.store.get(event.id)
      if (storeValue) {
        signers.push(storeValue)
        continue
      }
      const baseDecryptedSigner: BaseSharedSigner = await this.authenticator.decryptObj(event.content, event.pubkey);
      const signer: PublishedSharedSigner = { ...baseDecryptedSigner, id: event.id, ownerPubKey: event.pubkey, createdAt: fromNostrDate(event.created_at) };
      signers.push(signer);
    }
    this.store.store(signers)
    return signers;
  }
}