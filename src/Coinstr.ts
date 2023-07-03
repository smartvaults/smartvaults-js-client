import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { generatePrivateKey, Kind, Event } from 'nostr-tools'
import { BitcoinUtil } from './interfaces'
import { CoinstrKind, TagType } from './enum'
import { NostrClient } from './service'
import { buildEvent, filterBuilder, getTagValues, PaginationOpts, toPublished , fromNostrDate} from './util'
import { Contact, ContactProfile, Metadata, Policy, Profile, PublishedPolicy, SavePolicyPayload, SharedSigner, OwnedSigner,
  PublishedOwnedSigner, PublishedSharedSigner, SpendingProposal, ProofOfReserveProposal
} from './types'

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
    nostrPublicKeys,
    createdAt
  }: SavePolicyPayload): Promise<PublishedPolicy> {
    const descriptor = this.bitcoinUtil.toDescriptor(miniscript)
    const secretKey = generatePrivateKey()
    let sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(secretKey)
    let policyContent: Policy = {
      name,
      description,
      descriptor,
      uiMetadata
    }

    const tags = nostrPublicKeys.map(pubkey => [TagType.PubKey, pubkey])
    const policyEvent = await buildEvent({
      kind: CoinstrKind.Policy,
      content: await sharedKeyAuthenticator.encryptObj(policyContent),
      tags: [...tags],
      createdAt
    },
      sharedKeyAuthenticator)

    const policy: PublishedPolicy = toPublished(policyContent, policyEvent)

    const promises: Promise<void>[] = []

    for (const pubkey of nostrPublicKeys) {
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
    const policyIdSharedKeyMap = await this.getSharedKeysForPolicies(policyEvents)

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
        sharedKeyEvent.pubkey
      )
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
      const policy = await sharedKeyAuthenticator.decryptObj(policyEvent.content)
      policies.push(toPublished(policy, policyEvent))
    }
    return policies
}

async getPolicyEvent(policy_id: string): Promise<any> {
  const policiesFilter = filterBuilder()
    .kinds(CoinstrKind.Policy)
    .ids(policy_id)
    .toFilters()
  const policyEvent = await this.nostrClient.list(policiesFilter)

  if(policyEvent.length === 0) {
    throw new Error(`Policy with id ${policy_id} not found`)
  }
  if (policyEvent.length !== 1) {
    throw new Error(`More than one policy with id ${policy_id} found`)
  }

  return policyEvent[0]
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
  async getOwnedSigners(): Promise<PublishedOwnedSigner[]> {
    const signersFilter = this.buildOwnedSignersFilter()

    const signersEvents = await this.nostrClient.list(signersFilter)

    const signers: PublishedOwnedSigner[] = [];

    for (const signersEvent of signersEvents) {
        const decryptedContent = await this.authenticator.decrypt(signersEvent.content, signersEvent.pubkey)
        const baseSigner = JSON.parse(decryptedContent);
        signers.push({ ...baseSigner, id: signersEvent.id, ownerPubKey: signersEvent.pubkey, createdAt: fromNostrDate(signersEvent.created_at)});
    }

    return signers;
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
  async getSharedSigners(publicKeys?: string | string[]): Promise<PublishedSharedSigner[]> {
    let keysToFilter: string[] = [];

    if (typeof publicKeys === "string") {
        keysToFilter = [publicKeys];
    } else if (Array.isArray(publicKeys)) {
        keysToFilter = [...publicKeys];
    }

    let sharedSignersFilter = this.buildSharedSignersFilter();

    if (keysToFilter.length > 0) {
        sharedSignersFilter = sharedSignersFilter.authors(keysToFilter);
    }

    const sharedSignersEvents = await this.nostrClient.list(sharedSignersFilter.toFilters());

    const signers: PublishedSharedSigner[] = [];

    for (const event of sharedSignersEvents) {
        const decryptedContent = await this.authenticator.decrypt(event.content, event.pubkey);
        const baseSigner = JSON.parse(decryptedContent);
        const signer: PublishedSharedSigner = { ...baseSigner,id: event.id, ownerPubKey: event.pubkey, createdAt: fromNostrDate(event.created_at)};
        signers.push(signer);
    }

    return signers;
  }



  /**
   * Asynchronously saves an owned signer by encrypting its properties, building a new event, 
   * and publishing it via `NostrClient`.
   *
   * @async
   * @param {Object} params - Parameters for the owned signer, including `description`, `descriptor`, 
   * `fingerprint`, `name`, `t`.
   * @returns {Promise<OwnedSigner>} A promise that resolves to an OwnedSigner object with encrypted 
   * data and includes the owner's public key and creation date.
   * @throws Will throw an error if the event publishing fails.
   * @example
   * const signer = await saveOwnedSigner({description, descriptor, fingerprint, name, t});
   */
  async saveOwnedSigner({
    description,
    descriptor,
    fingerprint,
    name,
    t,
  }: OwnedSigner): Promise<PublishedOwnedSigner> {
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
      tags: [],
    },
    this.authenticator)
    const pub = this.nostrClient.publish(signerEvent)
    await pub.onFirstOkOrCompleteFailure()
    const id = signerEvent.id
    const createdAt = fromNostrDate(signerEvent.created_at);

    return {...signer, id, ownerPubKey, createdAt }
  }

