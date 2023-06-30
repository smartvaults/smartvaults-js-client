import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { generatePrivateKey, nip04} from 'nostr-tools'
import { BitcoinUtil } from './interfaces'
import { CoinstrKind, TagType } from './enum'
import { NostrClient } from './service'
import { buildEvent, filterBuilder, getTagValue, getTagValues, PaginationOpts, toPublished} from './util'
import { Policy, PublishedPolicy, SavePolicyPayload, SharedSigner, OwnedSigner } from './types'

export class Coinstr {
  private authenticator: Authenticator
  private bitcoinUtil: BitcoinUtil
  private nostrClient: NostrClient

  constructor({
    authenticator,
    bitcoinUtil,
    nostrClient,
  }: {
    authenticator: Authenticator,
    bitcoinUtil: BitcoinUtil,
    nostrClient: NostrClient,
  }) {
    this.authenticator = authenticator
    this.bitcoinUtil = bitcoinUtil
    this.nostrClient = nostrClient
  }

  /**
   *
   * Method to handle the policy creation
   * @param {String} name
   * @param {String} description
   * @param {String} miniscript
   * @param {Object} uiMetadata
   * @param {String} pubKey
   * @returns
   */
  async savePolicy({
    name,
    description,
    miniscript,
    uiMetadata,
    createdAt }: SavePolicyPayload): Promise<PublishedPolicy> {
    const extractedPubKeys = this.bitcoinUtil.getKeysFromMiniscript(miniscript)
    const descriptor = this.bitcoinUtil.toDescriptor(miniscript)
    const secretKey = generatePrivateKey()
    let sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(secretKey)
    let policyContent: Policy = {
      name,
      description,
      descriptor,
      uiMetadata
    }

    const tags = extractedPubKeys.map(pubkey => [TagType.PubKey, pubkey])
    const policyEvent = await buildEvent({
      kind: CoinstrKind.Policy,
      content: await sharedKeyAuthenticator.encryptObj(policyContent),
      tags: [...tags],
      createdAt
    },
      sharedKeyAuthenticator)

    const policy: PublishedPolicy = toPublished(policyContent, policyEvent)

    const promises: Promise<void>[] = []

    for (const pubkey of extractedPubKeys) {
      const content = await this.authenticator.encrypt(secretKey, pubkey)
      const sharedKeyEvent = await buildEvent({
        kind: CoinstrKind.SharedKey,
        content,
        tags: [[TagType.Event, policyEvent.id], [TagType.PubKey, pubkey]],
      },
        this.authenticator)
      const pub = this.nostrClient.publish(sharedKeyEvent)
      promises.push(pub.onFirstOkOrCompleteFailure())
    }
    await Promise.all(promises)

    const pub = this.nostrClient.publish(policyEvent)
    await pub.onFirstOkOrCompleteFailure()
    return policy
  }

  /**
   * Get all policies with shared keys
   * @returns {Promise<Policy[]>}
   */
  async getPolicies(paginationOpts: PaginationOpts = {}): Promise<Policy[]> {
    const policiesFilter = filterBuilder()
      .kinds(CoinstrKind.Policy)
      .pubkeys(this.authenticator.getPublicKey())
      .pagination(paginationOpts)
      .toFilters()
    const policyEvents = await this.nostrClient.list(policiesFilter)
    const policyIds = policyEvents.map(policy => policy.id)

    const sharedKeysFilter = filterBuilder()
      .kinds(CoinstrKind.SharedKey)
      .events(policyIds)
      .pubkeys(this.authenticator.getPublicKey())
      .toFilters()

    const sharedKeyEvents = await this.nostrClient.list(sharedKeysFilter)
    const policyIdSharedKeyMap = {}
    for (const sharedKeyEvent of sharedKeyEvents) {
      const eventIds = getTagValues(sharedKeyEvent, TagType.Event)
      eventIds.forEach(id => policyIdSharedKeyMap[id] = sharedKeyEvent)
    }

    const policies: PublishedPolicy[] = []
    for (const policyEvent of policyEvents) {
      const {
        id: policyId
      } = policyEvent
      const sharedKeyEvent = policyIdSharedKeyMap[policyId]
      if (!sharedKeyEvent) {
        console.error(`Shared Key for policy id: ${policyId} not found`)
        continue
      }

      const sharedKey = await this.authenticator.decrypt(
        sharedKeyEvent.content,
        getTagValue(sharedKeyEvent, TagType.PubKey)
      )
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
      const policy = await sharedKeyAuthenticator.decryptObj(policyEvent.content)
      policies.push(toPublished(policy, policyEvent))
    }
    return policies
  }

