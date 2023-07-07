import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { generatePrivateKey, Kind, Event, Filter, Sub } from 'nostr-tools'
import { CoinstrKind, TagType, ProposalType } from './enum'
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
    this.stores.set(CoinstrKind.Policy, new Store("id"))
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
    const publishedPolicy = PublishedPolicy.fromPolicyAndEvent({
      policyContent,
      policyEvent,
      bitcoinUtil: this.bitcoinUtil,
      nostrPublicKeys,
      sharedKeyAuth: sharedKeyAuthenticator
    })
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

  private async _getPolicies(filter: Filter<CoinstrKind.Policy>[]): Promise<PublishedPolicy[]> {
    const policyEvents = await this.nostrClient.list(filter)
    const policyHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.Policy)
    return policyHandler.handle(policyEvents)
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
    createdAt,
    status
  }: CoinstrTypes.SpendProposalPayload): Promise<CoinstrTypes.PublishedSpendingProposal> {

    let { amount, psbt } = await policy.build_trx({
      address: to_address,
      amount: amountDescriptor,
      feeRate: feeRatePriority
    })

    let {
      descriptor,
      nostrPublicKeys,
      sharedKeyAuth
    } = policy

    let proposalContent: CoinstrTypes.SpendingProposal = {
      descriptor,
      description,
      to_address,
      amount,
      psbt
    }
    const tags = nostrPublicKeys.map(pubkey => [TagType.PubKey, pubkey])
    const proposalEvent = await buildEvent({
      kind: CoinstrKind.Proposal,
      content: await sharedKeyAuth.encryptObj(proposalContent),
      tags: [...tags, [TagType.Event, policy.id]],
      createdAt
    },
      sharedKeyAuth)

    const pub = this.nostrClient.publish(proposalEvent)
    await pub.onFirstOkOrCompleteFailure()

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
      ...proposalContent,
      type: ProposalType.Spending,
      policy_id: policy.id,
      proposal_id: proposalEvent.id,
      status,
    }

  }

  subscribe(callback: (eventKind: number, payload: any) => void): Sub<number> {
    let filters = this.subscriptionFilters()
    return this.nostrClient.sub(filters, async (event: Event<number>) => {
      const {
        kind
      } = event
      const handler = this.eventKindHandlerFactor.getHandler(kind)
      try {
        const payload = (await handler.handle(event))[0]
        callback(kind, payload)
      } catch (error) {
        console.error(`failed processing subscription event: ${event}, error: ${error}`)
      }
    })
  }

  private subscriptionFilters(): Filter<number>[] {
    let paginationOpts = {
      since: nostrDate()
    }
    return filterBuilder()
      .kinds(CoinstrKind.Policy)
      .pubkeys(this.authenticator.getPublicKey())
      .pagination(paginationOpts)
      .toFilters()
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
  async getOwnedSigners(): Promise<CoinstrTypes.PublishedOwnedSigner[]> {
    const signersFilter = this.buildOwnedSignersFilter()

    const signersEvents = await this.nostrClient.list(signersFilter)

    const signers: CoinstrTypes.PublishedOwnedSigner[] = [];

    for (const signersEvent of signersEvents) {
      const decryptedContent = await this.authenticator.decrypt(signersEvent.content, signersEvent.pubkey)
      const baseSigner = JSON.parse(decryptedContent);
      signers.push({ ...baseSigner, id: signersEvent.id, ownerPubKey: signersEvent.pubkey, createdAt: fromNostrDate(signersEvent.created_at) });
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
  async getSharedSigners(publicKeys?: string | string[]): Promise<CoinstrTypes.PublishedSharedSigner[]> {
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

    const signers: CoinstrTypes.PublishedSharedSigner[] = [];

    for (const event of sharedSignersEvents) {
      const decryptedContent = await this.authenticator.decrypt(event.content, event.pubkey);
      const baseSigner = JSON.parse(decryptedContent);
      const signer: CoinstrTypes.PublishedSharedSigner = { ...baseSigner, id: event.id, ownerPubKey: event.pubkey, createdAt: fromNostrDate(event.created_at) };
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
  }: CoinstrTypes.SharedSigner, pubKey: string): Promise<CoinstrTypes.PublishedSharedSigner> {

    const ownerPubKey = this.authenticator.getPublicKey()
    const signer: CoinstrTypes.SharedSigner = {
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

    return { ...signer, id, ownerPubKey, createdAt }
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
      .toFilters();
  }

  private buildPolicyFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.Policy)
      .pubkeys(this.authenticator.getPublicKey())
      .toFilters();
  }

  private async getSharedKeysForPolicies(policyEvents?, policy_id?: string): Promise<Record<string, any>> {
    let policyIds: any = []
    if (policy_id) {
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

  private async hasUserApprovedProposal(approvalsMap: { [key: string]: CoinstrTypes.PublishedApprovedProposal[] }, pubkey: string, proposal_id: string): Promise<boolean> {
    const approvals = approvalsMap[proposal_id];
    if (!approvals) return false;
    for (const approval of approvals) {
      if (approval.approved_by === pubkey && approval.status === "active") {
        return true;
      }
    }
    return false;
  }



  /**
   * Fetches all completed proposals.
   *
   * @returns A promise that resolves to an array of completed proposals, both spending and proof-of-reserve types.
   * Each proposal is decrypted and augmented with additional data (e.g., policy_id, proposal_id, completed_by, completion_date, status).
   *
   * @async
   */
  async getCompletedProposals(paginationOpts: PaginationOpts = {}): Promise<(CoinstrTypes.PublishedCompletedSpendingProposal | CoinstrTypes.PublishedCompletedProofOfReserveProposal)[]> {
    const policiesFilter = this.buildPolicyFilter()
    const policyEvents = await this.nostrClient.list(policiesFilter)
    const policyIdSharedKeyMap = await this.getSharedKeysForPolicies(policyEvents)
    const completedProposalsFilter = this.buildCompletedProposalsFilter().pagination(paginationOpts).toFilters()
    const completedProposalEvents = await this.nostrClient.list(completedProposalsFilter)
    const completedProposals: (CoinstrTypes.PublishedCompletedProofOfReserveProposal | CoinstrTypes.PublishedCompletedSpendingProposal)[] = []
    for (const completedProposalEvent of completedProposalEvents) {
      const policyId = getTagValues(completedProposalEvent, TagType.Event)[1]
      const proposalId = getTagValues(completedProposalEvent, TagType.Event)[0]

      const sharedKeyEvent = policyIdSharedKeyMap[policyId]
      if (!sharedKeyEvent) continue;

      const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey)
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
      const decryptedProposal: (CoinstrTypes.CompletedProofOfReserveProposal | CoinstrTypes.CompletedSpendingProposal) = await sharedKeyAuthenticator.decryptObj(completedProposalEvent.content)


      const publishedCompleteProposal = {
        ...decryptedProposal,
        policy_id: policyId,
        proposal_id: proposalId,
        completed_by: completedProposalEvent.pubkey,
        completion_date: fromNostrDate(completedProposalEvent.created_at),
        status: "completed"
      }
      completedProposals.push(publishedCompleteProposal)
    }

    return completedProposals
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
  async getApprovals(proposalIds?: string | string[]): Promise<{ [key: string]: CoinstrTypes.PublishedApprovedProposal[] }> {
    const policiesFilter = this.buildPolicyFilter();
    const policyEvents = await this.nostrClient.list(policiesFilter);
    const policyIdSharedKeyMap = await this.getSharedKeysForPolicies(policyEvents);
    const approvedProposalsFilter = this.buildApprovedProposalsFilter();
    const approvedProposalEvents = await this.nostrClient.list(approvedProposalsFilter);
    const approvedProposalsMap: { [key: string]: any[] } = {};

    const proposalIdsArr: string[] = Array.isArray(proposalIds) ? proposalIds : (proposalIds ? [proposalIds] : []);
    // Convert to Set for faster lookup
    const proposalIdsSet = new Set(proposalIdsArr);

    for (const approvedProposalEvent of approvedProposalEvents) {
      const policyId = getTagValues(approvedProposalEvent, TagType.Event)[1];
      const proposalId = getTagValues(approvedProposalEvent, TagType.Event)[0];

      // Skip the iteration if proposalId is not in proposalIdsSet
      if (proposalIdsSet.size > 0 && !proposalIdsSet.has(proposalId)) continue;

      const sharedKeyEvent = policyIdSharedKeyMap[policyId];
      if (!sharedKeyEvent) continue;

      const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey);
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey);
      const decryptedProposal: CoinstrTypes.BaseApprovedProposal = await sharedKeyAuthenticator.decryptObj(approvedProposalEvent.content);
      const expiration_date = fromNostrDate(getTagValues(approvedProposalEvent, TagType.Expiration)[0]);

      const publishedApprovedProposal: CoinstrTypes.PublishedApprovedProposal = {
        ...decryptedProposal,
        policy_id: policyId,
        proposal_id: proposalId,
        approved_by: approvedProposalEvent.pubkey,
        approval_date: fromNostrDate(approvedProposalEvent.created_at),
        expiration_date,
        status: expiration_date < new Date() ? "expired" : "active",
      }

      approvedProposalsMap[proposalId] = approvedProposalsMap[proposalId] || [];
      approvedProposalsMap[proposalId].push(publishedApprovedProposal);
    }

    return approvedProposalsMap;
  }

  /**
   * Method to retrieve and decrypt not completed proposals.
   * 
   * This method retrieves all not completed proposals, decrypts them using shared keys corresponding to 
   * each policy ID, and returns the decrypted proposals.
   * 
   * @returns A Promise that resolves to an array of decrypted proposals.
   */
  async getProposals(paginationOpts: PaginationOpts = {}): Promise<(CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal)[]> {

    const completedProposals = await this.getCompletedProposals()

    const policiesFilter = filterBuilder()
      .kinds(CoinstrKind.Policy)
      .pubkeys(this.authenticator.getPublicKey())
      .toFilters()

    const policyEvents = await this.nostrClient.list(policiesFilter)
    const policyIdSharedKeyEventMap = await this.getSharedKeysForPolicies(policyEvents)

    const proposalsFilter = this.buildProposalsFilter().pagination(paginationOpts).toFilters()
    const proposalEvents = await this.nostrClient.list(proposalsFilter)
    const decryptedProposals: any[] = []
    const approvals = await this.getApprovals()

    for (const proposalEvent of proposalEvents) {
      const policyId = getTagValues(proposalEvent, TagType.Event)[0]
      const sharedKeyEvent = policyIdSharedKeyEventMap[policyId]

      if (!sharedKeyEvent) continue; // Skip if we don't have the shared key event

      const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey)
      const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
      const decryptedProposal: CoinstrTypes.SpendingProposal | CoinstrTypes.ProofOfReserveProposal = await sharedKeyAuthenticator.decryptObj(proposalEvent.content)
      const type = "to_address" in decryptedProposal ? ProposalType.Spending : ProposalType.ProofOfReserve // There's no way to know the type of proposal from the event, so we need to check the content
      const approvedResult = await this.hasUserApprovedProposal(approvals, this.authenticator.getPublicKey(), proposalEvent.id)
      const status = approvedResult ? "signed" : "unsigned"

      if (completedProposals.find(completedProposal => completedProposal.proposal_id === proposalEvent.id)) continue; // Skip if proposal is already completed
      const publishedProposal: CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal = {
        ...decryptedProposal,
        type,
        policy_id: policyId,
        proposal_id: proposalEvent.id,
        status: status,
      }
      decryptedProposals.push(publishedProposal)
    }

    return decryptedProposals
  }

  //Mock method to create a proposal, this will be replaced when the policy class is created
  async _saveProofOfReserveProposal(policy_id: string, { message, psbt, descriptor, status }): Promise<CoinstrTypes.PublishedProofOfReserveProposal> {

    const policyEvent = await this.getPolicyEvent(policy_id)
    const policyIdSharedKeyMap = await this.getSharedKeysForPolicies(null, policy_id)
    const sharedKeyEvent = policyIdSharedKeyMap[policy_id]

    if (!sharedKeyEvent) {
      throw new Error(`Shared key for policy with id ${policy_id} not found`)
    }

    const policyMembers = policyEvent.tags

    const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey)
    const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)
    const policy = toPublished(await sharedKeyAuthenticator.decryptObj(policyEvent.content), policyEvent)

    //proposal = policy.proof_of_reserve(wallet,message)
    const proposal: CoinstrTypes.ProofOfReserveProposal = {
      message,
      descriptor,
      psbt,
    }

    const content = await sharedKeyAuthenticator.encryptObj(proposal)
    const proposalEvent = await buildEvent({
      kind: CoinstrKind.Proposal,
      content,
      tags: [[TagType.Event, policy.id], ...policyMembers],
    },
      sharedKeyAuthenticator)

    const pub = this.nostrClient.publish(proposalEvent)
    await pub.onFirstOkOrCompleteFailure()
    const proposal_id = proposalEvent.id
    const type = "proof_of_reserve"

    return { ...proposal, proposal_id, type, status, policy_id }

  }

  async _saveApprovedProposal(proposal_id: string): Promise<CoinstrTypes.PublishedApprovedProposal> {
    const proposalEvent = await this.getProposalEvent(proposal_id)
    const policyId = getTagValues(proposalEvent, TagType.Event)[0]
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyIdSharedKeyMap = await this.getSharedKeysForPolicies(null, policyId)
    const sharedKeyEvent = policyIdSharedKeyMap[policyId]

    if (!sharedKeyEvent) {
      throw new Error(`Shared key for policy with id ${policyId} not found`)
    }

    const policyMembers = policyEvent.tags

    const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey)
    const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)

    const decryptedProposal = await sharedKeyAuthenticator.decryptObj(proposalEvent.content)

    const approvedProposal = {
      psbt: decryptedProposal.psbt,
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
      proposal_id,
      psbt: decryptedProposal.psbt,
      policy_id: policyId,
      approved_by: approvedProposalEvent.pubkey,
      approval_date: fromNostrDate(approvedProposalEvent.created_at),
      expiration_date: fromNostrDate(expirationDate),
      status: "active"
    }

    const pub = this.nostrClient.publish(approvedProposalEvent)
    await pub.onFirstOkOrCompleteFailure()

    return publishedApprovedProposal
  }

  async _saveCompletedProposal(proposal_id: string, payload: CoinstrTypes.CompletedProofOfReserveProposal): Promise<any> {
    const proposalEvent = await this.getProposalEvent(proposal_id)
    const policyId = getTagValues(proposalEvent, TagType.Event)[0]
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyIdSharedKeyMap = await this.getSharedKeysForPolicies(null, policyId)
    const sharedKeyEvent = policyIdSharedKeyMap[policyId]

    if (!sharedKeyEvent) {
      throw new Error(`Shared key for policy with id ${policyId} not found`)
    }

    const policyMembers = policyEvent.tags.flatMap(tagArray => tagArray.slice(1));
    const tags = policyMembers.map((member) => [TagType.PubKey, member]);

    const sharedKey = await this.authenticator.decrypt(sharedKeyEvent.content, sharedKeyEvent.pubkey)
    const sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(sharedKey)

    //const decryptedProposal = await sharedKeyAuthenticator.decryptObj(proposalEvent.content)

    const completedProposal: CoinstrTypes.CompletedProofOfReserveProposal | CoinstrTypes.CompletedSpendingProposal = {
      ...payload
    }

    const content = await sharedKeyAuthenticator.encryptObj(completedProposal)

    const completedProposalEvent = await buildEvent({
      kind: CoinstrKind.CompletedProposal,
      content,
      tags: [...tags, [TagType.Event, proposal_id], [TagType.Event, policyId]],
    },
      this.authenticator)

    const pub = this.nostrClient.publish(completedProposalEvent)
    await pub.onFirstOkOrCompleteFailure()

    const publishedCompletedProposal: CoinstrTypes.PublishedCompletedProofOfReserveProposal = {
      ...payload,
      proposal_id,
      policy_id: policyId,
      completed_by: completedProposalEvent.pubkey,
      completion_date: fromNostrDate(completedProposalEvent.created_at),
      status: "completed"
    }

    return publishedCompletedProposal

  }

}