/**
 * Asynchronously creates and publishes a 'SharedSigner' event.
 *
 * @async
 * @param {Object} params - Parameters for the shared signer, including `descriptor` and `fingerpring`
 * @param {string} pubKey - Public key of the user with whom the signer is being shared.
 * @returns {Promise<SharedSigner>} A promise that resolves to a PublishedSharedSigner object, includes 
 * the owner's public key and shared date.
 * @throws Will throw an error if the event publishing fails.
 * @example
 * const signer = await saveSharedSigner({descriptor, fingerprint}, pubKey);
 */
  async saveSharedSigner({
    descriptor,
    fingerprint,
  }: SharedSigner, pubKey: string): Promise<PublishedSharedSigner> {

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

    const id = signerEvent.id
    const createdAt = fromNostrDate(signerEvent.created_at)

    return {...signer, id, ownerPubKey, createdAt }
  }


  private buildSharedSignersFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.SharedSigners)
      .pubkeys(this.authenticator.getPublicKey())
  }

  private buildOwnedSignersFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.Signers)
      .authors(this.authenticator.getPublicKey())
      .toFilters();
  }

  private buildProposalsFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.Proposal)
      .pubkeys(this.authenticator.getPublicKey())
      .toFilters();
  }

  private async getSharedKeysForPolicies(policyEvents?, policy_id?: string): Promise<Record<string, any>> {
    let policyIds : any = []
    if(policy_id) {
      policyIds.push(policy_id)
    } else {
    policyIds = policyEvents.map(policy => policy.id)
    }

    const sharedKeysFilter = filterBuilder()
      .kinds(CoinstrKind.SharedKey)
      .events(policyIds)
      .pubkeys(this.authenticator.getPublicKey())
      .toFilters()

    const sharedKeyEvents = await this.nostrClient.list(sharedKeysFilter)
    const policyIdSharedKeyEventMap = {}

    for (const sharedKeyEvent of sharedKeyEvents) {
      const eventIds = getTagValues(sharedKeyEvent, TagType.Event)
      eventIds.forEach(id => policyIdSharedKeyEventMap[id] = sharedKeyEvent)
    }

    return policyIdSharedKeyEventMap;
}


  /**
   * Method to retrieve and decrypt proposals.
   * 
   * This method retrieves proposals, decrypts them using shared keys corresponding to 
   * each policy ID, and returns the decrypted proposals.
   * 
   * @returns A Promise that resolves to an array of decrypted proposals.
   */
  async getProposals(): Promise<(SpendingProposal | ProofOfReserveProposal)[]>{

    const policiesFilter = filterBuilder()
      .kinds(CoinstrKind.Policy)
      .pubkeys(this.authenticator.getPublicKey())
      .toFilters()

    const policyEvents = await this.nostrClient.list(policiesFilter)

    const policyIdSharedKeyEventMap = await this.getSharedKeysForPolicies(policyEvents)


    const proposalEvents = await this.nostrClient.list(this.buildProposalsFilter())
    const decryptedProposals: any[] = []

    for (const proposalEvent of proposalEvents) {
      const policyId = getTagValues(proposalEvent, TagType.Event)[0]
      const sharedKeyEvent = policyIdSharedKeyEventMap[policyId]

      if (!sharedKeyEvent) continue; // skip if we don't have the shared key event

      const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey)
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
      const decryptedProposal = await sharedKeyAuthenticator.decryptObj(proposalEvent.content)

      decryptedProposals.push(decryptedProposal)
    }

    return decryptedProposals
}

  //Mock method to create a proposal, this will be replaced when the policy class is created
  async _saveSpendProposal(policy_id: string, {to_address, amount, description}: SpendingProposal, fee_rate: string): Promise<SpendingProposal> {

    const policyEvent = await this.getPolicyEvent(policy_id)
    const policyIdSharedKeyMap = await this.getSharedKeysForPolicies(null,policy_id)
    const sharedKeyEvent = policyIdSharedKeyMap[policy_id]

    if (!sharedKeyEvent) {
      throw new Error(`Shared key for policy with id ${policy_id} not found`)
    }

    const policyMembers = policyEvent.tags.flatMap(tagArray => tagArray.slice(1));
    const tags = policyMembers.map((member) => [TagType.PubKey, member]);

    const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey)
    const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
    const policy = toPublished(await sharedKeyAuthenticator.decryptObj(policyEvent.content), policyEvent)

    //proposal = policy.spend(wallet,addres,amount,description,fee_rate)
    const proposal: SpendingProposal = {
      to_address,
      amount,
      description,
      descriptor: policy.descriptor,
      psbt: fee_rate,
    }

    const content = await sharedKeyAuthenticator.encryptObj(proposal)
    const proposalEvent = await buildEvent({
      kind: CoinstrKind.Proposal,
      content,
      tags: [[TagType.Event, policy.id], ...tags],
    },
      sharedKeyAuthenticator)

    const pub = this.nostrClient.publish(proposalEvent)
    await pub.onFirstOkOrCompleteFailure()

    return proposal

  }

  async _saveProofOfReserveProposal(policy_id: string, {message}: ProofOfReserveProposal): Promise<ProofOfReserveProposal> {

    const policyEvent = await this.getPolicyEvent(policy_id)
    const policyIdSharedKeyMap = await this.getSharedKeysForPolicies(null,policy_id)
    const sharedKeyEvent = policyIdSharedKeyMap[policy_id]

    if (!sharedKeyEvent) {
      throw new Error(`Shared key for policy with id ${policy_id} not found`)
    }

    const policyMembers = policyEvent.tags.flatMap(tagArray => tagArray.slice(1));
    const tags = policyMembers.map((member) => [TagType.PubKey, member]);

    const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey)
    const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
    const policy = toPublished(await sharedKeyAuthenticator.decryptObj(policyEvent.content), policyEvent)

    //proposal = policy.proof_of_reserve(wallet,message)
    const proposal: ProofOfReserveProposal = {
      message,
      descriptor: policy.descriptor,
      psbt: message,
    }

    const content = await sharedKeyAuthenticator.encryptObj(proposal)
    const proposalEvent = await buildEvent({
      kind: CoinstrKind.Proposal,
      content,
      tags: [[TagType.Event, policy.id], ...tags],
    },
      sharedKeyAuthenticator)

    const pub = this.nostrClient.publish(proposalEvent)
    await pub.onFirstOkOrCompleteFailure()

    return proposal

  }

}

