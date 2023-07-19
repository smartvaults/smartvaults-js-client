import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { generatePrivateKey, Kind, Event, Filter, Sub } from 'nostr-tools'
import { CoinstrKind, TagType, ProposalType, ProposalStatus, ApprovalStatus } from './enum'
import { NostrClient, PubPool, Store } from './service'
import { buildEvent, filterBuilder, getTagValues, PaginationOpts, fromNostrDate, toPublished, nostrDate } from './util'
import { BitcoinUtil, Contact, Policy, PublishedPolicy } from './models'
import * as CoinstrTypes from './types'
import { EventKindHandlerFactory } from './event-kind-handler'

export class Coinstr {
  authenticator: Authenticator
  bitcoinUtil: BitcoinUtil
  nostrClient: NostrClient
  stores!: Map<number, Store>
  private eventKindHandlerFactor!: EventKindHandlerFactory

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
    this.initStores()
    this.initEventKindHandlerFactory()
  }

  initStores() {
    this.stores = new Map()
    this.stores.set(CoinstrKind.Policy, Store.createSingleIndexStore("id"))
    this.stores.set(CoinstrKind.Proposal, new Store({ "proposal_id": ["proposal_id"], "policy_id": ["proposal_id", "policy_id"] }))
    this.stores.set(CoinstrKind.ApprovedProposal, new Store({ "approval_id": ["approval_id"], "proposal_id": ["approval_id", "proposal_id"] }))
    this.stores.set(CoinstrKind.SharedKey, Store.createSingleIndexStore("policyId"))
    this.stores.set(CoinstrKind.CompletedProposal, Store.createSingleIndexStore("id"))
    this.stores.set(CoinstrKind.SharedSigners, Store.createSingleIndexStore("id"))
    this.stores.set(CoinstrKind.Signers, Store.createSingleIndexStore("id"))
    this.stores.set(Kind.Metadata, Store.createSingleIndexStore("publicKey"))
  }
  initEventKindHandlerFactory() {
    this.eventKindHandlerFactor = new EventKindHandlerFactory(this)
  }

  setAuthenticator(authenticator: Authenticator): void {
    if (authenticator !== this.authenticator) {
      this.initStores()
      this.initEventKindHandlerFactory()
      this.authenticator = authenticator
    }

  }

  getStore(eventKind: number): Store {
    if (!this.stores.has(eventKind)) {
      throw new Error(`No store for event kind: ${eventKind}`)
    }
    return this.stores.get(eventKind)!
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

  async setProfile(metadata: CoinstrTypes.Metadata): Promise<CoinstrTypes.Profile> {
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

  async getProfile(publicKey?: string): Promise<CoinstrTypes.Profile> {
    publicKey = publicKey || this.authenticator.getPublicKey()
    const [profile] = await this.getProfiles([publicKey])
    return profile
  }

  async getProfiles(publicKeys: string[]): Promise<CoinstrTypes.Profile[]> {
    const store = this.getStore(Kind.Metadata)
    const missingPublicKeysSet = new Set(store.missing(publicKeys))
    const storedPubkeys = publicKeys.filter(pubkey => !missingPublicKeysSet.has(pubkey))
    if (missingPublicKeysSet.size === 0) {
      return store.getManyAsArray(publicKeys)
    }
    const metadataFilter = filterBuilder()
      .kinds(Kind.Metadata)
      .authors(Array.from(missingPublicKeysSet))
      .toFilters()
    const metadataEvents = await this.nostrClient.list(metadataFilter)
    const newProfiles = await this.eventKindHandlerFactor.getHandler(Kind.Metadata).handle(metadataEvents)
    return [...newProfiles, ...store.getManyAsArray(storedPubkeys)]
  }

  async getContactProfiles(contacts?: Contact[]): Promise<CoinstrTypes.ContactProfile[]> {
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
    return this.eventKindHandlerFactor.getHandler(Kind.Contacts).handle([contactsEvent])
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
  }: CoinstrTypes.SavePolicyPayload): Promise<PublishedPolicy> {
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

    const publishedPolicy = PublishedPolicy.fromPolicyAndEvent({
      policyContent,
      policyEvent,
      bitcoinUtil: this.bitcoinUtil,
      nostrPublicKeys,
      sharedKeyAuth: sharedKeyAuthenticator
    })

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
    this.getStore(CoinstrKind.Policy).store(publishedPolicy)
    return publishedPolicy
  }

  /**
   * Get policies in the pagination scope
   * @returns {Promise<PublishedPolicy[]>} 
   *          
   */
  async getPolicies(paginationOpts: PaginationOpts = {}): Promise<PublishedPolicy[]> {

    const policiesFilter = filterBuilder()
      .kinds(CoinstrKind.Policy)
      .pubkeys(this.authenticator.getPublicKey())
      .pagination(paginationOpts)
      .toFilters()
    let policies = await this._getPolicies(policiesFilter)
    return policies
  }

  /**
   * Gets policies by id
   * @returns {Promise<Map<string, PublishedPolicy>>}
   *          
   */
  async getPoliciesById(ids: string[]): Promise<Map<string, PublishedPolicy>> {
    const store = this.getStore(CoinstrKind.Policy)
    const missingIds = store.missing(ids)
    if (missingIds.length) {
      const policiesFilter = filterBuilder()
        .kinds(CoinstrKind.Policy)
        .pubkeys(this.authenticator.getPublicKey())
        .ids(missingIds)
        .toFilters()
      await this._getPolicies(policiesFilter)
    }
    return store.getMany(ids!)
  }

  getSharedKeysById = async (ids: string[]): Promise<Map<string, CoinstrTypes.SharedKeyAuthenticator>> => {
    ids = [...new Set(ids)]; // remove potential duplicates from ids
    const store = this.getStore(CoinstrKind.SharedKey)
    const missingIds = store.missing(ids)
    if (missingIds.length) {
      const sharedKeysFilter = filterBuilder()
        .kinds(CoinstrKind.SharedKey)
        .events(missingIds)
        .pubkeys(this.authenticator.getPublicKey())
        .toFilters()
      await this._getSharedKeys(sharedKeysFilter)
    }
    let storeResult = store.getMany(ids!)
    return storeResult
  }

  private async _getPolicies(filter: Filter<CoinstrKind.Policy>[]): Promise<PublishedPolicy[]> {
    const policyEvents = await this.nostrClient.list(filter)
    const policyHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.Policy)
    return policyHandler.handle(policyEvents)
  }

  private async _getSharedKeys(filter: Filter<CoinstrKind.SharedKey>[]): Promise<Map<string, CoinstrTypes.SharedKeyAuthenticator>> {
    const sharedKeyEvents = await this.nostrClient.list(filter)
    const sharedKeyHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.SharedKey)
    return sharedKeyHandler.handle(sharedKeyEvents)
  }

  async getPolicyEvent(policy_id: string): Promise<any> {
    const policiesFilter = filterBuilder()
      .kinds(CoinstrKind.Policy)
      .ids(policy_id)
      .toFilters()
    const policyEvent = await this.nostrClient.list(policiesFilter)

    if (policyEvent.length === 0) {
      throw new Error(`Policy with id ${policy_id} not found`)
    }
    if (policyEvent.length !== 1) {
      throw new Error(`More than one policy with id ${policy_id} found`)
    }

    return policyEvent[0]
  }

  /**
   * 
   * @param policy to spend from
   * @param to_address destination address
   * @param description spend proposal description
   * @param amountDescriptor amount to spend, can be max or an amount in sats
   * @param feeRatePriority can be low, medium, high or a numeric value for the target block
   */
  async spend({
    policy,
    to_address,
    description,
    amountDescriptor,
    feeRatePriority,
  }: CoinstrTypes.SpendProposalPayload): Promise<CoinstrTypes.PublishedSpendingProposal> {

    let { amount, psbt } = await policy.buildTrx({
      address: to_address,
      amount: amountDescriptor,
      feeRate: feeRatePriority
    })

    let {
      descriptor,
      nostrPublicKeys,
      sharedKeyAuth
    } = policy
    const type = ProposalType.Spending
    let proposalContent: CoinstrTypes.SpendingProposal = {
      [type]: {
        descriptor,
        description,
        to_address,
        amount,
        psbt
      }
    }
    const tags = nostrPublicKeys.map(pubkey => [TagType.PubKey, pubkey])
    const proposalEvent = await buildEvent({
      kind: CoinstrKind.Proposal,
      content: await sharedKeyAuth.encryptObj(proposalContent),
      tags: [...tags, [TagType.Event, policy.id]],
    },
      sharedKeyAuth)

    const pub = this.nostrClient.publish(proposalEvent)
    await pub.onFirstOkOrCompleteFailure()
    const createdAt = fromNostrDate(proposalEvent.created_at)
    let msg = "New spending proposal:\n"
    msg += `- Amount: ${amount}\n`
    msg += `- Description: ${description}\n`
    const promises: Promise<void>[] = []
    for (const publicKey of nostrPublicKeys) {
      if (publicKey !== this.authenticator.getPublicKey()) {
        const pub = await this.sendDirectMsg(msg, publicKey)
        promises.push(pub.onFirstOkOrCompleteFailure())
      }
    }
    Promise.all(promises)
    return {
      ...proposalContent[type],
      type: ProposalType.Spending,
      status: ProposalStatus.Unsigned,
      policy_id: policy.id,
      proposal_id: proposalEvent.id,
      createdAt
    }

  }

  subscribe(kinds: (CoinstrKind | Kind)[] | (CoinstrKind | Kind), callback: (eventKind: number, payload: any) => void): Sub<number> {
    if (!Array.isArray(kinds)) {
      kinds = [kinds]
    }
    const kindsHaveHandler = new Set([...Object.values(CoinstrKind), Kind.Metadata, Kind.Contacts]);
    let filters = this.subscriptionFilters(kinds)
    return this.nostrClient.sub(filters, async (event: Event<number>) => {
      const {
        kind
      } = event

      try {
        if (kindsHaveHandler.has(kind)) {
          const handler = this.eventKindHandlerFactor.getHandler(kind)
          const payload = (await handler.handle(event))[0]
          callback(kind, payload)
        } else {
          callback(kind, event)
        }
      } catch (error) {
        console.error(`failed processing subscription event: ${event}, error: ${error}`)
      }
    })
  }

  private buildFilter(kind: CoinstrKind | Kind, useAuthors = false, paginationOpts: PaginationOpts = {}): Filter<number> {


    let builder = filterBuilder().kinds(kind).pagination(paginationOpts)

    if (useAuthors) {
      builder = builder.authors(this.authenticator.getPublicKey())
    } else {
      builder = builder.pubkeys(this.authenticator.getPublicKey())
    }

    return builder.toFilter()
  }

  private subscriptionFilters(kinds: (CoinstrKind | Kind)[]): Filter<number>[] {
    let filters: Filter<number>[] = [];
    const coinstrKinds = new Set(Object.values(CoinstrKind));
    const kindsSet = new Set(Object.values(Kind));
    const paginationOpts = {
      since: nostrDate()
    }
    for (const kind of kinds) {
      if (coinstrKinds.has(kind as CoinstrKind)) {
        const useAuthors = kind === CoinstrKind.Signers;
        filters.push(this.buildFilter(kind as CoinstrKind, useAuthors, paginationOpts));
      } else if (kindsSet.has(kind as Kind)) {
        const useAuthors = kind === Kind.Metadata || kind === Kind.Contacts;
        filters.push(this.buildFilter(kind as Kind, useAuthors, paginationOpts));
      } else {
        throw new Error(`Invalid kind: ${kind}`);
      }
    }

    return filters;
  }

  disconnect(): void {
    this.nostrClient.disconnect
  }


  private async _getOwnedSigners(filter: Filter<CoinstrKind.Signers>[]): Promise<CoinstrTypes.PublishedOwnedSigner[]> {
    const signersEvents = await this.nostrClient.list(filter)
    const ownedSignerHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.Signers)
    return ownedSignerHandler.handle(signersEvents)
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
  async getOwnedSigners(): Promise<CoinstrTypes.PublishedOwnedSigner[]> {
    const signersFilter = this.buildOwnedSignersFilter()
    return this._getOwnedSigners(signersFilter)
  }


  private async _getSharedSigners(filter: Filter<CoinstrKind.SharedSigners>[]): Promise<CoinstrTypes.PublishedOwnedSigner[]> {
    const signersEvents = await this.nostrClient.list(filter)
    const sharedSignerHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.SharedSigners)
    return sharedSignerHandler.handle(signersEvents)
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
  async getSharedSigners(publicKeys?: string | string[]): Promise<CoinstrTypes.PublishedOwnedSigner[]> {
    const keysToFilter = Array.isArray(publicKeys) ? publicKeys : (publicKeys ? [publicKeys] : []);
    const sharedSignersFilter = this.buildSharedSignersFilter();
    if (keysToFilter.length > 0) {
      sharedSignersFilter.authors(keysToFilter);
    }
    return this._getSharedSigners(sharedSignersFilter.toFilters());
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
  }: CoinstrTypes.OwnedSigner): Promise<CoinstrTypes.PublishedOwnedSigner> {
    let ownerPubKey = this.authenticator.getPublicKey()

    const signer: CoinstrTypes.OwnedSigner = {
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

    return { ...signer, id, ownerPubKey, createdAt }
  }

  /**
   * Asynchronously creates and publishes a 'SharedSigner' event.
   *
   * @async
   * @param {Object} params - Parameters for the shared signer, including `descriptor` and `fingerpring`
   * @param {string} pubKey - Public key of the user with whom the signer is being shared.
   * @returns {Promise<CoinstrTypes.SharedSigner>} A promise that resolves to a PublishedSharedSigner object, includes 
   * the owner's public key and shared date.
   * @throws Will throw an error if the event publishing fails.
   * @example
   * const signer = await saveSharedSigner({descriptor, fingerprint}, pubKey);
   */
  async saveSharedSigner({
    descriptor,
    fingerprint,
  }: CoinstrTypes.SharedSigner, pubKeys: string | string[]): Promise<CoinstrTypes.PublishedSharedSigner[]> {

    if (!Array.isArray(pubKeys)) {
      pubKeys = [pubKeys]
    }
    const ownerPubKey = this.authenticator.getPublicKey()
    const signer: CoinstrTypes.SharedSigner = {
      descriptor,
      fingerprint,
    }
    const sharedSigners: CoinstrTypes.PublishedSharedSigner[] = []
    for (const pubKey of pubKeys) {
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
      sharedSigners.push({ ...signer, id, ownerPubKey, createdAt })
    }
    return sharedSigners
  }

  async sendDirectMsg(msg: string, publicKey: string): Promise<PubPool> {
    const content = await this.authenticator.encrypt(msg, publicKey)
    const directMsgEvent = await buildEvent({
      kind: Kind.EncryptedDirectMessage,
      content,
      tags: [[TagType.PubKey, publicKey]],
    },
      this.authenticator)
    return this.nostrClient.publish(directMsgEvent)
  }

  /**
   * Get direct messages
   * @returns {Promise<CoinstrTypes.PublishedDirectMessage[]>}
   */
  async getDirectMessages(paginationOpts: PaginationOpts = {}): Promise<CoinstrTypes.PublishedDirectMessage[]> {

    const directMessagesFilter = filterBuilder()
      .kinds(Kind.EncryptedDirectMessage)
      .pubkeys(this.authenticator.getPublicKey())
      .pagination(paginationOpts)
      .toFilters()
    const directMessageEvents = await this.nostrClient.list(directMessagesFilter)
    let directMessages: CoinstrTypes.PublishedDirectMessage[] = []
    for (let directMessageEvent of directMessageEvents) {
      let {
        content,
        pubkey
      } = directMessageEvent
      const message = await this.authenticator.decrypt(content, pubkey)
      directMessages.push(toPublished({ message, publicKey: pubkey }, directMessageEvent))
    }
    return directMessages
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
  }

  private buildCompletedProposalsFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.CompletedProposal)
      .pubkeys(this.authenticator.getPublicKey())
  }

  private buildApprovedProposalsFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.ApprovedProposal)
      .pubkeys(this.authenticator.getPublicKey())
  }

  private async getProposalEvent(proposal_id: any) {
    const proposalsFilter = filterBuilder()
      .kinds(CoinstrKind.Proposal)
      .ids(proposal_id)
      .toFilters()

    const proposalEvents = await this.nostrClient.list(proposalsFilter)

    if (proposalEvents.length === 0) {
      throw new Error(`Proposal with id ${proposal_id} not found`)
    }

    if (proposalEvents.length !== 1) {
      throw new Error(`More than one proposal with id ${proposal_id} found`)
    }

    return proposalEvents[0]
  }



  private async _getCompletedProposals(filter: Filter<CoinstrKind.CompletedProposal>[]): Promise<(CoinstrTypes.PublishedCompletedSpendingProposal | CoinstrTypes.PublishedCompletedProofOfReserveProposal)[]> {
    const completedProposalEvents = await this.nostrClient.list(filter)
    const completedProposalHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.CompletedProposal)
    return completedProposalHandler.handle(completedProposalEvents)
  }

  async getCompletedProposalsById(ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, CoinstrTypes.PublishedCompletedSpendingProposal | CoinstrTypes.PublishedCompletedProofOfReserveProposal>> {
    const completedProposalsIds = Array.isArray(ids) ? ids : [ids]
    const store = this.getStore(CoinstrKind.CompletedProposal);
    const missingIds = store.missing(completedProposalsIds);
    if (missingIds.length) {
      const completedProposalsFilter = this.buildCompletedProposalsFilter().ids(missingIds).pagination(paginationOpts).toFilters();
      await this._getCompletedProposals(completedProposalsFilter);
    }
    return store.getMany(completedProposalsIds);
  }

  /**
  * Fetches all completed proposals.
  *
  * @returns A promise that resolves to an array of completed proposals, both spending and proof-of-reserve types.
  * Each proposal is decrypted and augmented with additional data (e.g., policy_id, proposal_id, completed_by, completion_date).
  *
  * @async
  */
  async getCompletedProposals(paginationOpts: PaginationOpts = {}): Promise<(CoinstrTypes.PublishedCompletedSpendingProposal | CoinstrTypes.PublishedCompletedProofOfReserveProposal)[]> {
    const completedProposalsFilter = this.buildCompletedProposalsFilter().pagination(paginationOpts).toFilters()
    const completedProposals = await this._getCompletedProposals(completedProposalsFilter)
    return completedProposals
  }

  private async _getApprovals(filter: Filter<CoinstrKind.ApprovedProposal>[]): Promise<CoinstrTypes.PublishedApprovedProposal[]> {
    const approvedProposalEvents = await this.nostrClient.list(filter)
    const approvedProposalHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.ApprovedProposal)
    return approvedProposalHandler.handle(approvedProposalEvents)
  }

  /**
 * Fetches approved proposals by given proposal IDs.
 * 
 * @param proposalIds - Optional. An array of proposal IDs or a single proposal ID string.
 * If no proposal IDs are provided, the function fetches all approved proposals.
 * @returns A promise that resolves to a map where keys are proposal IDs and values are arrays of associated approved proposals.
 * Each proposal is decrypted and augmented with additional data (e.g., policy_id, proposal_id, approved_by, approval_date, expiration_date, status).
 * 
 * @async
 */
  async getApprovals(proposal_ids?: string[] | string): Promise<Map<string, CoinstrTypes.PublishedApprovedProposal[]>> {
    const proposalIds = Array.isArray(proposal_ids) ? proposal_ids : proposal_ids ? [proposal_ids] : undefined;
    let approvedProposalsFilter = this.buildApprovedProposalsFilter();
    const store = this.getStore(CoinstrKind.ApprovedProposal);
    if (proposalIds) {
      approvedProposalsFilter = approvedProposalsFilter.events(proposalIds);
    }
    await this._getApprovals(approvedProposalsFilter.toFilters());
    return store.getMany(proposalIds, "proposal_id");
  }



  private async _getProposals(filter: Filter<CoinstrKind.Policy>[]): Promise<PublishedPolicy[]> {
    const proposalEvents = await this.nostrClient.list(filter)
    const proposalHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.Proposal)
    return proposalHandler.handle(proposalEvents)
  }

  async getProposalsById(proposal_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal>> {
    const proposalIds = Array.isArray(proposal_ids) ? proposal_ids : [proposal_ids]
    const store = this.getStore(CoinstrKind.Proposal);
    const missingIds = store.missing(proposalIds, "proposal_id");
    if (missingIds.length) {
      const proposalsFilter = this.buildProposalsFilter().ids(missingIds).pagination(paginationOpts).toFilters();
      await this._getProposals(proposalsFilter);
    }
    return store.getMany(proposalIds, "proposal_id");
  }

  async getProposalsByPolicyId(policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal>> {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(CoinstrKind.Proposal);
    const missingIds = store.missing(policyIds, "policy_id");
    if (missingIds.length) {
      const proposalsFilter = this.buildProposalsFilter().events(policyIds).pagination(paginationOpts).toFilters();
      await this._getProposals(proposalsFilter);
    }
    return store.getMany(policyIds, "policy_id");
  }


  /**
   * Method to retrieve and decrypt not completed proposals.
   * 
   * This method retrieves all not completed proposals, decrypts them using shared keys corresponding to 
   * each policy ID, and returns the decrypted proposals.
   * 
   * @returns A Promise that resolves to an array of decrypted proposals.
   */
  async getProposals(paginationOpts: PaginationOpts = {}): Promise<any> {
    const proposalsFilter = this.buildProposalsFilter().pagination(paginationOpts).toFilters()
    const proposals = await this._getProposals(proposalsFilter)
    return proposals
  }


  /**
   * Method to check if a proposal's PSBTs can be finalized.
   *
   * This method retrieves all approvals for a given proposal ID, filters out the approvals that are expired,
   * and checks if the PSBTs for the active approvals can be finalized.
   *
   * @param proposalId - The ID of the proposal to check.
   *
   * @returns A Promise that resolves to a boolean indicating whether the PSBTs for the given proposal can be finalized.
   */
  checkPsbts = async (proposalId: string): Promise<boolean> => {
    try {
      const approvalsMap = await this.getApprovals(proposalId);
      const approvalData = approvalsMap.get(proposalId);

      if (!approvalData) {
        return false;
      }

      const approvals = Array.isArray(approvalData) ? approvalData : [approvalData];

      const psbts: string[] = approvals
        .filter(approval => approval.status === ApprovalStatus.Active)
        .map(activeApproval => activeApproval.psbt);

      return this.bitcoinUtil.canFinalizePsbt(psbts);
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  /**
   * Method to finalize a spending proposal.
   *
   * This method finalizes a spending proposal by doing the following:
   * 1. It retrieves the proposal by ID and ensures it's a spending proposal.
   * 2. It fetches the associated policy.
   * 3. It retrieves all active approvals for the given proposal ID and checks if their PSBTs can be finalized.
   * 4. If the PSBTs can be finalized, it proceeds to finalize the transaction and broadcast the proposal.
   * 5. It then encrypts the completed proposal and builds two events: a completed proposal event and a proposal deletion event.
   * 6. Both events are published 
   * 7. Finally, it constructs and returns the published completed proposal.
   *
   * @param proposalId - The ID of the spending proposal to finalize.
   *
   * @returns A Promise that resolves to a `PublishedCompletedSpendingProposal` object representing the finalized proposal.
   *
   * @throws An error if the proposal or policy cannot be found, if there are no approvals for the proposal, if the PSBTs cannot be finalized, or if the proposal cannot be broadcast.
   */
  async finalizeSpendingProposal(proposalId: string): Promise<CoinstrTypes.PublishedCompletedSpendingProposal> {
    const proposalMap = await this.getProposalsById(proposalId)

    const proposal = proposalMap.get(proposalId) as CoinstrTypes.PublishedSpendingProposal
    if (!proposal) {
      throw new Error(`Proposal with id ${proposalId} not found`)
    }
    const type = proposal.type
    if (type !== ProposalType.Spending) {
      throw new Error(`Proposal with id ${proposalId} is not a spending proposal`)
    }
    const policyId = proposal.policy_id
    const policyMap = await this.getPoliciesById([policyId])
    const policy = policyMap.get(policyId)
    if (!policy) {
      throw new Error(`Policy with for proposal ${proposalId} not found`)
    }
    const approvalsMap = await this.getApprovals(proposalId)
    let approvals = approvalsMap.get(proposalId)
    if (!approvals) {
      throw new Error(`No approvals for ${proposalId} were found`)
    }
    if (!Array.isArray(approvals)) {
      approvals = [approvals]
    }

    const psbts: string[] = approvals
      .filter(approval => approval.status === ApprovalStatus.Active)
      .map(activeApproval => activeApproval.psbt);

    if (!this.bitcoinUtil.canFinalizePsbt(psbts)) {
      throw new Error(`Cannot finalize psbt for proposal ${proposalId}`)
    }

    const txResponse = await policy.finalizeTrx(psbts, true)

    if (!txResponse) {
      throw new Error(`Cannot broadcast proposal ${proposalId}`)
    }

    const policyMembers = policy.nostrPublicKeys.map(pubkey => [TagType.PubKey, pubkey])

    const sharedKeyAuthenticator = policy.sharedKeyAuth

    const completedProposal: CoinstrTypes.CompletedSpendingProposal = {
      [type]: {
        tx: txResponse.trx,
        description: proposal.description,
      }
    }

    const content = await sharedKeyAuthenticator.encryptObj(completedProposal)

    const completedProposalEvent = await buildEvent({
      kind: CoinstrKind.CompletedProposal,
      content,
      tags: [...policyMembers, [TagType.Event, proposalId], [TagType.Event, policy.id]],
    },
      this.authenticator)

    const pub = this.nostrClient.publish(completedProposalEvent)
    const pubCompletedProposalPromise = pub.onFirstOkOrCompleteFailure()

    const deletedProposalEvent = await buildEvent({
      kind: Kind.EventDeletion,
      content: "",
      tags: [...policyMembers, [TagType.Event, proposalId]],
    }
      , sharedKeyAuthenticator)

    const pubDelete = this.nostrClient.publish(deletedProposalEvent)
    const pubDeleteEventPromise = pubDelete.onFirstOkOrCompleteFailure()

    const publishedCompletedProposal: CoinstrTypes.PublishedCompletedSpendingProposal = {
      type,
      ...completedProposal[type],
      proposal_id: proposalId,
      policy_id: policy.id,
      completed_by: completedProposalEvent.pubkey,
      completion_date: fromNostrDate(completedProposalEvent.created_at),
      id: completedProposalEvent.id,
    }
    await Promise.all([pubCompletedProposalPromise, pubDeleteEventPromise])
    return publishedCompletedProposal
  }


  //Mock method to create a proposal, this will be replaced when the policy class is created
  async _saveProofOfReserveProposal(policy_id: string, { "ProofOfReserve": { message, psbt, descriptor } }): Promise<CoinstrTypes.PublishedProofOfReserveProposal> {

    const policyEvent = await this.getPolicyEvent(policy_id)
    const policyMembers = policyEvent.tags

    const sharedKeyAuthenticatorResult: Map<string, CoinstrTypes.SharedKeyAuthenticator> = await this.getSharedKeysById([policy_id])
    const sharedKeyAuthenticator: any = sharedKeyAuthenticatorResult.get(policy_id)?.sharedKeyAuthenticator
    if (!sharedKeyAuthenticator) {
      throw new Error(`Shared key for policy with id ${policy_id} not found`)
    }
    const policy = toPublished(await sharedKeyAuthenticator.decryptObj(policyEvent.content), policyEvent)
    const type = ProposalType.ProofOfReserve
    //proposal = policy.proof_of_reserve(wallet,message)
    const proposal: CoinstrTypes.ProofOfReserveProposal = {
      [type]: {
        message,
        descriptor,
        psbt,
      }
    }

    const content = await sharedKeyAuthenticator.encryptObj(proposal)
    const proposalEvent = await buildEvent({
      kind: CoinstrKind.Proposal,
      content,
      tags: [[TagType.Event, policy.id], ...policyMembers],
    },
      sharedKeyAuthenticator)

    const pub = this.nostrClient.publish(proposalEvent)
    const createdAt = fromNostrDate(proposalEvent.created_at)
    await pub.onFirstOkOrCompleteFailure()
    const proposal_id = proposalEvent.id
    const status = ProposalStatus.Unsigned
    return { ...proposal[type], proposal_id, type, status, policy_id, createdAt }

  }

  async _saveApprovedProposal(proposal_id: string): Promise<CoinstrTypes.PublishedApprovedProposal> {
    const proposalEvent = await this.getProposalEvent(proposal_id)
    const policyId = getTagValues(proposalEvent, TagType.Event)[0]
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyMembers = policyEvent.tags

    const sharedKeyAuthenticator: any = (await this.getSharedKeysById([policyId])).get(policyId)?.sharedKeyAuthenticator

    const decryptedProposalObj = await sharedKeyAuthenticator.decryptObj(proposalEvent.content)
    const type = decryptedProposalObj[ProposalType.Spending] ? ProposalType.Spending : ProposalType.ProofOfReserve

    const approvedProposal: CoinstrTypes.BaseApprovedProposal = {
      [type]: {
        ...decryptedProposalObj[type],
      }
    }

    const expirationDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    const content = await sharedKeyAuthenticator.encryptObj(approvedProposal)
    const approvedProposalEvent = await buildEvent({
      kind: CoinstrKind.ApprovedProposal,
      content,
      tags: [...policyMembers, [TagType.Event, proposal_id], [TagType.Event, policyId], [TagType.Expiration, expirationDate.toString()]],
    },
      this.authenticator)

    const publishedApprovedProposal: CoinstrTypes.PublishedApprovedProposal = {
      type,
      ...decryptedProposalObj[type],
      proposal_id,
      policy_id: policyId,
      approval_id: approvedProposalEvent.id,
      approved_by: approvedProposalEvent.pubkey,
      approval_date: fromNostrDate(approvedProposalEvent.created_at),
      expiration_date: fromNostrDate(expirationDate),
      status: ApprovalStatus.Active,
    }

    const pub = this.nostrClient.publish(approvedProposalEvent)
    await pub.onFirstOkOrCompleteFailure()

    return publishedApprovedProposal
  }

  async _saveCompletedProposal(proposal_id: string, payload: CoinstrTypes.CompletedProofOfReserveProposal | CoinstrTypes.CompletedSpendingProposal): Promise<any> {
    const proposalEvent = await this.getProposalEvent(proposal_id)
    const policyId = getTagValues(proposalEvent, TagType.Event)[0]
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyMembers = policyEvent.tags

    const sharedKeyAuthenticator: any = (await this.getSharedKeysById([policyId])).get(policyId)?.sharedKeyAuthenticator

    const completedProposal: CoinstrTypes.CompletedProofOfReserveProposal | CoinstrTypes.CompletedSpendingProposal = {
      ...payload
    }
    const type = payload[ProposalType.Spending] ? ProposalType.Spending : ProposalType.ProofOfReserve
    const content = await sharedKeyAuthenticator.encryptObj(completedProposal)

    const completedProposalEvent = await buildEvent({
      kind: CoinstrKind.CompletedProposal,
      content,
      tags: [...policyMembers, [TagType.Event, proposal_id], [TagType.Event, policyId]],
    },
      this.authenticator)

    const pub = this.nostrClient.publish(completedProposalEvent)
    await pub.onFirstOkOrCompleteFailure()

    const deletedProposalEvent = await buildEvent({
      kind: Kind.EventDeletion,
      content: "",
      tags: [...policyMembers, [TagType.Event, proposal_id]],
    }
      , sharedKeyAuthenticator)

    const pubDelete = this.nostrClient.publish(deletedProposalEvent)
    pubDelete.onFirstOkOrCompleteFailure()

    const publishedCompletedProposal: CoinstrTypes.PublishedCompletedProofOfReserveProposal | CoinstrTypes.PublishedCompletedSpendingProposal = {
      type,
      ...payload[type],
      proposal_id,
      policy_id: policyId,
      completed_by: completedProposalEvent.pubkey,
      completion_date: fromNostrDate(completedProposalEvent.created_at),
      id: completedProposalEvent.id,
    }

    return publishedCompletedProposal

  }

}

