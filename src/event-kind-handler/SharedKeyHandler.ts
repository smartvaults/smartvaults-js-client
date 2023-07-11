import { type Event } from 'nostr-tools'
import { TagType} from '../enum'
import { SharedKeyAuthenticator } from '../types';
import { Store } from "../service";
import { getTagValues } from '../util'
import { EventKindHandler } from "./EventKindHandler"
import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual';

export class SharedKeyHandler extends EventKindHandler {
  private authenticator: Authenticator
  private store: Store

  constructor(authenticator: Authenticator, store: Store) {
    super()
    this.authenticator = authenticator
    this.store = store
  }

  protected async _handle<K extends number>(sharedKeyEvents: Event<K>[]): Promise<SharedKeyAuthenticator[]> {
    const sharedKeyAuthenticators: SharedKeyAuthenticator[] = [];
    for (const sharedKeyEvent of sharedKeyEvents) {
      const policyId = getTagValues(sharedKeyEvent, TagType.Event)[0]
      if (this.store.has(policyId)) {
        sharedKeyAuthenticators.push(this.store.get(policyId));
      }
      const sharedKey = await this.authenticator.decrypt(
        sharedKeyEvent.content,
        sharedKeyEvent.pubkey
      )
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
      sharedKeyAuthenticators.push({ policyId, sharedKeyAuthenticator });
    }
    this.store.store(sharedKeyAuthenticators);
    return sharedKeyAuthenticators;
  }
}