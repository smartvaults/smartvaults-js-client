import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { generatePrivateKey, Kind, Event} from 'nostr-tools'
import { BitcoinUtil } from './interfaces'
import { CoinstrKind, TagType } from './enum'
import { NostrClient } from './service'
import { buildEvent, filterBuilder, getTagValue, getTagValues, PaginationOpts, toPublished} from './util'
import { Contact, ContactProfile, Metadata, Policy, Profile, PublishedPolicy, SavePolicyPayload, SharedSigner, OwnedSigner } from './types'

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

  setAuthenticator(authenticator: Authenticator): void {
    this.authenticator = authenticator
  }

  async upsertContacts(newContacts: Contact | Contact[]): Promise<Event<Kind.Contacts>> {
    newContacts = Array.isArray(newContacts) ? newContacts : [newContacts]
    let contacts = await this.getContacts()
    contacts = Contact.merge(contacts, newContacts)
    const contactsEvent = await buildEvent({
      kind: Kind.Contacts,
      content: "",
      tags: Contact.toTags(contacts),
    },
      this.authenticator)
    const pub = this.nostrClient.publish(contactsEvent)
    await pub.onFirstOkOrCompleteFailure()
    return contactsEvent
  }

  async setProfile(metadata: Metadata): Promise<Profile> {
    const setMetadataEvent = await buildEvent({
      kind: Kind.Metadata,
      content: JSON.stringify(metadata),
      tags: [],
    },
      this.authenticator)
    const pub = this.nostrClient.publish(setMetadataEvent)
    await pub.onFirstOkOrCompleteFailure()
    return {
      publicKey: this.authenticator.getPublicKey(),
      ...metadata
    }
  }

  async getProfile(publicKey?: string): Promise<Profile> {
    publicKey = publicKey || this.authenticator.getPublicKey()
    const [profile] = await this.getProfiles([publicKey])
    return profile
  }

  async getProfiles(publicKeys: string[]): Promise<Profile[]> {
    const metadataFilter = filterBuilder()
      .kinds(Kind.Metadata)
      .authors(publicKeys)
      .toFilters()

    const metadataEvents = await this.nostrClient.list(metadataFilter)
    const eventsMap: Map<string, Event<Kind>> = new Map()
    metadataEvents.forEach(e => eventsMap.set(e.pubkey, e))
    return publicKeys.map(publicKey => {
      if (eventsMap.has(publicKey)) {
        return {
          publicKey,
          ...JSON.parse(eventsMap.get(publicKey)!.content)
        }
      } else {
        return {
          publicKey
        }
      }
    })
  }

  async getContactProfiles(contacts?: Contact[]): Promise<ContactProfile[]> {
    contacts = contacts || await this.getContacts()
    const contactsMap = Contact.toMap(contacts)
    const profiles = await this.getProfiles([...contactsMap.keys()])
    return profiles.map(p => ({ ...contactsMap.get(p.publicKey), ...p }))
  }

  async getContacts(): Promise<Contact[]> {
    const contactsFilter = filterBuilder()
      .kinds(Kind.Contacts)
      .authors(this.authenticator.getPublicKey())
      .toFilter()
    const contactsEvent = await this.nostrClient.get(contactsFilter)
    if (!contactsEvent) {
      return []
    }
    return getTagValues(contactsEvent, TagType.PubKey, (params) => Contact.fromParams(params))
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
    createdAt
  }: SavePolicyPayload): Promise<PublishedPolicy> {
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
  async getPolicies(paginationOpts: PaginationOpts = {}): Promise<PublishedPolicy[]> {

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
  async getSharedSigners(publicKeys?: string | string[]): Promise<SharedSigner[]> {
    const sharedSignersFilter = this.buildSharedSignersFilter();
    let sharedSignersEvents = await this.nostrClient.list(sharedSignersFilter);

    let keysToFilter: string[] = [];

    if (typeof publicKeys === "string") {
        keysToFilter = [publicKeys];
    } else if (Array.isArray(publicKeys)) {
        keysToFilter = [...publicKeys];
    }

    if (keysToFilter.length > 0) {
        sharedSignersEvents = sharedSignersEvents.filter(event => keysToFilter.includes(event.pubkey));
    }

    const sharedSignersPromises = sharedSignersEvents
        .map(async event => {
            const decryptedContent = await this.authenticator.decrypt(event.content, event.pubkey);
            const baseSigner = JSON.parse(decryptedContent);
            const signer: SharedSigner = { ...baseSigner, ownerPubKey: event.pubkey, sharedDate: event.created_at };
            return signer;
        });

    return Promise.all(sharedSignersPromises);
}




  /**
   * Asynchronously saves an owned signer by encrypting its properties, building a new event, 
   * and publishing it via `NostrClient`.
   *
   * @async
   * @param {Object} params - Parameters for the owned signer, including `description`, `descriptor`, 
   * `fingerprint`, `name`, `t`, and `createdAt`.
   * @returns {Promise<OwnedSigner>} A promise that resolves to an OwnedSigner object with encrypted 
   * data and includes the owner's public key and creation date.
   * @throws Will throw an error if the event publishing fails.
   * @example
   * const signer = await saveOwnedSigner({description, descriptor, fingerprint, name, t, createdAt});
   */
  async saveOwnedSigner({
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

    // Use the current date in seconds if sharedDate is not passed in
    createdAt = createdAt ?  createdAt : Math.floor(Date.now() / 1000);

    return {...signer, ownerPubKey, createdAt }
  }

/**
 * Asynchronously creates and publishes a 'SharedSigner' event.
 *
 * @async
 * @param {Object} params - Parameters for the shared signer, including `descriptor`, `fingerprint`, 
 * and `sharedDate`.
 * @param {string} pubKey - Public key of the user with whom the signer is being shared.
 * @returns {Promise<SharedSigner>} A promise that resolves to a SharedSigner object, includes 
 * the owner's public key and shared date.
 * @throws Will throw an error if the event publishing fails.
 * @example
 * const signer = await saveSharedSigner({descriptor, fingerprint, sharedDate}, pubKey);
 */
  async saveSharedSigner({
    descriptor,
    fingerprint,
    sharedDate,
  }: SharedSigner, pubKey: string): Promise<SharedSigner> {

    const ownerPubKey = this.authenticator.getPublicKey()
    const signer: SharedSigner = {
      descriptor,
      fingerprint,
    }
    const content = await this.authenticator.encryptObj(signer, pubKey)
    const signerEvent = await buildEvent({
      kind: CoinstrKind.SharedSigners,
      content,
      tags: [[TagType.PubKey, pubKey]],
    },
      this.authenticator)

    const pub = this.nostrClient.publish(signerEvent)
    await pub.onFirstOkOrCompleteFailure()

    // Use the current date in seconds if sharedDate is not passed in
    sharedDate = sharedDate ? sharedDate : Math.floor(Date.now() / 1000);

    return {...signer, ownerPubKey, sharedDate }
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
      .authors(this.authenticator.getPublicKey())
      .toFilters();
  }

}