  disconnect(): void {
    this.nostrClient.disconnect
  }

  /**
   * Fetches signers owned by the user and returns them as an array of OwnedSigner objects.
   * 
   *  
   * @returns {Promise<OwnedSigner[]>} A promise that resolves to an array of OwnedSigner objects.
   * Each OwnedSigner object represents an owned signer and contains all the properties of the base signer object, plus `ownerPubKey' and 'createdAt' properties.
   * 
   * @throws {Error} Throws an error if there's an issue in fetching signer events or decrypting content.
   * 
   * @async
   */
  async getOwnedSigners(): Promise<OwnedSigner[]> {
    const signersFilter = this.buildOwnedSignersFilter()
  
    const signersEvents = await this.nostrClient.list(signersFilter)
  
    const signerPromises: Promise<OwnedSigner>[] = signersEvents.map(async (signersEvent) => {
      const decryptedContent = await this.authenticator.decrypt(signersEvent.content, signersEvent.pubkey)
      const baseSigner = JSON.parse(decryptedContent);
      return { ...baseSigner, ownerPubKey: signersEvent.pubkey, createdAt: signersEvent.created_at};
    });
  
    return await Promise.all(signerPromises)
  }

  /**
   * Fetches all signers that had been shared with the user and returns them as an array of SharedSigner objects.
   * 
   *  
   * @returns {Promise<SharedSigner[]>} A promise that resolves to an array of SharedSigner objects.
   * Each SharedSigner object represents an shared signer and contains all the properties of the base shared signer object, plus `ownerPubKey' and 'createdAt' properties.
   * 
   * @throws {Error} Throws an error if there's an issue in fetching signer events or decrypting content.
   * 
   * @async
   */
  async getSharedSigners(): Promise<SharedSigner[]> {
    const sharedSignersFilter = this.buildSharedSignersFilter();
    const sharedSignersEvents = await this.nostrClient.list(sharedSignersFilter);
    const sharedSignersPromises = sharedSignersEvents
    
      .filter(event => getTagValue(event, TagType.PubKey) === this.authenticator.getPublicKey())
      .map(async event => {
        const decryptedContent = await this.authenticator.decrypt(event.content, event.pubkey);
        const baseSigner = JSON.parse(decryptedContent);
        const signer: SharedSigner = { ...baseSigner, ownerPubKey: event.pubkey, sharedDate: event.created_at};
        return signer;
      });
    
    return Promise.all(sharedSignersPromises);
  }


  // Helper method to create a 'OwnedSigner' event
  // used for testing purposes only
  async _saveOwnedSigner({
    description,
    descriptor,
    fingerprint,
    name,
    t,
    createdAt,
  }: OwnedSigner): Promise<OwnedSigner> {
    let ownerPubKey = this.authenticator.getPublicKey()

    const signer: OwnedSigner = {
      description,
      descriptor,
      fingerprint,
      name,
      t,
      ownerPubKey,
    }
    const content = await this.authenticator.encryptObj(signer)
    const signerEvent = await buildEvent({
      kind: CoinstrKind.Signers,
      content,
      tags: [[TagType.PubKey, ownerPubKey]],
    },
      this.authenticator)
    const pub = this.nostrClient.publish(signerEvent)
    await pub.onFirstOkOrCompleteFailure()
    return {...signer, createdAt }
  }

  // Helper method to create a 'SharedSigner' event.
  // used for testing purposes only
  async _saveSharedSigner({
    descriptor,
    fingerprint,
    sharedDate,
  }: SharedSigner): Promise<SharedSigner> {
    let secretKey = generatePrivateKey()
    let sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(secretKey)

    const signer = {
      descriptor,
      fingerprint,
      ownerPubKey: sharedKeyAuthenticator.getPublicKey(),
    }

    const content = await nip04.encrypt(secretKey, this.authenticator.getPublicKey(), JSON.stringify(signer))
    const signerEvent = await buildEvent({
      kind: CoinstrKind.SharedSigners,
      content,
      tags: [[TagType.PubKey, this.authenticator.getPublicKey()]],
    },
    sharedKeyAuthenticator)

    const pub = this.nostrClient.publish(signerEvent)
    await pub.onFirstOkOrCompleteFailure()
    return {...signer, sharedDate }
  }

  
  private buildSharedSignersFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.SharedSigners)
      .pubkeys(this.authenticator.getPublicKey())
      .toFilters();
  }

  private buildOwnedSignersFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.Signers)
      .pubkeys(this.authenticator.getPublicKey())
      .toFilters();
  }

}

