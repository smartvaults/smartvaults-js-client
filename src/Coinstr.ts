import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { generatePrivateKey, Kind, Event, Filter, Sub } from 'nostr-tools'
import { CoinstrKind, TagType, ProposalType, ProposalStatus, ApprovalStatus, StoreKind, AuthenticatorType } from './enum'
import { NostrClient, PubPool, Store } from './service'
import { buildEvent, filterBuilder, getTagValues, PaginationOpts, fromNostrDate, toPublished, nostrDate } from './util'
import { BasicTrxDetails, BitcoinUtil, Contact, Policy, PublishedPolicy, TrxDetails } from './models'
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
    this.stores.set(CoinstrKind.Proposal, Store.createMultiIndexStore(["proposal_id", "policy_id", "utxo"], "proposal_id"))
    this.stores.set(CoinstrKind.ApprovedProposal, Store.createMultiIndexStore(["approval_id", "proposal_id", "policy_id"], "approval_id"))
    this.stores.set(CoinstrKind.SharedKey, Store.createSingleIndexStore("policyId"))
    this.stores.set(CoinstrKind.CompletedProposal, Store.createMultiIndexStore(["id", "txId", "policy_id"], "id"))
    this.stores.set(CoinstrKind.SharedSigners, Store.createSingleIndexStore("id"))
    this.stores.set(CoinstrKind.Signers, Store.createSingleIndexStore("id"))
    this.stores.set(Kind.Metadata, Store.createSingleIndexStore("id"))
    this.stores.set(StoreKind.Events, Store.createSingleIndexStore("id"))
    this.stores.set(StoreKind.MySharedSigners, Store.createMultiIndexStore(["id", "signerId"], "id"))
    this.stores.set(CoinstrKind.Labels, Store.createMultiIndexStore(["id", "policy_id", "label_id", "unhashed"], "id"))
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

  async removeContacts(contactsToRemove: string | string[]): Promise<Event<Kind.Contacts>> {
    const currentContacts: Contact[] = await this.getContacts()
    const contacts = Contact.remove(contactsToRemove, currentContacts)
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
    const profiles: CoinstrTypes.Profile[] = await this.eventKindHandlerFactor.getHandler(Kind.Metadata).handle(metadataEvents)
    return profiles
  }

  async getContactProfiles(contacts?: Contact[]): Promise<Array<CoinstrTypes.ContactProfile | Contact>> {
    contacts = contacts || await this.getContacts();
    if (!contacts.length) return []
    const profiles = await this.getProfiles(contacts.map(c => c.publicKey));
    const profileMap = new Map(profiles.map(profile => [profile.publicKey, profile]));
    return contacts.map(contact => {
      const profile = profileMap.get(contact.publicKey);
      return profile ? { ...contact, ...profile } : contact;
    });
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

  async getRecommendedContacts(): Promise<Array<CoinstrTypes.Profile | string>> {
    try {
      const [rawSharedSigners, contactList] = await Promise.all([
        this.getSharedSigners(),
        this.getContacts()
      ]);
      if (!rawSharedSigners.length) return [];
      const contactsMap = Contact.toMap(contactList);
      const haveSharedASigner = new Set(rawSharedSigners.map(signer => signer.ownerPubKey!));
      const recommendedPubkeys = [...haveSharedASigner].filter(pubkey => !contactsMap.has(pubkey));
      const maybeProfiles = await this.getProfiles(recommendedPubkeys);
      const profileMap = new Map(maybeProfiles.map(profile => [profile.publicKey, profile]));

      return recommendedPubkeys.map(pubkey => profileMap.get(pubkey) || pubkey);

    } catch (error) {
      console.error("Error in getRecommendedContacts:", error);
      return [];
    }
  }
  /**
   *
   * Method to handle the policy creation
   * @param {String} name
   * @param {String} description
   * @param {String} miniscript
   * @param {String} pubKey
   * @returns
   */
  async savePolicy({
    name,
    description,
    miniscript,
    nostrPublicKeys,
    createdAt
  }: CoinstrTypes.SavePolicyPayload): Promise<PublishedPolicy> {
    const descriptor = this.bitcoinUtil.toDescriptor(miniscript)
    const secretKey = generatePrivateKey()
    let sharedKeyAuthenticator = new DirectPrivateKeyAuthenticator(secretKey)
    let policyContent: Policy = {
      name,
      description,
      descriptor
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
    },
      this.getSharedSigners,
      this.getOwnedSigners,
      this.getProposalsByPolicyId,
      this.getLabelsByPolicyId,
      this.getStore(CoinstrKind.Labels),
    )

    const authenticatorName = this.authenticator.getName()
    let sharedKeyEvents: Array<Event<CoinstrKind.SharedKey>>
    if (authenticatorName === AuthenticatorType.WebExtension) {
      sharedKeyEvents = await this.createSharedKeysSync(nostrPublicKeys, secretKey, policyEvent)
    } else {
      sharedKeyEvents = await this.createSharedKeysAsync(nostrPublicKeys, secretKey, policyEvent)
    }

    const publishedSharedKeyAuthenticators: Array<CoinstrTypes.SharedKeyAuthenticator> = sharedKeyEvents.map(sharedKeyEvent => {
      const id = sharedKeyEvent.id
      const creator = sharedKeyEvent.pubkey
      const policyId = policyEvent.id
      return { id, policyId, creator, sharedKeyAuthenticator, privateKey: secretKey }
    })

    const pub = this.nostrClient.publish(policyEvent)
    await pub.onFirstOkOrCompleteFailure()
    this.getStore(CoinstrKind.Policy).store(publishedPolicy)
    this.getStore(CoinstrKind.SharedKey).store(publishedSharedKeyAuthenticators)
    this.getStore(StoreKind.Events).store([policyEvent, ...sharedKeyEvents])
    return publishedPolicy
  }

  private async createSharedKeysAsync(nostrPublicKeys: string[], secretKey: string, policyEvent: Event<CoinstrKind.Policy>): Promise<Array<Event<CoinstrKind.SharedKey>>> {
    let promises = nostrPublicKeys.map(async pubkey => {
      let content;
      try {
        content = await this.authenticator.encrypt(secretKey, pubkey);
      } catch (err) {
        console.error('Error while encrypting:', err);
        throw err;
      }
      const rawSharedKeyEvent = await buildEvent({
        kind: CoinstrKind.SharedKey,
        content,
        tags: [[TagType.Event, policyEvent.id], [TagType.PubKey, pubkey]],
      },
        this.authenticator)
      const pub = this.nostrClient.publish(rawSharedKeyEvent)
      const pubResult = await pub.onFirstOkOrCompleteFailure()
      return { pubResult, rawSharedKeyEvent }
    })
    let results = await Promise.allSettled(promises)
    const validResults = results.reduce((acc, result) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(result.value);
      } else if (result.status === "rejected") {
        throw new Error(`Error while creating shared key: ${result.reason}`);
      }
      return acc;
    }, [] as { pubResult: void, rawSharedKeyEvent: Event<CoinstrKind.SharedKey> }[]);
    const sharedKeyEvents = validResults.map(res => res!.rawSharedKeyEvent)
    return sharedKeyEvents
  }

  private async createSharedKeysSync(nostrPublicKeys: string[], secretKey: string, policyEvent: Event<CoinstrKind.Policy>): Promise<Array<Event<CoinstrKind.SharedKey>>> {
    const promises: Promise<void>[] = []
    const sharedKeyEvents: Array<{ sharedKeyEvent: Event<CoinstrKind.SharedKey>, pubPromise: Promise<void> }> = []

    for (const pubkey of nostrPublicKeys) {
      let content;
      try {
        content = await this.authenticator.encrypt(secretKey, pubkey);
      } catch (err) {
        console.error('Error while encrypting:', err);
        throw err;
      }
      const sharedKeyEvent = await buildEvent({
        kind: CoinstrKind.SharedKey,
        content,
        tags: [[TagType.Event, policyEvent.id], [TagType.PubKey, pubkey]],
      },
        this.authenticator)

      const pub = this.nostrClient.publish(sharedKeyEvent)
      promises.push(pub.onFirstOkOrCompleteFailure())
      sharedKeyEvents.push({ sharedKeyEvent, pubPromise: pub.onFirstOkOrCompleteFailure() })
    }

    const results = await Promise.allSettled(promises)

    const validResults = results.reduce((acc, result, index) => {
      if (result.status === "fulfilled" && result.value !== null) {
        acc.push(sharedKeyEvents[index].sharedKeyEvent)
      } else if (result.status === "rejected") {
        throw new Error(`Error while creating shared key: ${result.reason}`);
      }
      return acc;
    }, [] as Event<CoinstrKind.SharedKey>[])

    return validResults
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
   * @param policyPath map where the key is the policy node id and the value is the list of the indexes of the items that are intended to be satisfied from the policy node
   */
  async spend({
    policy,
    to_address,
    description,
    amountDescriptor,
    feeRatePriority,
    policyPath,
    utxos,
    useFrozenUtxos = false
  }: CoinstrTypes.SpendProposalPayload): Promise<CoinstrTypes.PublishedSpendingProposal> {

    const _frozenUtxos = await policy.getFrozenUtxosOutpoints()
    const frozenUtxos = useFrozenUtxos ? [] : _frozenUtxos
    const utxosOutpoints = new Set(await policy.getUtxosOutpoints())
    if (utxos?.some(utxo => !utxosOutpoints.has(utxo))) throw new Error("Invalid UTXOs")
    if (!useFrozenUtxos && utxos?.some(utxo => frozenUtxos.includes(utxo))) throw new Error("To use frozen utxos, useFrozenUtxos must be set to true")

    let amount: number;
    let psbt: string;
    try {
      const trx = await policy.buildTrx({
        address: to_address,
        amount: amountDescriptor,
        feeRate: feeRatePriority,
        policyPath,
        utxos,
        frozenUtxos,
      })
      amount = trx.amount
      psbt = trx.psbt
    } catch (err) {
      throw new Error(`Error while building transaction: ${err}`)
    }
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
    const signer = 'Unknown'
    const fee = this.bitcoinUtil.getFee(psbt)
    const utxo = this.bitcoinUtil.getPsbtUtxos(psbt).join('-')
    Promise.all(promises)
    return {
      ...proposalContent[type],
      signer,
      fee,
      utxo,
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
    const kindsHaveHandler = new Set([...Object.values(CoinstrKind), Kind.Metadata, Kind.Contacts, Kind.EventDeletion]);
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
  getOwnedSigners = async (): Promise<CoinstrTypes.PublishedOwnedSigner[]> => {
    const signersFilter = this.buildOwnedSignersFilter()
    return this._getOwnedSigners(signersFilter)
  }

  /**
   * Fetch the signers the user has shared.
   * 
   * @param id - An array of ids or a single id
   * @returns A map of MySharedSigners objects by signerId
   */
  getMySharedSigners = async (id?: string | string[]): Promise<Map<string, CoinstrTypes.MySharedSigner | Array<CoinstrTypes.MySharedSigner>>> => {
    const ids: string[] | undefined = Array.isArray(id) ? id : id ? [id] : undefined;
    const mysharedSignersStore = this.getStore(StoreKind.MySharedSigners)
    let signersFilter = this.buildMySharedSignersFilter()
    if (ids && mysharedSignersStore.has(ids[0], "signerId")) {
      return mysharedSignersStore.getMany(ids, "signerId");
    }
    if (ids) {
      signersFilter = signersFilter.events(ids)
    }
    const mySharedSignersEvents = await this.nostrClient.list(signersFilter.toFilters())
    const missingIds = mysharedSignersStore.missing(mySharedSignersEvents.map(e => e.id), 'id')
    if (missingIds.length === 0) {
      return mysharedSignersStore.getMany(ids, "signerId")
    }
    const missingMySharedSignersEvents = mySharedSignersEvents.filter(e => missingIds.includes(e.id))
    const mySharedSigners = missingMySharedSignersEvents.map(event => {
      const signerId = getTagValues(event, TagType.Event)[0];
      const sharedWith = getTagValues(event, TagType.PubKey)[0];
      const sharedId = event.id;
      const sharedDate = fromNostrDate(event.created_at);

      return { id: sharedId, signerId, sharedWith, sharedDate } as CoinstrTypes.MySharedSigner;
    });
    mysharedSignersStore.store(mySharedSigners)
    return mysharedSignersStore.getMany(ids, "signerId")

  }

  private async _getSharedSigners(filter: Filter<CoinstrKind.SharedSigners>[]): Promise<CoinstrTypes.PublishedSharedSigner[]> {
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
  getSharedSigners = async (publicKeys?: string | string[]): Promise<CoinstrTypes.PublishedSharedSigner[]> => {
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
  async saveSharedSigner(ownedSigner: CoinstrTypes.PublishedOwnedSigner, pubKeys: string | string[]): Promise<CoinstrTypes.PublishedSharedSigner[]> {

    if (!Array.isArray(pubKeys)) {
      pubKeys = [pubKeys]
    }
    const ownerPubKey = this.authenticator.getPublicKey()
    const SharedSigner: CoinstrTypes.SharedSigner = {
      descriptor: ownedSigner.descriptor,
      fingerprint: ownedSigner.fingerprint,
    }
    const sharedSigners: CoinstrTypes.PublishedSharedSigner[] = []
    for (const pubKey of pubKeys) {
      const content = await this.authenticator.encryptObj(SharedSigner, pubKey)
      const signerEvent = await buildEvent({
        kind: CoinstrKind.SharedSigners,
        content,
        tags: [[TagType.Event, ownedSigner.id], [TagType.PubKey, pubKey]],
      },
        this.authenticator)

      const pub = this.nostrClient.publish(signerEvent)
      await pub.onFirstOkOrCompleteFailure()

      const id = signerEvent.id
      const createdAt = fromNostrDate(signerEvent.created_at)
      sharedSigners.push({ ...SharedSigner, id, ownerPubKey, createdAt })
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

  private buildMySharedSignersFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.SharedSigners)
      .authors(this.authenticator.getPublicKey())
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

  private buildLabelsFilter() {
    return filterBuilder()
      .kinds(CoinstrKind.Labels)
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
    return store.getMany(completedProposalsIds, "id");
  }

  getCompletedProposalsByPolicyId = async (policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, (CoinstrTypes.PublishedCompletedSpendingProposal | CoinstrTypes.PublishedCompletedProofOfReserveProposal)
    | Array<CoinstrTypes.PublishedCompletedSpendingProposal | CoinstrTypes.PublishedCompletedProofOfReserveProposal>
  >> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(CoinstrKind.CompletedProposal);
    const missingIds = store.missing(policyIds, "policy_id");
    if (missingIds.length) {
      const completedProposalsFilter = this.buildCompletedProposalsFilter().events(policyIds).pagination(paginationOpts).toFilters();
      await this._getCompletedProposals(completedProposalsFilter);
    }
    return store.getMany(policyIds, "policy_id");
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
  getApprovals = async (proposal_ids?: string[] | string): Promise<Map<string, CoinstrTypes.PublishedApprovedProposal[]>> => {
    const proposalIds = Array.isArray(proposal_ids) ? proposal_ids : proposal_ids ? [proposal_ids] : undefined;
    let approvedProposalsFilter = this.buildApprovedProposalsFilter();
    if (proposalIds) {
      approvedProposalsFilter = approvedProposalsFilter.events(proposalIds);
    }
    const approvalsArray = await this._getApprovals(approvedProposalsFilter.toFilters());
    const approvalsMap = new Map<string, CoinstrTypes.PublishedApprovedProposal[]>();
    approvalsArray.forEach(approval => {
      const proposalId = approval.proposal_id;
      if (approvalsMap.has(proposalId)) {
        approvalsMap.get(proposalId)!.push(approval);
      } else {
        approvalsMap.set(proposalId, [approval]);
      }
    });
    return approvalsMap;
  }

  getApprovalsByPolicyId = async (policy_ids: string[] | string | string): Promise<Map<string, (CoinstrTypes.PublishedApprovedProposal)
    | Array<CoinstrTypes.PublishedApprovedProposal>>> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    let approvedProposalsFilter = this.buildApprovedProposalsFilter();
    const store = this.getStore(CoinstrKind.ApprovedProposal);
    if (policyIds) {
      approvedProposalsFilter = approvedProposalsFilter.events(policyIds);
    }
    await this._getApprovals(approvedProposalsFilter.toFilters());
    return store.getMany(policyIds, "policy_id");
  }



  private async _getProposals(filter: Filter<CoinstrKind.Policy>[]): Promise<Array<CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal>> {
    const proposalEvents = await this.nostrClient.list(filter)
    const proposalHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.Proposal)
    return proposalHandler.handle(proposalEvents)
  }

  async getProposalsById(proposal_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal>> {
    const proposalIds = Array.isArray(proposal_ids) ? proposal_ids : [proposal_ids]
    const store = this.getStore(CoinstrKind.Proposal);
    const proposalsFilter = this.buildProposalsFilter().ids(proposal_ids).pagination(paginationOpts).toFilters();
    await this._getProposals(proposalsFilter);
    return store.getMany(proposalIds, "proposal_id");
  }

  getProposalsByPolicyId = async (policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, (CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal)
    | Array<CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal>
  >> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(CoinstrKind.Proposal);
    const proposalsFilter = this.buildProposalsFilter().events(policyIds).pagination(paginationOpts).toFilters();
    await this._getProposals(proposalsFilter);
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
  async getProposals(paginationOpts: PaginationOpts = {}): Promise<Array<CoinstrTypes.PublishedSpendingProposal | CoinstrTypes.PublishedProofOfReserveProposal>> {
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
    const txId = txResponse.txid
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
      sharedKeyAuthenticator)

    await this.nostrClient.publish(completedProposalEvent).onFirstOkOrCompleteFailure()
    const proposalsIdsToDelete: string[] = (await this.getProposalsWithCommonUtxos(proposal)).map(({ proposal_id }) => proposal_id);
    await this.deleteProposals(proposalsIdsToDelete)


    const publishedCompletedProposal: CoinstrTypes.PublishedCompletedSpendingProposal = {
      type,
      txId,
      ...completedProposal[type],
      proposal_id: proposalId,
      policy_id: policy.id,
      completed_by: completedProposalEvent.pubkey,
      completion_date: fromNostrDate(completedProposalEvent.created_at),
      id: completedProposalEvent.id,
    }
    return publishedCompletedProposal
  }

  private async getProposalsWithCommonUtxos(proposal: CoinstrTypes.PublishedSpendingProposal): Promise<Array<CoinstrTypes.PublishedSpendingProposal>> {
    const utxos = proposal.utxo.split('-');
    const policyId = proposal.policy_id;
    const proposalsMap = await this.getProposalsByPolicyId(policyId);
    const policyProposals = Array.from(proposalsMap.values()).flat() as Array<CoinstrTypes.PublishedSpendingProposal>;

    const utxosSet = new Set(utxos);
    const proposals: Array<CoinstrTypes.PublishedSpendingProposal> = [];

    for (const proposal of policyProposals) {
      const proposalUtxos = proposal.utxo.split('-');
      for (const proposalUtxo of proposalUtxos) {
        if (utxosSet.has(proposalUtxo)) {
          proposals.push(proposal);
          break;
        }
      }
    }
    return proposals;
  }

  /**
   * Retrieves a completed proposal based on the provided transaction details.
   *
   * @async
   * @function getCompletedProposalByTx
   * @param {TrxDetails | BasicTrxDetails} tx - Object containing the transaction details.
   * @returns {Promise<CoinstrTypes.PublishedCompletedSpendingProposal | null>} A Promise that resolves with the completed proposal, if found, or null.
   * 
   * @example
   * getCompletedProposalByTx({txid: '1234', confirmation_time: {confirmedAt: new Date()}, net: -1})
   * 
   */
  async getCompletedProposalByTx(tx: TrxDetails | BasicTrxDetails): Promise<CoinstrTypes.PublishedCompletedSpendingProposal | null> {
    const { txid: txId, confirmation_time: confirmationTime, net: net } = tx;

    if (!txId || net > 0) {
      return null
    }

    const completedProposalStore = this.getStore(CoinstrKind.CompletedProposal);
    const maybeStoredCompletedProposal = await completedProposalStore.get(txId, 'txId');

    if (maybeStoredCompletedProposal) {
      return maybeStoredCompletedProposal;
    }

    let paginationOpts: PaginationOpts = {};
    if (confirmationTime?.confirmedAt) {
      const confirmedAt = confirmationTime.confirmedAt;
      const since = new Date(confirmedAt.getTime() - 3 * 60 * 60 * 1000);
      const until = new Date(confirmedAt.getTime());
      paginationOpts = { since, until };
    }

    const completedProposals = await this.getCompletedProposals(paginationOpts) as CoinstrTypes.PublishedCompletedSpendingProposal[];
    const completedProposal = completedProposals.find(({ txId: id }) => id === txId);

    if (!completedProposal) {
      return null
    }

    return completedProposal;
  }

  async deleteApprovals(ids: string | string[]): Promise<void> {
    const approvalIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(CoinstrKind.ApprovedProposal).delete(approvalIds)
  }

  async deleteProposals(ids: string | string[]): Promise<void> {
    const proposalIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(CoinstrKind.Proposal).delete(proposalIds)
  }

  async deleteCompletedProposals(ids: string | string[]): Promise<void> {
    const completedProposalIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(CoinstrKind.CompletedProposal).delete(completedProposalIds)
  }

  async deleteSigners(ids: string | string[]): Promise<void> {
    const signerIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(CoinstrKind.Signers).delete(signerIds)
  }

  async deletePolicies(ids: string | string[]): Promise<void> {
    const policyIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(CoinstrKind.Policy).delete(policyIds)
  }

  async revokeMySharedSigners(ids: string | string[]): Promise<void> {
    const mySharedSignersStore = this.getStore(StoreKind.MySharedSigners);
    const mySharedSignersToDelete: CoinstrTypes.MySharedSigner[] = [];
    const promises = (Array.isArray(ids) ? ids : [ids]).map(async (sharedSignerId) => {
      const mySharedSignerEvent: CoinstrTypes.MySharedSigner = mySharedSignersStore.get(sharedSignerId, 'id');

      if (!mySharedSignerEvent) {
        throw new Error(`Shared signer with id ${sharedSignerId} not found`);
      }

      const deleteEvent = await buildEvent({
        kind: Kind.EventDeletion,
        content: '',
        tags: [[TagType.Event, mySharedSignerEvent.id], [TagType.PubKey, mySharedSignerEvent.sharedWith]],
      }, this.authenticator);

      mySharedSignersToDelete.push(mySharedSignerEvent);

      return this.nostrClient.publish(deleteEvent).onFirstOkOrCompleteFailure();
    });

    await Promise.all(promises).catch((error) => {
      console.error(error);
    });
    mySharedSignersStore.delete(mySharedSignersToDelete);
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
    const signer = 'Unknown'
    const fee = this.bitcoinUtil.getFee(psbt)
    const utxo = this.bitcoinUtil.getPsbtUtxos(psbt).join('-')
    return { ...proposal[type], proposal_id, type, status, signer, fee, utxo, policy_id, createdAt }

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
    let txId;
    if (type === ProposalType.Spending) {
      const spendingProposal: CoinstrTypes.CompletedSpendingProposal = payload as CoinstrTypes.CompletedSpendingProposal;
      txId = this.bitcoinUtil.getTrxId(spendingProposal[type].tx)
    }
    const completedProposalEvent = await buildEvent({
      kind: CoinstrKind.CompletedProposal,
      content,
      tags: [...policyMembers, [TagType.Event, proposal_id], [TagType.Event, policyId]],
    },
      sharedKeyAuthenticator)

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
      txId,
      ...payload[type],
      proposal_id,
      policy_id: policyId,
      completed_by: completedProposalEvent.pubkey,
      completion_date: fromNostrDate(completedProposalEvent.created_at),
      id: completedProposalEvent.id,
    }

    return publishedCompletedProposal

  }

  private async sha256(str: string): Promise<string> {
    const buffer = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
  }

  async generateIdentifier(labelData: string, sharedKey: string): Promise<string> {
    const unhashedIdentifier = `${sharedKey}:${labelData}`
    const hashedIdentifier = await this.sha256(unhashedIdentifier)
    return hashedIdentifier.substring(0, 32)
  }

  async saveLabel(policyId: string, label: CoinstrTypes.Label): Promise<CoinstrTypes.PublishedLabel> {
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyMembers = policyEvent.tags

    const publishedSharedKeyAuthenticator: CoinstrTypes.SharedKeyAuthenticator | undefined = (await this.getSharedKeysById([policyId])).get(policyId)
    if (!publishedSharedKeyAuthenticator) return {} as CoinstrTypes.PublishedLabel
    const sharedKeyAuthenticator = publishedSharedKeyAuthenticator?.sharedKeyAuthenticator
    const privateKey = publishedSharedKeyAuthenticator?.privateKey
    const labelId = await this.generateIdentifier(Object.values(label.data)[0], privateKey)
    const content = await sharedKeyAuthenticator.encryptObj(label)

    const labelEvent = await buildEvent({
      kind: CoinstrKind.Labels,
      content,
      tags: [...policyMembers, [TagType.Identifier, labelId], [TagType.Event, policyId]],
    },
      sharedKeyAuthenticator)

    const pub = this.nostrClient.publish(labelEvent)
    await pub.onFirstOkOrCompleteFailure()

    const publishedLabel: CoinstrTypes.PublishedLabel = {
      label,
      label_id: labelId,
      policy_id: policyId,
      createdAt: fromNostrDate(labelEvent.created_at),
      id: labelEvent.id,
      unhashed: Object.values(label.data)[0]
    }

    return publishedLabel
  }

  private async _getLabels(filter: Filter<CoinstrKind.Labels>[]): Promise<CoinstrTypes.PublishedLabel[]> {
    const labelEvents = await this.nostrClient.list(filter)
    const labelHandler = this.eventKindHandlerFactor.getHandler(CoinstrKind.Labels)
    return labelHandler.handle(labelEvents)
  }

  async getLabels(paginationOpts: PaginationOpts = {}): Promise<CoinstrTypes.PublishedLabel[]> {
    const labelsFilter = this.buildLabelsFilter().pagination(paginationOpts).toFilters()
    const labels = await this._getLabels(labelsFilter)
    return labels
  }

  getLabelsByPolicyId = async (policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, CoinstrTypes.PublishedLabel | Array<CoinstrTypes.PublishedLabel>>> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(CoinstrKind.Labels);
    const labelsFilter = this.buildLabelsFilter().events(policyIds).pagination(paginationOpts).toFilters();
    await this._getLabels(labelsFilter);
    return store.getMany(policyIds, "policy_id");
  }

  async getLabelById(label_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, CoinstrTypes.PublishedLabel>> {
    const labelIds = Array.isArray(label_ids) ? label_ids : [label_ids]
    const store = this.getStore(CoinstrKind.Labels);
    const labelsFilter = this.buildLabelsFilter().ids(labelIds).pagination(paginationOpts).toFilters();
    await this._getLabels(labelsFilter);
    return store.getMany(labelIds, "label_id");
  }

}
