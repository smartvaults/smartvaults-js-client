import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { generatePrivateKey, Kind, Event, Filter, Sub } from 'nostr-tools'
import { SmartVaultsKind, TagType, ProposalType, ProposalStatus, ApprovalStatus, StoreKind, AuthenticatorType, NetworkType, FiatCurrency, Magic } from './enum'
import { NostrClient, PubPool, Store } from './service'
import { buildEvent, filterBuilder, getTagValues, PaginationOpts, fromNostrDate, toPublished, nostrDate, isNip05Verified, type singleKindFilterParams, FilterBuilder, TimeUtil, CurrencyUtil } from './util'
import { BasicTrxDetails, BaseOwnedSigner, BaseSharedSigner, BitcoinUtil, Contact, Policy, PublishedPolicy, TrxDetails } from './models'
import * as SmartVaultsTypes from './types'
import { EventKindHandlerFactory } from './event-kind-handler'
import { BitcoinExchangeRate, saveFile, readFile } from './util'
import { PaymentType } from './enum/PaymentType'
export class SmartVaults {
  authenticator: Authenticator
  bitcoinUtil: BitcoinUtil
  nostrClient: NostrClient
  stores!: Map<number, Store>
  network: NetworkType
  private readonly authority: string
  private eventKindHandlerFactor!: EventKindHandlerFactory
  private readonly bitcoinExchangeRate: BitcoinExchangeRate = BitcoinExchangeRate.getInstance();

  constructor({
    authenticator,
    bitcoinUtil,
    nostrClient,
    network,
    authority
  }: {
    authenticator: Authenticator,
    bitcoinUtil: BitcoinUtil,
    nostrClient: NostrClient,
    network: NetworkType,
    authority: string
  }) {
    this.authenticator = authenticator
    this.bitcoinUtil = bitcoinUtil
    this.nostrClient = nostrClient
    this.network = network
    this.authority = authority
    this.initStores()
    this.initEventKindHandlerFactory()
  }

  initStores() {
    this.stores = new Map()
    this.stores.set(SmartVaultsKind.Policy, Store.createSingleIndexStore("id"))
    this.stores.set(SmartVaultsKind.Proposal, Store.createMultiIndexStore(["proposal_id", "policy_id"], "proposal_id"))
    this.stores.set(SmartVaultsKind.ApprovedProposal, Store.createMultiIndexStore(["approval_id", "proposal_id", "policy_id"], "approval_id"))
    this.stores.set(SmartVaultsKind.SharedKey, Store.createSingleIndexStore("policyId"))
    this.stores.set(SmartVaultsKind.CompletedProposal, Store.createMultiIndexStore(["id", "txId", "policy_id"], "id"))
    this.stores.set(SmartVaultsKind.SharedSigners, Store.createSingleIndexStore("id"))
    this.stores.set(SmartVaultsKind.Signers, Store.createSingleIndexStore("id"))
    this.stores.set(Kind.Metadata, Store.createSingleIndexStore("id"))
    this.stores.set(StoreKind.Events, Store.createSingleIndexStore("id"))
    this.stores.set(StoreKind.MySharedSigners, Store.createMultiIndexStore(["id", "signerId"], "id"))
    this.stores.set(SmartVaultsKind.Labels, Store.createMultiIndexStore(["id", "policy_id", "label_id", "labelData"], "id"))
    this.stores.set(SmartVaultsKind.SignerOffering, Store.createMultiIndexStore(["id", "offeringId", "keyAgentPubKey", "signerDescriptor"], "id"))
    this.stores.set(SmartVaultsKind.VerifiedKeyAgents, Store.createMultiIndexStore(["eventId", "pubkey"], "pubkey"))
    this.stores.set(SmartVaultsKind.KeyAgents, Store.createSingleIndexStore("pubkey"))
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

  getAuthority(): string {
    return this.authority
  }

  /**
   * Asynchronously upserts contacts and publishes a Contacts event.
   *
   * @async
   * @param {Contact | Contact[]} newContacts - Single or array of Contact objects.
   * @returns {Promise<Event<Kind.Contacts>>} - Resolves to an Event of Kind.Contacts.
   * @throws {Error} - If event publishing fails or if the authenticated user is trying to add himself as a contact.
   *
   * @example
   * const contact = new Contact({ publicKey: 'somePubKey', relay: 'some.relay.com' });
   * await upsertContacts(contact);
   */
  async upsertContacts(newContacts: Contact | Contact[]): Promise<Event<Kind.Contacts>> {
    const authPubKey = this.authenticator.getPublicKey()
    newContacts = Array.isArray(newContacts) ? newContacts : [newContacts]
    if (newContacts.some(c => c.publicKey === authPubKey)) {
      throw new Error('Cannot add self as contact')
    }
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

  /**
   * Asynchronously removes contacts by publicKey and publishes a Contacts event.
   *
   * @async
   * @param {string | string[]} contactsToRemove - publicKeys of contacts to remove.
   * @returns {Promise<Event<Kind.Contacts>>} - Resolves to an Event of Kind.Contacts.
   * @throws {Error} - If removal or event publishing fails.
   *
   * @example
   * await removeContacts('somePubKey');
   * await removeContacts(['somePubKey', 'otherPubKey']);
   */
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

  /**
   * Sets the profile metadata and publishes a Metadata event.
   * 
   * @async
   * @param {SmartVaultsTypes.Metadata} metadata - Metadata for the profile.
   * @returns {Promise<SmartVaultsTypes.Profile>} - The updated profile.
   * @throws {Error} - On failure to set metadata or publish the event.
   * @example
   * await setProfile({ name: 'Alice', about: 'Learning about Smart Vaults' });
   */
  async setProfile(metadata: SmartVaultsTypes.Metadata): Promise<SmartVaultsTypes.Profile> {
    const publicKey = this.authenticator.getPublicKey()
    if (metadata?.nip05) {
      const nip05: string = metadata.nip05;
      const isNip05Verifed = await isNip05Verified(nip05, publicKey);
      if (!isNip05Verifed) {
        throw new Error('Cannot verify NIP05');
      }
    }
    const setMetadataEvent = await buildEvent({
      kind: Kind.Metadata,
      content: JSON.stringify(metadata),
      tags: [],
    },
      this.authenticator)
    const pub = this.nostrClient.publish(setMetadataEvent)
    await pub.onFirstOkOrCompleteFailure()
    return {
      publicKey: publicKey,
      ...metadata
    }
  }

  /**
   * Retrieves a profile by a given public key or uses the instance's public key if not provided.
   * 
   * @async
   * @param {string} [publicKey] - Optional public key to fetch the profile.
   * @returns {Promise<SmartVaultsTypes.Profile>} - The fetched profile.
   * @example
   * const profile = await getProfile('publicKey123');
   */
  async getProfile(publicKey?: string): Promise<SmartVaultsTypes.Profile> {
    publicKey = publicKey || this.authenticator.getPublicKey()
    const [profile] = await this.getProfiles([publicKey])
    return profile
  }

  /**
   * Retrieves multiple profiles by their public keys.
   * 
   * @async
   * @param {string[]} publicKeys - Array of public keys.
   * @returns {Promise<SmartVaultsTypes.Profile[]>} - Array of fetched profiles.
   * @example
   * const profiles = await getProfiles(['publicKey1', 'publicKey2']);
   */
  getProfiles = async (publicKeys: string[]): Promise<SmartVaultsTypes.Profile[]> => {
    const metadataFilter = filterBuilder()
      .kinds(Kind.Metadata)
      .authors(publicKeys)
      .toFilters()
    const metadataEvents = await this.nostrClient.list(metadataFilter)
    const profiles: SmartVaultsTypes.Profile[] = await this.eventKindHandlerFactor.getHandler(Kind.Metadata).handle(metadataEvents)
    return profiles
  }

  /**
   * Retrieves profiles for given contacts or for all contacts if none are provided.
   * 
   * @async
   * @param {Contact[]} [contacts] - Optional array of contacts.
   * @returns {Promise<Array<SmartVaultsTypes.ContactProfile | Contact>>} - Array of profiles or contacts.
   * @example
   * const contactProfiles = await getContactProfiles([{ publicKey: 'key1' }, { publicKey: 'key2' }]);
   */
  async getContactProfiles(contacts?: Contact[]): Promise<Array<SmartVaultsTypes.ContactProfile | Contact>> {
    contacts = contacts || await this.getContacts();
    if (!contacts.length) return []
    const profiles = await this.getProfiles(contacts.map(c => c.publicKey));
    const profileMap = new Map(profiles.map(profile => [profile.publicKey, profile]));
    return contacts.map(contact => {
      const profile = profileMap.get(contact.publicKey);
      return profile ? { ...contact, ...profile } : contact;
    });
  }

  /**
   * Retrieves all contacts for the authenticated user.
   * 
   * @async
   * @returns {Promise<Contact[]>} - Array of contacts.
   * @example
   * const contacts = await getContacts();
   */
  getContacts = async (): Promise<Contact[]> => {
    const contactsFilter = this.getFilter(Kind.Contacts)

    const contactsEvent = await this.nostrClient.list(contactsFilter)
    if (!contactsEvent) {
      return []
    }
    return this.eventKindHandlerFactor.getHandler(Kind.Contacts).handle(contactsEvent)
  }

  /**
   * Retrieves a list of recommended contacts based on shared signers.
   * 
   * @async
   * @returns {Promise<Array<SmartVaultsTypes.Profile | string>>} - Array of profiles or public keys.
   * @throws {Error} - On failure to fetch shared signers or contacts.
   * @example
   * const recommendedContacts = await getRecommendedContacts();
   */
  async getRecommendedContacts(): Promise<Array<SmartVaultsTypes.Profile | string>> {
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
   * Asynchronously saves a new policy and associated shared keys, then publishes the policy event.
   * 
   * @async
   * @param {SmartVaultsTypes.SavePolicyPayload} payload - Payload containing policy details.
   * @param {string} payload.name - The name of the policy.
   * @param {string} payload.description - Description of the policy.
   * @param {string} payload.miniscript - Miniscript representing the policy.
   * @param {string[]} payload.nostrPublicKeys - Public keys of the members of the policy.
   * @param {Date} payload.createdAt - Creation date of the policy.
   * 
   * @returns {Promise<PublishedPolicy>} - A PublishedPolicy instance.
   * @throws {Error} - If the policy cannot be saved or events cannot be published.
   * 
   * @example
   * const payload = {
   *   name: 'My Policy',
   *   description: 'Description here',
   *   miniscript: 'miniscriptString',
   *   nostrPublicKeys: ['key1', 'key2'],
   *   createdAt: new Date()
   * };
   * const publishedPolicy = await savePolicy(payload);
   */
  async savePolicy({
    name,
    description,
    miniscript,
    nostrPublicKeys,
    createdAt
  }: SmartVaultsTypes.SavePolicyPayload): Promise<PublishedPolicy> {
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
      kind: SmartVaultsKind.Policy,
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
      this.getStore(SmartVaultsKind.Labels),
    )

    const authenticatorName = this.authenticator.getName()
    let sharedKeyEvents: Array<Event<SmartVaultsKind.SharedKey>>
    if (authenticatorName === AuthenticatorType.WebExtension) {
      sharedKeyEvents = await this.createSharedKeysSync(nostrPublicKeys, secretKey, policyEvent)
    } else {
      sharedKeyEvents = await this.createSharedKeysAsync(nostrPublicKeys, secretKey, policyEvent)
    }

    const publishedSharedKeyAuthenticators: Array<SmartVaultsTypes.SharedKeyAuthenticator> = sharedKeyEvents.map(sharedKeyEvent => {
      const id = sharedKeyEvent.id
      const creator = sharedKeyEvent.pubkey
      const policyId = policyEvent.id
      return { id, policyId, creator, sharedKeyAuthenticator, privateKey: secretKey }
    })

    const pub = this.nostrClient.publish(policyEvent)
    await pub.onFirstOkOrCompleteFailure()
    this.getStore(SmartVaultsKind.Policy).store(publishedPolicy)
    this.getStore(SmartVaultsKind.SharedKey).store(publishedSharedKeyAuthenticators)
    this.getStore(StoreKind.Events).store([policyEvent, ...sharedKeyEvents])
    return publishedPolicy
  }

  private async createSharedKeysAsync(nostrPublicKeys: string[], secretKey: string, policyEvent: Event<SmartVaultsKind.Policy>): Promise<Array<Event<SmartVaultsKind.SharedKey>>> {
    let promises = nostrPublicKeys.map(async pubkey => {
      let content;
      try {
        content = await this.authenticator.encrypt(secretKey, pubkey);
      } catch (err) {
        console.error('Error while encrypting:', err);
        throw err;
      }
      const rawSharedKeyEvent = await buildEvent({
        kind: SmartVaultsKind.SharedKey,
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
    }, [] as { pubResult: void, rawSharedKeyEvent: Event<SmartVaultsKind.SharedKey> }[]);
    const sharedKeyEvents = validResults.map(res => res!.rawSharedKeyEvent)
    return sharedKeyEvents
  }

  private async createSharedKeysSync(nostrPublicKeys: string[], secretKey: string, policyEvent: Event<SmartVaultsKind.Policy>): Promise<Array<Event<SmartVaultsKind.SharedKey>>> {
    const promises: Promise<void>[] = []
    const sharedKeyEvents: Array<{ sharedKeyEvent: Event<SmartVaultsKind.SharedKey>, pubPromise: Promise<void> }> = []

    for (const pubkey of nostrPublicKeys) {
      let content;
      try {
        content = await this.authenticator.encrypt(secretKey, pubkey);
      } catch (err) {
        console.error('Error while encrypting:', err);
        throw err;
      }
      const sharedKeyEvent = await buildEvent({
        kind: SmartVaultsKind.SharedKey,
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
    }, [] as Event<SmartVaultsKind.SharedKey>[])

    return validResults
  }

  /**
   * Asynchronously retrieves policies within a specified pagination scope.
   *
   * @async
   * @param {PaginationOpts} [paginationOpts={}] - Pagination options for fetching policies.
   * @returns {Promise<PublishedPolicy[]>} - An array of PublishedPolicy objects.
   * @throws {Error} - If unable to fetch policies.
   * 
   * @example
   * const paginationOpts = { limit: 10, page: 2 };
   * const policies = await getPolicies(paginationOpts);
   */
  async getPolicies(paginationOpts: PaginationOpts = {}): Promise<PublishedPolicy[]> {

    const policiesFilter = filterBuilder()
      .kinds(SmartVaultsKind.Policy)
      .pubkeys(this.authenticator.getPublicKey())
      .pagination(paginationOpts)
      .toFilters()
    let policies = await this._getPolicies(policiesFilter)
    return policies
  }

  /**
   * Asynchronously retrieves policies by their IDs.
   *
   * @async
   * @param {string[]} ids - An array of policy IDs.
   * @returns {Promise<Map<string, PublishedPolicy>>} - A map where the key is the policy ID and the value is the PublishedPolicy object.
   * @throws {Error} - If unable to fetch policies by IDs.
   * 
   * @example
   * const ids = ['id1', 'id2'];
   * const policiesById = await getPoliciesById(ids);
   */
  async getPoliciesById(ids: string[]): Promise<Map<string, PublishedPolicy>> {
    const store = this.getStore(SmartVaultsKind.Policy)
    const missingIds = store.missing(ids)
    if (missingIds.length) {
      const policiesFilter = filterBuilder()
        .kinds(SmartVaultsKind.Policy)
        .pubkeys(this.authenticator.getPublicKey())
        .ids(missingIds)
        .toFilters()
      await this._getPolicies(policiesFilter)
    }
    return store.getMany(ids!)
  }

  /**
   * Asynchronously retrieves shared keys by their IDs.
   *
   * @async
   * @param {string[]} ids - An array of shared key IDs.
   * @returns {Promise<Map<string, SmartVaultsTypes.SharedKeyAuthenticator>>} - A map where the key is the shared key ID and the value is the SharedKeyAuthenticator object.
   * @throws {Error} - If unable to fetch shared keys by IDs.
   * 
   * @example
   * const ids = ['id1', 'id2'];
   * const sharedKeysById = await getSharedKeysById(ids);
   */
  getSharedKeysById = async (ids: string[]): Promise<Map<string, SmartVaultsTypes.SharedKeyAuthenticator>> => {
    ids = [...new Set(ids)]; // remove potential duplicates from ids
    const store = this.getStore(SmartVaultsKind.SharedKey)
    const missingIds = store.missing(ids)
    if (missingIds.length) {
      const sharedKeysFilter = filterBuilder()
        .kinds(SmartVaultsKind.SharedKey)
        .events(missingIds)
        .pubkeys(this.authenticator.getPublicKey())
        .toFilters()
      await this._getSharedKeys(sharedKeysFilter)
    }
    let storeResult = store.getMany(ids!)
    return storeResult
  }

  private async _getPolicies(filter: Filter<SmartVaultsKind.Policy>[]): Promise<PublishedPolicy[]> {
    const policyEvents = await this.nostrClient.list(filter)
    const policyHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.Policy)
    return policyHandler.handle(policyEvents)
  }

  private async _getSharedKeys(filter: Filter<SmartVaultsKind.SharedKey>[]): Promise<Map<string, SmartVaultsTypes.SharedKeyAuthenticator>> {
    const sharedKeyEvents = await this.nostrClient.list(filter)
    const sharedKeyHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.SharedKey)
    return sharedKeyHandler.handle(sharedKeyEvents)
  }

  async getPolicyEvent(policy_id: string): Promise<any> {
    const policiesFilter = filterBuilder()
      .kinds(SmartVaultsKind.Policy)
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
   * Asynchronously initiates a spending proposal.
   *
   * @async
   * @param {SmartVaultsTypes.SpendProposalPayload} payload - Payload for the spending proposal.
   * @param {Policy} payload.policy - The policy under which the spending will be proposed.
   * @param {string} payload.to_address - The target address where funds will be sent.
   * @param {string} payload.description - A description of the spend proposal.
   * @param {number} payload.amountDescriptor - The amount to be sent, can be max or an amount in sats.
   * @param {string | number} payload.feeRatePriority - Can be low, medium, high or a numeric value for the target block.
   * @param {Map<string, number[]>} payload.policyPath - The policy path (a map where the key is the policy node id and the value is the list of the indexes of the items that are intended to be satisfied from the policy node).
   * @param {string[]} [payload.utxos] - Optional: The UTXOs to be used.
   * @param {boolean} [payload.useFrozenUtxos=false] - Optional: Whether or not to use frozen UTXOs.
   *
   * @returns {Promise<SmartVaultsTypes.PublishedSpendingProposal>} - The published spending proposal.
   * 
   * @throws {Error} - If invalid UTXOs are provided.
   * @throws {Error} - If frozen UTXOs are provided but 'useFrozenUtxos' is not set to true.
   * @throws {Error} - If an error occurs while building the transaction.
   * @throws {Error} - If an error occurs while publishing the proposal.
   *
   * @example
   * const payload = {
   *   policy,
   *   to_address: "abc123",
   *   description: "A spending proposal",
   *   amountDescriptor: 10,
   *   feeRatePriority: 'high',
   *   policyPath: new Map([['nodeId',[0,1,2]]]),
   *   utxos: ["utxo1", "utxo2"],
   *   useFrozenUtxos: false
   * };
   * const spendingProposal = await spend(payload);
   */
  async spend({
    policy,
    to_address,
    description,
    amountDescriptor,
    feeRatePriority,
    policyPath,
    utxos,
    useFrozenUtxos = false,
    keyAgentPayment
  }: SmartVaultsTypes.SpendProposalPayload): Promise<SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedKeyAgentPaymentProposal> {

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

    let proposalContent: SmartVaultsTypes.SpendingProposal | SmartVaultsTypes.KeyAgentPaymentProposal;

    if (keyAgentPayment) {
      proposalContent = {
        [ProposalType.KeyAgentPayment]: {
          descriptor,
          description,
          to_address,
          amount,
          psbt,
          ...keyAgentPayment
        }
      } as SmartVaultsTypes.KeyAgentPaymentProposal;
    } else {
      proposalContent = {
        [ProposalType.Spending]: {
          descriptor,
          description,
          to_address,
          amount,
          psbt
        }
      } as SmartVaultsTypes.SpendingProposal;
    }
    const tags = nostrPublicKeys.map(pubkey => [TagType.PubKey, pubkey])
    const proposalEvent = await buildEvent({
      kind: SmartVaultsKind.Proposal,
      content: await sharedKeyAuth.encryptObj(proposalContent),
      tags: [...tags, [TagType.Event, policy.id]],
    },
      sharedKeyAuth)

    const pub = this.nostrClient.publish(proposalEvent)
    await pub.onFirstOkOrCompleteFailure()
    const createdAt = fromNostrDate(proposalEvent.created_at)
    let msg = keyAgentPayment ? "New key agent payment proposal:\n" : "New spending proposal:\n"
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
    const fee = Number(this.bitcoinUtil.getFee(psbt))
    const utxo = this.bitcoinUtil.getPsbtUtxos(psbt)
    const [amountFiat, feeFiat] = await this.bitcoinExchangeRate.convertToFiat([amount, fee])
    const bitcoinExchangeRate = await this.bitcoinExchangeRate.getExchangeRate()
    const activeFiatCurrency = this.bitcoinExchangeRate.getActiveFiatCurrency()
    const status = ProposalStatus.Unsigned
    const commonProps = {
      signer,
      amountFiat,
      fee,
      feeFiat,
      utxos: utxo,
      status,
      policy_id: policy.id,
      proposal_id: proposalEvent.id,
      createdAt,
      bitcoinExchangeRate,
      activeFiatCurrency,
    }
    Promise.all(promises)
    let publishedProposal: SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedKeyAgentPaymentProposal
    if (keyAgentPayment) {
      publishedProposal = {
        ...proposalContent[ProposalType.KeyAgentPayment],
        ...commonProps,
        type: ProposalType.KeyAgentPayment,
      } as SmartVaultsTypes.PublishedKeyAgentPaymentProposal
    } else {
      publishedProposal = {
        ...proposalContent[ProposalType.Spending],
        ...commonProps,
        type: ProposalType.Spending,
      } as SmartVaultsTypes.PublishedSpendingProposal
    }

    this.getStore(SmartVaultsKind.Proposal).store(publishedProposal)
    this.getStore(StoreKind.Events).store(proposalEvent)

    return publishedProposal
  }

  async saveKeyAgentPaymentProposal(payload: SmartVaultsTypes.KeyAgentPaymentProposalPayload): Promise<SmartVaultsTypes.PublishedKeyAgentPaymentProposal> {
    const hastActiveKeyAgentPaymentProposal = await this.hasActiveKeyAgentPaymentProposal(payload.policy.id, payload.keyAgentPayment.signer_descriptor);
    if (hastActiveKeyAgentPaymentProposal) throw new Error('There is already an active key agent payment proposal for this signer');
    const keyPaymentProposal = await this.spend(payload);
    return keyPaymentProposal as SmartVaultsTypes.PublishedKeyAgentPaymentProposal;
  }

  getPaymentOptions = (offering: SmartVaultsTypes.PublishedSignerOffering): Array<PaymentType> => {
    const paymentOptions: Array<PaymentType> = [];
    Object.entries(offering).forEach(([key, value]) => {
      if (!value) return;
      switch (key) {
        case 'cost_per_signature':
          paymentOptions.push(PaymentType.PerSignature);
          break;
        case 'yearly_cost':
          paymentOptions.push(PaymentType.YearlyCost);
          break;
        case 'yearly_cost_basis_points':
          paymentOptions.push(PaymentType.YearlyCostBasisPoints);
          break;
        default:
          break;
      }
    });
    return paymentOptions;
  }

  getSuggestedPaymentPeriod = async (policy: PublishedPolicy, signerDescriptor: string): Promise<SmartVaultsTypes.Period> => {
    const oneYear = TimeUtil.fromYearsToSeconds(1);
    const lastCompletedKeyAgentPaymentProposal = await this.getLastCompletedKeyAgentPaymentProposal(policy.id, signerDescriptor);
    const policyCreatedAt = TimeUtil.toSeconds(policy.createdAt.getTime())
    let period: SmartVaultsTypes.Period = { start: policyCreatedAt, end: policyCreatedAt + oneYear };
    if (lastCompletedKeyAgentPaymentProposal) {
      const oneDay = TimeUtil.fromDaysToSeconds(1);
      const lastCompletedProposalCreatedAt = TimeUtil.toSeconds(new Date(lastCompletedKeyAgentPaymentProposal.completion_date).getTime());
      period.start = lastCompletedProposalCreatedAt + oneDay;
      period.end = period.start + oneYear;
    }
    return period;
  }

  getSuggestedPaymentAmount = async (offering: SmartVaultsTypes.PublishedSignerOffering, paymentType: PaymentType, policy: PublishedPolicy, signerDescriptor: string, period?: SmartVaultsTypes.Period): Promise<number> => {
    let price: SmartVaultsTypes.Price | number = 0;
    let paymentAmount: number = 0;
    period = period || await this.getSuggestedPaymentPeriod(policy, signerDescriptor);
    const years = TimeUtil.fromSecondsToYears(period.end - period.start);
    if (years <= 0) throw new Error('Invalid period');
    switch (paymentType) {
      case PaymentType.PerSignature:
        price = offering.cost_per_signature!;
        paymentAmount = await this.fromPriceToSats(price)
        break;
      case PaymentType.YearlyCost:
        price = offering.yearly_cost!;
        paymentAmount = await this.fromPriceToSats(price) * years;
        break;
      case PaymentType.YearlyCostBasisPoints:
        price = offering.yearly_cost_basis_points!;
        const currentBalance = await policy.getBalance();
        paymentAmount = Math.floor(CurrencyUtil.fromBasisPointsToDecimal(price) * currentBalance.totalBalance() * years);
        break;
      default:
        throw new Error('Invalid payment type');
    }
    return paymentAmount;
  }

  private fromPriceToSats = async (price: SmartVaultsTypes.Price): Promise<number> => {
    switch (price.currency.toLowerCase()) {
      case 'sats':
        return price.amount;
      case 'btc':
        return CurrencyUtil.fromBitcoinToSats(price.amount);
      default:
        return await this.bitcoinExchangeRate.fromPriceToSats(price);
    }
  }

  /**
   * Subscribes to specified kinds of events and handles them using a provided callback function.
   *
   * @param {(SmartVaultsKind | Kind)[] | (SmartVaultsKind | Kind)} kinds - The event kinds to subscribe to. This can either be an array or a single value.
   * @param {(eventKind: number, payload: any) => void} callback - The callback function to handle incoming events. It receives the kind of event and the associated payload.
   *
   * @returns {Sub<number>} - A subscription object that can be used to manage the subscription.
   *
   * @throws {Error} - If an error occurs while processing an event, the error is caught and logged, but does not break the subscription.
   *
   * @example
   * const kindsToSubscribe = [SmartVaultsKind.Policy, SmartVaultsKind.Proposal];
   * const myCallback = (kind, payload) => {
   *   console.log(`Received event of kind ${kind} with payload:`, payload);
   * };
   *
   * const mySubscription = subscribe(kindsToSubscribe, myCallback);
   *
   * // To unsubscribe
   * mySubscription.disconnect();
   */
  subscribe(kinds: (SmartVaultsKind | Kind)[] | (SmartVaultsKind | Kind), callback: (eventKind: number, payload: any) => void): Sub<number> {
    if (!Array.isArray(kinds)) {
      kinds = [kinds]
    }
    const kindsHaveHandler = new Set([...Object.values(SmartVaultsKind), Kind.Metadata, Kind.Contacts, Kind.EventDeletion]);
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


  private subscriptionFilters(kinds: (SmartVaultsKind | Kind)[]): Filter<number>[] {
    let filters: Filter<number>[] = [];
    const paginationOpts = {
      since: nostrDate()
    }
    for (const kind of kinds) {
      filters.push(...this.getFilter(kind, { paginationOpts }))
    }

    return filters;
  }

  private getFilter(kind: SmartVaultsKind | Kind, filterParams?: singleKindFilterParams): Filter<number>[] {
    const params: singleKindFilterParams = { ...filterParams, kind }
    let filter: FilterBuilder<number> = filterBuilder();
    const ownPublicKey = this.authenticator.getPublicKey()
    const networkIdentifier = this.getNetworkIdentifier()
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined) return;
      switch (key) {
        case 'kind':
          switch (value) {
            case Kind.Metadata:
            case Kind.Contacts:
            case SmartVaultsKind.Signers:
              filter = filter.kinds(value as SmartVaultsKind | Kind).authors(ownPublicKey);
              break;
            case SmartVaultsKind.SignerOffering:
              filter = filter.kinds(value as SmartVaultsKind);
              break;
            case SmartVaultsKind.KeyAgents:
              filter = filter.kinds(value as SmartVaultsKind).identifiers(networkIdentifier);
              break;
            case SmartVaultsKind.VerifiedKeyAgents:
              filter = filter.kinds(value as SmartVaultsKind).authors(this.getAuthority());
              break;
            default:
              filter = filter.kinds(value as SmartVaultsKind | Kind).pubkeys(ownPublicKey);
              break;
          }
          break;
        case 'authors':
          filter = filter.authors(value as string | string[]);
          break;
        case 'pubkeys':
          filter = filter.pubkeys(value as string | string[]);
          break;
        case 'ids':
          filter = filter.ids(value as string | string[]);
          break;
        case 'events':
          filter = filter.events(value as string | string[]);
          break;
        case 'identifiers':
          filter = filter.identifiers(value as string | string[]);
          break;
        case 'paginationOpts':
          filter = filter.pagination(value as PaginationOpts);
          break;
      }
    });

    return filter.toFilters();
  }

  /**
   * Disconnects from the SmartVaults instance relay.
   *
   * @returns {void} - No return value.
   *
   * @example
   * 
   * smartVaults.disconnect();
  */
  disconnect(): void {
    this.nostrClient.disconnect
  }


  private async _getOwnedSigners(filter: Filter<SmartVaultsKind.Signers>[]): Promise<SmartVaultsTypes.PublishedOwnedSigner[]> {
    const signersEvents = await this.nostrClient.list(filter)
    const ownedSignerHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.Signers)
    return ownedSignerHandler.handle(signersEvents)
  }

  /**
   * Fetches signers owned by the user and returns them as an array of BaseOwnedSigner objects.
   * 
   *  
   * @returns {Promise<BaseOwnedSigner[]>} A promise that resolves to an array of BaseOwnedSigner objects.
   * Each BaseOwnedSigner object represents an owned signer and contains all the properties of the base signer object, plus `ownerPubKey' and 'createdAt' properties.
   * 
   * @throws {Error} Throws an error if there's an issue in fetching signer events or decrypting content.
   * 
   * @async
   */
  getOwnedSigners = async (): Promise<SmartVaultsTypes.PublishedOwnedSigner[]> => {
    const signersFilter = this.getFilter(SmartVaultsKind.Signers)
    return this._getOwnedSigners(signersFilter)
  }


  getOwnedSignersByOfferingIdentifiers = async (): Promise<Map<string, SmartVaultsTypes.PublishedOwnedSigner>> => {
    const ownedSigners = await this.getOwnedSigners()
    const augmentedOwnedSignersPromises = ownedSigners.map(async signer => ({ ...signer, offeringIdentifier: await this.generateSignerOfferingIdentifier(signer.fingerprint) }))
    const augmentedOwnedSigners = await Promise.all(augmentedOwnedSignersPromises)
    const ownedSignersByOfferingIdentifiers: Map<string, SmartVaultsTypes.PublishedOwnedSigner> = new Map(augmentedOwnedSigners.map(signer => [signer.offeringIdentifier, signer]))
    return ownedSignersByOfferingIdentifiers
  }

  /**
   * Asynchronously fetches signers the user has shared.
   * If IDs are provided, the method fetches signers corresponding to those IDs.
   * Otherwise, it fetches all shared signers based.
   *
   * @async
   * @param {string | string[] | undefined} [id] - Optional ID(s) of the signers to fetch.
   * @returns {Promise<Map<string, SmartVaultsTypes.MySharedSigner | Array<SmartVaultsTypes.MySharedSigner>>>} 
   * - A promise that resolves to a Map of shared signers, mapped by their IDs.
   *
   * @throws Will throw an error if any issue occurs during the request to the relay.
   *
   * @example
   * // Fetch a single shared signer by ID
   * const result = await getMySharedSigners("some-signer-id");
   *
   * // Fetch multiple shared signers by IDs
   * const result = await getMySharedSigners(["id1", "id2"]);
   *
   * // Fetch all shared signers
   * const result = await getMySharedSigners();
   *
   * @see SmartVaultsTypes.MySharedSigner - For the structure of MySharedSigner objects.
   */
  getMySharedSigners = async (id?: string | string[]): Promise<Map<string, SmartVaultsTypes.MySharedSigner | Array<SmartVaultsTypes.MySharedSigner>>> => {
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

      return { id: sharedId, signerId, sharedWith, sharedDate } as SmartVaultsTypes.MySharedSigner;
    });
    mysharedSignersStore.store(mySharedSigners)
    return mysharedSignersStore.getMany(ids, "signerId")

  }

  private async _getSharedSigners(filter: Filter<SmartVaultsKind.SharedSigners>[]): Promise<SmartVaultsTypes.PublishedSharedSigner[]> {
    const signersEvents = await this.nostrClient.list(filter)
    const sharedSignerHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.SharedSigners)
    return sharedSignerHandler.handle(signersEvents)
  }

  /**
   * Asynchronously fetches signers shared with the user based on specified public keys.
   * Returns them as an array of PublishedSharedSigner objects, each containing details such as owner's public key and creation time.
   *
   * @async
   * @param {string | string[] | undefined} [publicKeys] - Optional public keys to filter the fetched signers. Can be a single string or an array of strings.
   * @returns {Promise<SmartVaultsTypes.PublishedSharedSigner[]>} - A promise that resolves to an array of PublishedSharedSigner objects.
   *                                                              
   * @throws {Error} - Throws an error if any issue occurs during the fetching of signer events or decryption of content.
   *
   * @example
   * // Fetch shared signers by a specific public key
   * const result = await getSharedSigners("some-public-key");
   *
   * // Fetch shared signers by multiple public keys
   * const result = await getSharedSigners(["key1", "key2"]);
   *
   * // Fetch all shared signers
   * const result = await getSharedSigners();
   *
   * @see SmartVaultsTypes.PublishedSharedSigner - For the structure of PublishedSharedSigner objects.
   */
  getSharedSigners = async (publicKeys?: string | string[]): Promise<SmartVaultsTypes.PublishedSharedSigner[]> => {
    const keysToFilter = Array.isArray(publicKeys) ? publicKeys : (publicKeys ? [publicKeys] : []);
    const sharedSignersFilter = keysToFilter.length ? this.getFilter(SmartVaultsKind.SharedSigners, { authors: keysToFilter }) : this.getFilter(SmartVaultsKind.SharedSigners)
    return this._getSharedSigners(sharedSignersFilter);
  }

  extractKey(descriptor: string): string {
    const matches = descriptor.match(/\[.*?\*/)
    if (!matches) throw new Error('Invalid descriptor')
    return matches[0]
  }

  /**
   * Asynchronously saves an owned signer by encrypting its properties, building a new event, 
   * and publishing it via `NostrClient`.
   *
   * @async
   * @param {Object} params - Parameters for the owned signer, including `description`, `descriptor`, 
   * `fingerprint`, `name`, `t`.
   * @returns {Promise<BaseOwnedSigner>} A promise that resolves to an BaseOwnedSigner object with encrypted 
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
  }: BaseOwnedSigner): Promise<SmartVaultsTypes.PublishedOwnedSigner> {
    let ownerPubKey = this.authenticator.getPublicKey()

    const signer: BaseOwnedSigner = {
      description,
      descriptor,
      fingerprint,
      name,
      t,
    }
    const content = await this.authenticator.encryptObj(signer)
    const signerEvent = await buildEvent({
      kind: SmartVaultsKind.Signers,
      content,
      tags: [],
    },
      this.authenticator)
    const pub = this.nostrClient.publish(signerEvent)
    await pub.onFirstOkOrCompleteFailure()
    const id = signerEvent.id
    const createdAt = fromNostrDate(signerEvent.created_at);
    const key = this.extractKey(descriptor)

    return { ...signer, key, id, ownerPubKey, createdAt }
  }

  /**
   * Asynchronously creates and publishes a 'SharedSigners' event.
   *
   * @async
   * @param {Object} params - Parameters for the shared signer, including `descriptor` and `fingerpring`
   * @param {string} pubKey - Public key of the user with whom the signer is being shared.
   * @returns {Promise<BaseSharedSigner>} A promise that resolves to a PublishedSharedSigner object, includes 
   * the owner's public key and shared date.
   * @throws Will throw an error if the event publishing fails or if the user tries to share a signer with themselves.
   * @example
   * const signer = await saveSharedSigner({descriptor, fingerprint}, pubKey);
   */
  async saveSharedSigner(ownedSigner: SmartVaultsTypes.PublishedOwnedSigner, pubKeys: string | string[]): Promise<SmartVaultsTypes.PublishedSharedSigner[]> {

    if (!Array.isArray(pubKeys)) {
      pubKeys = [pubKeys]
    }
    const ownerPubKey = this.authenticator.getPublicKey()
    const BaseSharedSigner: BaseSharedSigner = {
      descriptor: ownedSigner.descriptor,
      fingerprint: ownedSigner.fingerprint,
    }
    const sharedSigners: SmartVaultsTypes.PublishedSharedSigner[] = []
    for (const pubKey of pubKeys) {
      const content = await this.authenticator.encryptObj(BaseSharedSigner, pubKey)
      const signerEvent = await buildEvent({
        kind: SmartVaultsKind.SharedSigners,
        content,
        tags: [[TagType.Event, ownedSigner.id], [TagType.PubKey, pubKey]],
      },
        this.authenticator)

      const pub = this.nostrClient.publish(signerEvent)
      await pub.onFirstOkOrCompleteFailure()

      const id = signerEvent.id
      const createdAt = fromNostrDate(signerEvent.created_at)
      const key = this.extractKey(ownedSigner.descriptor)

      sharedSigners.push({ ...BaseSharedSigner, key, id, ownerPubKey, createdAt })
    }
    return sharedSigners
  }

  private async sendDirectMsg(msg: string, publicKey: string): Promise<PubPool> {
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
   * @ignore
   * Get direct messages
   * @returns {Promise<SmartVaultsTypes.PublishedDirectMessage[]>}
   */
  async getDirectMessages(paginationOpts: PaginationOpts = {}): Promise<SmartVaultsTypes.PublishedDirectMessage[]> {

    const directMessagesFilter = this.getFilter(Kind.EncryptedDirectMessage, { paginationOpts })
    const directMessageEvents = await this.nostrClient.list(directMessagesFilter)
    let directMessages: SmartVaultsTypes.PublishedDirectMessage[] = []
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


  private buildMySharedSignersFilter() {
    return filterBuilder()
      .kinds(SmartVaultsKind.SharedSigners)
      .authors(this.authenticator.getPublicKey())
  }

  private async getProposalEvent(proposal_id: string) {
    const proposalsFilter = this.getFilter(SmartVaultsKind.Proposal, { ids: proposal_id })
    const proposalEvents = await this.nostrClient.list(proposalsFilter)

    if (proposalEvents.length === 0) {
      throw new Error(`Proposal with id ${proposal_id} not found`)
    }

    if (proposalEvents.length !== 1) {
      throw new Error(`More than one proposal with id ${proposal_id} found`)
    }

    return proposalEvents[0]
  }



  private async _getCompletedProposals(filter: Filter<SmartVaultsKind.CompletedProposal>[]): Promise<(SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal)[]> {
    const completedProposalEvents = await this.nostrClient.list(filter)
    const completedProposalHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.CompletedProposal)
    return completedProposalHandler.handle(completedProposalEvents)
  }

  /**
   * Asynchronously fetches completed proposals by their IDs.
   * 
   * @async
   * @param {string[] | string} ids - The IDs of the completed proposals to fetch. 
   * 
   * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options to limit the number of returned proposals or to fetch from a specific offset.
   *
   * @returns {Promise<Map<string, SmartVaultsTypes.CompletedPublishedProposal>>} 
   *          - A promise that resolves to a map where the keys are proposal IDs and the values are CompletedPublishedProposal objects.
   * 
   * @throws {Error} - Throws an error if the network request fails.
   * 
   * @example
   * // Fetch a single proposal by ID
   * const proposals = await getCompletedProposalsById("some-proposal-id");
   *
   * // Fetch multiple proposals by IDs with pagination
   * const proposals = await getCompletedProposalsById(["id1", "id2"], {  since: new Date() });
   *
   * @see SmartVaultsTypes.CompletedPublishedProposal - For the structure of a CompletedPublishedProposal object.
   */
  async getCompletedProposalsById(ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, SmartVaultsTypes.CompletedPublishedProposal>> {
    const completedProposalsIds = Array.isArray(ids) ? ids : [ids]
    const store = this.getStore(SmartVaultsKind.CompletedProposal);
    const missingIds = store.missing(completedProposalsIds);
    if (missingIds.length) {
      const completedProposalsFilter = this.getFilter(SmartVaultsKind.CompletedProposal, { ids: completedProposalsIds, paginationOpts });
      await this._getCompletedProposals(completedProposalsFilter);
    }
    return store.getMany(completedProposalsIds, "id");
  }

  /**
  * Asynchronously fetches completed proposals by their associated policy IDs.
  * 
  * @async
  * @method
  * @param {string[] | string} policy_ids - The policy IDs corresponding to the completed proposals to fetch.
  * 
  * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options to limit the number of returned proposals or to fetch from a specific offset.
  *
  * @returns {Promise<Map<string, SmartVaultsTypes.CompletedPublishedProposal | Array<SmartVaultsTypes.CompletedPublishedProposal>>>} 
  *          - A promise that resolves to a map where the keys are policy IDs and the values are either single or arrays of CompletedPublishedProposal objects.
  * @throws {Error} - Throws an error if the network request fails or if the internal store is inconsistent.
  * 
  * @example
  * // Fetch a single proposal by policy ID
  * const proposals = await getCompletedProposalsByPolicyId("some-policy-id");
  *
  * // Fetch multiple proposals by policy IDs with pagination
  * const proposals = await getCompletedProposalsByPolicyId(["policy-id1", "policy-id2"], { since : new Date() });
  *
  * @see SmartVaultsTypes.PublishedCompletedSpendingProposal - For the structure of a PublishedCompletedSpendingProposal object.
  */
  getCompletedProposalsByPolicyId = async (policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, SmartVaultsTypes.CompletedPublishedProposal
    | Array<SmartVaultsTypes.CompletedPublishedProposal>
  >> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(SmartVaultsKind.CompletedProposal);
    const missingIds = store.missing(policyIds, "policy_id");
    if (missingIds.length) {
      const completedProposalsFilter = this.getFilter(SmartVaultsKind.CompletedProposal, { events: policyIds, paginationOpts });
      await this._getCompletedProposals(completedProposalsFilter);
    }
    return store.getMany(policyIds, "policy_id");
  }

  /**
   * Asynchronously fetches all completed proposals, optionally with pagination.
   * 
   * @async
   * @method
   * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options to control the returned data.
   *
   * @returns {Promise<Array<SmartVaultsTypes.CompletedPublishedProposal>>} 
   *          - A promise that resolves to an array of CompletedPublishedProposal objects.
   * 
   * @throws {Error} - Throws an error if there is a failure in fetching the proposals.
   * 
   * @example
   * // Fetch completed proposals with default settings
   * const proposals = await getCompletedProposals();
   *
   * // Fetch completed proposals with pagination
   * const proposals = await getCompletedProposals({ limit: 5 });
   *
   * @see SmartVaultsTypes.CompletedPublishedProposal - For the structure of a CompletedPublishedProposal object.
   */
  async getCompletedProposals(paginationOpts: PaginationOpts = {}): Promise<Array<SmartVaultsTypes.CompletedPublishedProposal>> {
    const completedProposalsFilter = this.getFilter(SmartVaultsKind.CompletedProposal, { paginationOpts });
    const completedProposals = await this._getCompletedProposals(completedProposalsFilter)
    return completedProposals
  }

  private async _getApprovals(filter: Filter<SmartVaultsKind.ApprovedProposal>[]): Promise<Array<SmartVaultsTypes.PublishedApprovedProposal>> {
    const approvedProposalEvents = await this.nostrClient.list(filter)
    const approvedProposalHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.ApprovedProposal)
    return approvedProposalHandler.handle(approvedProposalEvents)
  }

  /**
   * Asynchronously fetches approvals associated with given proposal IDs.
   * 
   * @async
   * @param {string[] | string} [proposal_ids] - Optional proposal IDs to filter the approvals by.
   * @returns {Promise<Map<string, SmartVaultsTypes.PublishedApprovedProposal[]>>} - 
   * A Promise that resolves to a Map. Each key in the map is a proposal ID, and the corresponding value is an array 
   * of approved proposals associated with that proposal ID.
   * 
   * @example
   * const approvalsMap = await getApprovals(['proposal1', 'proposal2']);
   * const allApprovalsMap = await getApprovals();
   * 
   * @throws {Error} - Throws an error if there is a failure in fetching approvals.
   */
  getApprovals = async (proposal_ids?: string[] | string): Promise<Map<string, SmartVaultsTypes.PublishedApprovedProposal[]>> => {
    const proposalIds = Array.isArray(proposal_ids) ? proposal_ids : proposal_ids ? [proposal_ids] : undefined;
    let approvedProposalsFilter = this.getFilter(SmartVaultsKind.ApprovedProposal, { events: proposalIds })
    const approvalsArray = await this._getApprovals(approvedProposalsFilter);
    const approvalsMap = new Map<string, SmartVaultsTypes.PublishedApprovedProposal[]>();
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

  /**
   * Asynchronously fetches approved proposals by their associated policy IDs.
   *
   * @async
   * @method
   * @param {string[] | string} policy_ids - A single policy ID or an array of policy IDs for which to fetch approved proposals.
   *                                         If this is not specified, the function fetches approvals for all available policy IDs.
   * @returns {Promise<Map<string, SmartVaultsTypes.PublishedApprovedProposal | Array<SmartVaultsTypes.PublishedApprovedProposal>>>} 
   *          - A promise that resolves to a Map. Each key in the map corresponds to a policy ID. 
   *            The value is either a single PublishedApprovedProposal object or an array of PublishedApprovedProposal objects.
   *
   * @throws {Error} - Throws an error if there is a failure in fetching the approved proposals.
   *
   * @example
   * // Fetch approvals for a single policy ID
   * const approvals = await getApprovalsByPolicyId('some-policy-id');
   *
   * // Fetch approvals for multiple policy IDs
   * const approvals = await getApprovalsByPolicyId(['policy-id-1', 'policy-id-2']);
   *
   * @see SmartVaultsTypes.PublishedApprovedProposal - For the structure of a PublishedApprovedProposal object.
   */
  getApprovalsByPolicyId = async (policy_ids: string[] | string): Promise<Map<string, (SmartVaultsTypes.PublishedApprovedProposal)
    | Array<SmartVaultsTypes.PublishedApprovedProposal>>> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    let approvedProposalsFilter = policyIds.length ? this.getFilter(SmartVaultsKind.ApprovedProposal, { events: policyIds }) : this.getFilter(SmartVaultsKind.ApprovedProposal)
    const store = this.getStore(SmartVaultsKind.ApprovedProposal);
    await this._getApprovals(approvedProposalsFilter);
    return store.getMany(policyIds, "policy_id");
  }


  /**
  * @ignore
  */
  private async _getProposals(filter: Filter<SmartVaultsKind.Policy>[]): Promise<Array<SmartVaultsTypes.ActivePublishedProposal>> {
    const proposalEvents = await this.nostrClient.list(filter)
    const proposalHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.Proposal)
    return proposalHandler.handle(proposalEvents)
  }

  /**
   * Asynchronously fetches proposals by their IDs.
   *
   * @async
   * @param {string[] | string} proposal_ids - A single proposal ID or an array of proposal IDs to fetch.
   * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options.
   * @returns {Promise<Map<string,SmartVaultsTypes.ActivePublishedProposal>>} 
   *          - A promise that resolves to a Map. Each key corresponds to a proposal ID, and the value is a ActivePublishedProposal object.
   *
   * @throws {Error} - Throws an error if there is a failure in fetching the proposals.
   *
   * @example
   * const proposalsById = await getProposalsById('some-proposal-id');
   */
  async getProposalsById(proposal_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, SmartVaultsTypes.ActivePublishedProposal>> {
    const proposalIds = Array.isArray(proposal_ids) ? proposal_ids : [proposal_ids]
    const store = this.getStore(SmartVaultsKind.Proposal);
    const proposalsFilter = this.getFilter(SmartVaultsKind.Proposal, { ids: proposalIds, paginationOpts })
    await this._getProposals(proposalsFilter);
    return store.getMany(proposalIds, "proposal_id");
  }

  /**
   * Asynchronously fetches proposals by associated policy IDs.
   *
   * @async
   * @param {string[] | string} policy_ids - A single policy ID or an array of policy IDs for which to fetch proposals.
   * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options.
   * @returns {Promise<Map<string, ActivePublishedProposal | Array<ActivePublishedProposal>>>} 
   *          - A promise that resolves to a Map. Each key corresponds to a policy ID, and the value is either a single ActivePublishedProposal object or an array of them.
   *
   * @throws {Error} - Throws an error if there is a failure in fetching the proposals.
   *
   * @example
   * const proposalsByPolicyId = await getProposalsByPolicyId('some-policy-id');
   */
  getProposalsByPolicyId = async (policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, SmartVaultsTypes.ActivePublishedProposal
    | Array<SmartVaultsTypes.ActivePublishedProposal>
  >> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(SmartVaultsKind.Proposal);
    const proposalsFilter = this.getFilter(SmartVaultsKind.Proposal, { events: policyIds, paginationOpts })
    await this._getProposals(proposalsFilter);
    return store.getMany(policyIds, "policy_id");
  }


  /**
   * Method to retrieve and decrypt not completed proposals.
   * 
   * This method retrieves all not completed proposals.
   * 
   * @returns A Promise that resolves to an array of decrypted proposals.
   */
  async getProposals(paginationOpts: PaginationOpts = {}): Promise<Array<SmartVaultsTypes.ActivePublishedProposal>> {
    const proposalsFilter = this.getFilter(SmartVaultsKind.Proposal, { paginationOpts })
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
      if (approvals.some(approval => !approval.psbt)) return false;
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
   * @returns A Promise that resolves to a `CompletedPublishedProposal` object representing the finalized proposal.
   *
   * @throws An error if the proposal or policy cannot be found, if there are no approvals for the proposal, if the PSBTs cannot be finalized, or if the proposal cannot be broadcast.
   */
  async finalizeSpendingProposal(proposalId: string): Promise<SmartVaultsTypes.CompletedPublishedProposal> {
    const proposalMap = await this.getProposalsById(proposalId)

    const proposal = proposalMap.get(proposalId) as SmartVaultsTypes.ActivePublishedProposal
    if (!proposal) {
      throw new Error(`Proposal with id ${proposalId} not found`)
    }
    const type = proposal.type
    const isProofOfReserve = 'message' in proposal || type === ProposalType.ProofOfReserve
    if (isProofOfReserve) {
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
    const isKeyAgentPayment = 'signer_descriptor' in proposal

    const completedProposal = {
      [type]: {
        tx: txResponse.trx,
        description: proposal.description,
        ...(isKeyAgentPayment && {
          signer_descriptor: proposal.signer_descriptor,
          period: proposal.period
        })
      }
    } as SmartVaultsTypes.CompletedSpendingProposal | SmartVaultsTypes.CompletedKeyAgentPaymentProposal;

    const content = await sharedKeyAuthenticator.encryptObj(completedProposal)

    const completedProposalEvent = await buildEvent({
      kind: SmartVaultsKind.CompletedProposal,
      content,
      tags: [...policyMembers, [TagType.Event, proposalId], [TagType.Event, policy.id]],
    },
      sharedKeyAuthenticator)

    await this.nostrClient.publish(completedProposalEvent).onFirstOkOrCompleteFailure()
    const label: SmartVaultsTypes.Label = { data: { 'txid': txId }, text: proposal.description }
    await this.saveLabel(policyId, label)
    const proposalsIdsToDelete: string[] = (await this.getProposalsWithCommonUtxos(proposal)).map(({ proposal_id }) => proposal_id);
    await this.deleteProposals(proposalsIdsToDelete)


    const publishedCompletedProposal: SmartVaultsTypes.CompletedPublishedProposal = {
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

  private async getProposalsWithCommonUtxos(proposal: SmartVaultsTypes.PublishedSpendingProposal): Promise<Array<SmartVaultsTypes.PublishedSpendingProposal>> {
    const utxos = proposal.utxos;
    const policyId = proposal.policy_id;
    const proposalsMap = await this.getProposalsByPolicyId(policyId);
    const policyProposals = Array.from(proposalsMap.values()).flat() as Array<SmartVaultsTypes.PublishedSpendingProposal>;

    const utxosSet = new Set(utxos);
    const proposals: Array<SmartVaultsTypes.PublishedSpendingProposal> = [];

    for (const proposal of policyProposals) {
      const proposalUtxos = proposal.utxos;
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
   * @returns {Promise<SmartVaultsTypes.PublishedCompletedSpendingProposal | null>} A Promise that resolves with the completed proposal, if found, or null.
   * 
   * @example
   * getCompletedProposalByTx({txid: '1234', confirmation_time: {confirmedAt: new Date()}, net: -1})
   * 
   */
  async getCompletedProposalByTx(tx: TrxDetails | BasicTrxDetails): Promise<SmartVaultsTypes.PublishedCompletedSpendingProposal | null> {
    const { txid: txId, confirmation_time: confirmationTime, net: net } = tx;

    if (!txId || net > 0) {
      return null
    }

    const completedProposalStore = this.getStore(SmartVaultsKind.CompletedProposal);
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

    const completedProposals = await this.getCompletedProposals(paginationOpts) as SmartVaultsTypes.PublishedCompletedSpendingProposal[];
    const completedProposal = completedProposals.find(({ txId: id }) => id === txId);

    if (!completedProposal) {
      return null
    }

    return completedProposal;
  }

  /**
   * Asynchronously deletes approvals with the given IDs.
   *
   * @async
   * @param {string | string[]} ids - Single or multiple approval IDs to be deleted.
   * @returns {Promise<void>} - A promise that resolves to `void` when the operation is successful.
   * @throws {Error} - Throws an error if the deletion process fails.
   *
   * @example
   * await deleteApprovals('some-approval-id');
   */
  async deleteApprovals(ids: string | string[]): Promise<void> {
    const approvalIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(SmartVaultsKind.ApprovedProposal).delete(approvalIds)
  }

  /**
   * Asynchronously deletes proposals with the given IDs.
   *
   * @async
   * @param {string | string[]} ids - Single or multiple proposal IDs to be deleted.
   * @returns {Promise<void>} - A promise that resolves to `void` when the operation is successful.
   * @throws {Error} - Throws an error if the deletion process fails.
   *
   * @example
   * await deleteProposals('some-proposal-id');
   */
  async deleteProposals(ids: string | string[]): Promise<void> {
    const proposalIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(SmartVaultsKind.Proposal).delete(proposalIds)
  }

  /**
   * Asynchronously deletes completed proposals with the given IDs.
   *
   * @async
   * @param {string | string[]} ids - Single or multiple completed proposal IDs to be deleted.
   * @returns {Promise<void>} - A promise that resolves to `void` when the operation is successful.
   * @throws {Error} - Throws an error if the deletion process fails.
   *
   * @example
   * await deleteCompletedProposals('some-completed-proposal-id');
   */
  async deleteCompletedProposals(ids: string | string[]): Promise<void> {
    const completedProposalIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(SmartVaultsKind.CompletedProposal).delete(completedProposalIds)
  }

  /**
   * Asynchronously deletes signers with the given IDs.
   *
   * @async
   * @param {string | string[]} ids - Single or multiple signer IDs to be deleted.
   * @returns {Promise<void>} - A promise that resolves to `void` when the operation is successful.
   * @throws {Error} - Throws an error if the deletion process fails.
   *
   * @example
   * await deleteSigners('some-signer-id');
   */
  async deleteSigners(ids: string | string[]): Promise<void> {
    const signerIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(SmartVaultsKind.Signers).delete(signerIds)
  }

  /**
   * Asynchronously deletes policies with the given IDs.
   *
   * @async
   * @param {string | string[]} ids - Single or multiple policy IDs to be deleted.
   * @returns {Promise<void>} - A promise that resolves to `void` when the operation is successful.
   * @throws {Error} - Throws an error if the deletion process fails.
   *
   * @example
   * await deletePolicies('some-policy-id');
   */
  async deletePolicies(ids: string | string[]): Promise<void> {
    const policyIds = Array.isArray(ids) ? ids : [ids]
    await this.eventKindHandlerFactor.getHandler(SmartVaultsKind.Policy).delete(policyIds)
  }

  /**
   * Asynchronously revokes shared signers with the given IDs.
   *
   * @async
   * @param {string | string[]} ids - Single or multiple shared signer IDs to be revoked ( not signer ids ).
   * @returns {Promise<void>} - A promise that resolves to `void` when the operation is successful.
   * @throws {Error} - Throws an error if the revocation process fails or if a shared signer with the given ID is not found.
   *
   * @example
   * await revokeMySharedSigners('some-shared-signer-id');
   */
  async revokeMySharedSigners(ids: string | string[]): Promise<void> {
    const mySharedSignersStore = this.getStore(StoreKind.MySharedSigners);
    const mySharedSignersToDelete: SmartVaultsTypes.MySharedSigner[] = [];
    const promises = (Array.isArray(ids) ? ids : [ids]).map(async (sharedSignerId) => {
      const mySharedSignerEvent: SmartVaultsTypes.MySharedSigner = mySharedSignersStore.get(sharedSignerId, 'id');

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


  /**
  * @ignore
  */
  async _saveProofOfReserveProposal(policy_id: string, { "ProofOfReserve": { message, psbt, descriptor } }): Promise<SmartVaultsTypes.PublishedProofOfReserveProposal> {

    const policyEvent = await this.getPolicyEvent(policy_id)
    const policyMembers = policyEvent.tags

    const sharedKeyAuthenticatorResult: Map<string, SmartVaultsTypes.SharedKeyAuthenticator> = await this.getSharedKeysById([policy_id])
    const sharedKeyAuthenticator: any = sharedKeyAuthenticatorResult.get(policy_id)?.sharedKeyAuthenticator
    if (!sharedKeyAuthenticator) {
      throw new Error(`Shared key for policy with id ${policy_id} not found`)
    }
    const policy = toPublished(await sharedKeyAuthenticator.decryptObj(policyEvent.content), policyEvent)
    const type = ProposalType.ProofOfReserve
    //proposal = policy.proof_of_reserve(wallet,message)
    const proposal: SmartVaultsTypes.ProofOfReserveProposal = {
      [type]: {
        message,
        descriptor,
        psbt,
      }
    }

    const content = await sharedKeyAuthenticator.encryptObj(proposal)
    const proposalEvent = await buildEvent({
      kind: SmartVaultsKind.Proposal,
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
    const utxos = this.bitcoinUtil.getPsbtUtxos(psbt)
    return { ...proposal[type], proposal_id, type, status, signer, fee, utxos, policy_id, createdAt }

  }

  /**
  * @ignore
  */
  async saveApprovedProposal(proposal_id: string): Promise<SmartVaultsTypes.PublishedApprovedProposal> {
    const signedPsbt = await this.getPsbtFromFileSystem()
    if (!signedPsbt) throw new Error('No signed psbt provided')
    const proposal = (await this.getProposalsById(proposal_id)).get(proposal_id)
    if (!proposal) throw new Error(`Proposal with id ${proposal_id} not found`)

    const policyId = proposal.policy_id
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyMembers = policyEvent.tags
    const sharedKeyAuthenticator: any = (await this.getSharedKeysById([policyId])).get(policyId)?.sharedKeyAuthenticator
    const type = proposal.type

    const approvedProposal: SmartVaultsTypes.BaseApprovedProposal = {
      [type]: {
        psbt: signedPsbt,
      }
    }

    const expirationDate = TimeUtil.getCurrentTimeInSeconds() + TimeUtil.fromDaysToSeconds(7)
    const content = await sharedKeyAuthenticator.encryptObj(approvedProposal)

    const approvedProposalEvent = await buildEvent({
      kind: SmartVaultsKind.ApprovedProposal,
      content,
      tags: [...policyMembers, [TagType.Event, proposal_id], [TagType.Event, policyId], [TagType.Expiration, expirationDate.toString()]],
    },
      this.authenticator)

    const publishedApprovedProposal: SmartVaultsTypes.PublishedApprovedProposal = {
      type,
      psbt: signedPsbt,
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

  /**
  * @ignore
  */
  async _saveCompletedProposal(proposal_id: string, payload: SmartVaultsTypes.CompletedProposal): Promise<SmartVaultsTypes.CompletedPublishedProposal> {
    const proposalEvent = await this.getProposalEvent(proposal_id)
    const policyId = getTagValues(proposalEvent, TagType.Event)[0]
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyMembers = policyEvent.tags

    const sharedKeyAuthenticator: any = (await this.getSharedKeysById([policyId])).get(policyId)?.sharedKeyAuthenticator
    const type = Object.keys(payload)[0] as ProposalType
    const completedProposal = payload[type]
    const content = await sharedKeyAuthenticator.encryptObj(payload)
    const isSpendingType = 'tx' in completedProposal
    let txId;
    if (isSpendingType) {
      txId = this.bitcoinUtil.getTrxId(completedProposal.tx)
    }
    const completedProposalEvent = await buildEvent({
      kind: SmartVaultsKind.CompletedProposal,
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

    const publishedCompletedProposal: SmartVaultsTypes.CompletedPublishedProposal = {
      type,
      txId,
      ...completedProposal,
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

  private async generateIdentifier(labelData: string, sharedKey: string): Promise<string> {
    const unhashedIdentifier = `${sharedKey}:${labelData}`
    const hashedIdentifier = await this.sha256(unhashedIdentifier)
    return hashedIdentifier.substring(0, 32)
  }

  private async generateSignerOfferingIdentifier(fingerprint: string): Promise<string> {
    const magic = this.getNetworkIdentifier()
    const unhashedIdentifier = `${magic}:${fingerprint}`
    const hashedIdentifier = await this.sha256(unhashedIdentifier)
    return hashedIdentifier.substring(0, 32)
  }


  /**
   * Asynchronously saves a label associated with a given policy ID.
   *
   * The method creates and publishes a Labels event.
   *
   * @async
   * @param {string} policyId - The ID of the policy to which the label is to be associated.
   * @param {SmartVaultsTypes.Label} label - The label object containing the data to be saved.
   * @returns {Promise<SmartVaultsTypes.PublishedLabel>} - A promise that resolves to the published label.
   * 
   * @throws {Error} - Throws an error if the policy event retrieval fails, or if shared keys are not found.
   * 
   * @example
   * const publishedLabel = await saveLabel('some-policy-id', { data: { 'Address': 'some-address' }, text: 'some-label-text' });
   */
  async saveLabel(policyId: string, label: SmartVaultsTypes.Label): Promise<SmartVaultsTypes.PublishedLabel> {
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyMembers = policyEvent.tags

    const publishedSharedKeyAuthenticator: SmartVaultsTypes.SharedKeyAuthenticator | undefined = (await this.getSharedKeysById([policyId])).get(policyId)
    if (!publishedSharedKeyAuthenticator) throw new Error(`Shared key for policy with id ${policyId} not found`)
    const sharedKeyAuthenticator = publishedSharedKeyAuthenticator.sharedKeyAuthenticator
    const privateKey = publishedSharedKeyAuthenticator.privateKey
    const labelId = await this.generateIdentifier(Object.values(label.data)[0], privateKey)
    const content = await sharedKeyAuthenticator.encryptObj(label)

    const labelEvent = await buildEvent({
      kind: SmartVaultsKind.Labels,
      content,
      tags: [...policyMembers, [TagType.Identifier, labelId], [TagType.Event, policyId]],
    },
      sharedKeyAuthenticator)

    const pub = this.nostrClient.publish(labelEvent)
    await pub.onFirstOkOrCompleteFailure()

    const publishedLabel: SmartVaultsTypes.PublishedLabel = {
      label,
      label_id: labelId,
      policy_id: policyId,
      createdAt: fromNostrDate(labelEvent.created_at),
      id: labelEvent.id,
      labelData: Object.values(label.data)[0]
    }

    return publishedLabel
  }

  private async _getLabels(filter: Filter<SmartVaultsKind.Labels>[]): Promise<SmartVaultsTypes.PublishedLabel[]> {
    const labelEvents = await this.nostrClient.list(filter)
    const labelHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.Labels)
    return labelHandler.handle(labelEvents)
  }

  /**
   * Asynchronously retrieves labels based on the given pagination options.
   *
   * @async
   * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options for fetching labels.
   * @returns {Promise<SmartVaultsTypes.PublishedLabel[]>} - A promise that resolves to an array of published labels.
   *
   * @example
   * const labels = await getLabels();
   */
  async getLabels(paginationOpts: PaginationOpts = {}): Promise<SmartVaultsTypes.PublishedLabel[]> {
    const labelsFilter = this.getFilter(SmartVaultsKind.Labels, { paginationOpts })
    const labels = await this._getLabels(labelsFilter)
    return labels
  }

  /**
   * Asynchronously retrieves labels associated with one or more policy IDs.
   *
   * This method first converts the input into an array of policy IDs (if not already), 
   * builds the appropriate filter with pagination options, and then fetches the labels.
   *
   * @async
   * @param {string[] | string} policy_ids - The policy IDs to filter labels by.
   * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options.
   * @returns {Promise<Map<string, SmartVaultsTypes.PublishedLabel | Array<SmartVaultsTypes.PublishedLabel>>>} - 
   * A promise that resolves to a map where the keys are policy IDs and the values are the associated labels.
   *
   * @example
   * const labelsMap = await getLabelsByPolicyId(['policy1', 'policy2']);
   */
  getLabelsByPolicyId = async (policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, SmartVaultsTypes.PublishedLabel | Array<SmartVaultsTypes.PublishedLabel>>> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(SmartVaultsKind.Labels);
    const labelsFilter = this.getFilter(SmartVaultsKind.Labels, { events: policyIds, paginationOpts })
    await this._getLabels(labelsFilter);
    return store.getMany(policyIds, "policy_id");
  }

  /**
   * Asynchronously retrieves one or more labels by their IDs.
   *
   * @async
   * @param {string[] | string} label_ids - The label IDs to fetch.
   * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options.
   * @returns {Promise<Map<string, SmartVaultsTypes.PublishedLabel>>} - 
   * A promise that resolves to a map where the keys are label IDs and the values are the corresponding labels.
   *
   * @example
   * const labelsMap = await getLabelById(['label1', 'label2']);
   */
  async getLabelById(label_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, SmartVaultsTypes.PublishedLabel>> {
    const labelIds = Array.isArray(label_ids) ? label_ids : [label_ids]
    const store = this.getStore(SmartVaultsKind.Labels);
    const labelsFilter = this.getFilter(SmartVaultsKind.Labels, { identifiers: labelIds, paginationOpts })
    await this._getLabels(labelsFilter);
    return store.getMany(labelIds, "label_id");
  }

  /**
   * Asynchronously retrieves a label given its label data.
   *
   * @async
   * @param {string} policyId - The policy ID associaded with the label.
   * @param {string} labelData - The label data (could be an address a trxid, etc).
   * @returns {Promise<SmartVaultsTypes.PublishedLabel>} - 
   * A promise that resolves to a PublishedLabel.
   *
   * @example
   * const labels = await getLabelByLabelData("policyId","trxid");
   */
  async getLabelByLabelData(policyId: string, labelData: string): Promise<SmartVaultsTypes.PublishedLabel> {
    const publishedSharedKeyAuthenticator: SmartVaultsTypes.SharedKeyAuthenticator | undefined = (await this.getSharedKeysById([policyId])).get(policyId)
    if (!publishedSharedKeyAuthenticator) throw new Error(`Shared key for policy with id ${policyId} not found`)
    const privateKey = publishedSharedKeyAuthenticator.privateKey
    const labelId = await this.generateIdentifier(labelData, privateKey)
    const label = (await this.getLabelById(labelId)).get(labelId)
    if (!label) {
      throw new Error(`Label with label data ${labelData} not found`)
    }
    return label
  }

  /**
   * Returns the number of contacts that have shared their signer.
   *
   * @async
   * @param {string} pubKey - The Nostr hex public key of user for which to fetch the number of contacts that have shared their signer.
   * @returns {Promise<number>} - 
   * A promise that resolves to the number of contacts that have shared their signer.
   *
   * @example
   * const howManySigners = await getContactSignersCount("hexPubKey");
   */
  async getContactSignersCount(pubKey: string): Promise<number> {
    const contactsFilter = this.getFilter(Kind.Contacts, { authors: pubKey })
    const contactsEvents = await this.nostrClient.list(contactsFilter)
    if (contactsEvents.length === 0) return 0
    const contactsEvent = contactsEvents[0]
    const contactsPubkeys: string[] = getTagValues(contactsEvent, TagType.PubKey)
    const sharedSignersFilter = filterBuilder()
      .kinds(SmartVaultsKind.SharedSigners)
      .authors(contactsPubkeys)
      .pubkeys(pubKey)
      .toFilters()
    const sharedSignersEvents = await this.nostrClient.list(sharedSignersFilter)
    if (sharedSignersEvents.length === 0) return 0
    const sharedSignerPubkeys = sharedSignersEvents.map(({ pubkey }) => pubkey)
    // remove duplicates
    const uniqueSharedSigners = new Set(sharedSignerPubkeys)
    return uniqueSharedSigners.size
  }

  /**
   * Changes the fiat currency used to fetch the Bitcoin exchange rate.
   *
   * @param {FiatCurrency} currency - The fiat currency to use. 
   * @returns {void}
   *
   * @example
   * changeFiatCurrency("usd");
   */
  changeActiveFiatCurrency = (currency: FiatCurrency): void => {
    this.bitcoinExchangeRate.setActiveFiatCurrency(currency)
  }

  /**
   * Updates the bitcoin exchange rate against the active fiat currency
   *
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * await updateBitcoinExchangeRate();
   */
  updateBitcoinExchangeRate = async (): Promise<void> => {
    const rate = await this.bitcoinExchangeRate.getExchangeRate(true)
    if (!rate) {
      throw new Error('Could not update bitcoin exchange rate')
    }
  }

  /**
   * Returns the current bitcoin exchange rate against the active fiat currency
   *
   * @returns {number}
   *
   * @example
   * const rate = getBitcoinExchangeRate();
   */
  getBitcoinExchangeRate = async (): Promise<number> => {
    const rate = await this.bitcoinExchangeRate.getExchangeRate()
    if (!rate) {
      throw new Error('Could not get bitcoin exchange rate')
    }
    return rate
  }

  /**
   * Returns the active fiat currency
   *
   * @returns {FiatCurrency}
   *
   * @example
   * const currency = getActiveFiatCurrency();
   */
  getActiveFiatCurrency = (): FiatCurrency => {
    return this.bitcoinExchangeRate.getActiveFiatCurrency()
  }

  /**
   * Changes the interval at which the bitcoin exchange rate is updated
   *
   * @param {number} interval - The interval in minutes
   * @returns {void}
   *
   * @example
   * changeBitcoinExchangeRateUpdateInterval(30);
   */
  changeBitcoinExchangeRateUpdateInterval = (interval: number): void => {
    this.bitcoinExchangeRate.setUpdateInterval(interval)
  }

  isKeyAgent = async (pubkey?: string): Promise<boolean> => {
    const author = pubkey || this.authenticator.getPublicKey()
    const keyAgentFilter = this.getFilter(SmartVaultsKind.KeyAgents, { authors: author })
    const keyAgentEvents = await this.nostrClient.list(keyAgentFilter)
    return keyAgentEvents.length === 1 && keyAgentEvents[0].pubkey === author
  }

  isAuthority = async (pubkey?: string): Promise<boolean> => {
    const author = pubkey || this.authenticator.getPublicKey()
    return author === this.getAuthority()
  }

  async getVerifiedKeyAgentsEvent(): Promise<Event<SmartVaultsKind.VerifiedKeyAgents>> {
    const identifier = this.getNetworkIdentifier();
    const filter = this.getFilter(SmartVaultsKind.VerifiedKeyAgents, { identifiers: identifier });
    const keyAgentEvents = await this.nostrClient.list(filter);
    return this.processKeyAgentEvents(keyAgentEvents);
  }

  private getNetworkIdentifier(): Magic {
    switch (this.network) {
      case NetworkType.Bitcoin:
        return Magic.Bitcoin;
      case NetworkType.Testnet:
        return Magic.Testnet;
      case NetworkType.Regtest:
        return Magic.Regtest;
      case NetworkType.Signet:
        return Magic.Signet;
      default:
        throw new Error(`Unknown network ${this.network}`);
    }
  }


  private processKeyAgentEvents(events: Array<Event<SmartVaultsKind.VerifiedKeyAgents>>): Event<SmartVaultsKind.VerifiedKeyAgents> {
    const validEvents = events.filter(event => this.isValidAuthority(event));

    if (validEvents.length === 0) {
      throw new Error('No verified key agents found');
    }

    if (validEvents.length > 1) {
      throw new Error('More than one verified key agents event found');
    }

    return validEvents[0];
  }

  private isValidAuthority(keyAgentEvent: Event<SmartVaultsKind.VerifiedKeyAgents>): boolean {
    return keyAgentEvent.pubkey === this.getAuthority();
  }

  getVerifiedKeyAgentsPubKeys = async (): Promise<string[]> => {
    let event: Event<SmartVaultsKind.VerifiedKeyAgents> | undefined
    let verifiedKeyAgents: string[] = []
    try {
      event = await this.getVerifiedKeyAgentsEvent();
      if (!event) return []
      const keyAgentsObj: SmartVaultsTypes.BaseVerifiedKeyAgents = JSON.parse(event.content);
      verifiedKeyAgents = Object.keys(keyAgentsObj);
    } catch (e) {
      return []
    }
    return verifiedKeyAgents
  }

  isVerifiedKeyAgent = async (pubkey?: string): Promise<boolean> => {
    const author = pubkey || this.authenticator.getPublicKey()
    const verifiedKeyAgentsPubkeys = await this.getVerifiedKeyAgentsPubKeys()
    return verifiedKeyAgentsPubkeys.includes(author)
  }

  getVerifiedKeyAgents = async (): Promise<Array<SmartVaultsTypes.KeyAgent>> => {
    let verifiedKeyAgentsEvent: Event<SmartVaultsKind.VerifiedKeyAgents> | undefined
    try {
      verifiedKeyAgentsEvent = await this.getVerifiedKeyAgentsEvent()
    } catch (e) {
      return []
    }
    const verifiedKeyAgentHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.VerifiedKeyAgents)
    const verifedKeyAgents: Array<SmartVaultsTypes.KeyAgent> = await verifiedKeyAgentHandler.handle(verifiedKeyAgentsEvent)
    return verifedKeyAgents
  }


  saveVerifiedKeyAgent = async (keyAgentPubKey: string): Promise<SmartVaultsTypes.KeyAgent> => {
    const isAuthority = this.authenticator.getPublicKey() === this.getAuthority()
    if (!isAuthority) throw new Error('Unauthorized')
    const identifier = this.getNetworkIdentifier();
    let verifiedKeyAgentsEvent: Event<SmartVaultsKind.VerifiedKeyAgents> | undefined
    try {
      verifiedKeyAgentsEvent = await this.getVerifiedKeyAgentsEvent()
    } catch (e) {
      console.warn(e)
    }
    const verifiedKeyAgents: SmartVaultsTypes.BaseVerifiedKeyAgents = verifiedKeyAgentsEvent?.content ? JSON.parse(verifiedKeyAgentsEvent.content) : {}
    const currentTimeInSeconds = TimeUtil.getCurrentTimeInSeconds()
    const baseVerifiedKeyAgentData: SmartVaultsTypes.BaseVerifiedKeyAgentData = { approved_at: currentTimeInSeconds }
    const updatedVerifiedKeyAgents: SmartVaultsTypes.BaseVerifiedKeyAgents = { ...verifiedKeyAgents, [keyAgentPubKey]: baseVerifiedKeyAgentData }
    const content = JSON.stringify(updatedVerifiedKeyAgents)

    const updatedVerifiedKeyAgentsEvent = await buildEvent({
      kind: SmartVaultsKind.VerifiedKeyAgents,
      content,
      tags: [[TagType.Identifier, identifier]],
    },
      this.authenticator)

    const profilePromise = this.getProfile(keyAgentPubKey) || { publicKey: keyAgentPubKey }
    const pub = this.nostrClient.publish(updatedVerifiedKeyAgentsEvent)

    const [profile] = await Promise.all([profilePromise, pub.onFirstOkOrCompleteFailure()])

    const verifiedKeyAgent: SmartVaultsTypes.KeyAgent = {
      pubkey: keyAgentPubKey,
      profile,
      approvedAt: fromNostrDate(baseVerifiedKeyAgentData.approved_at),
      isVerified: true,
      isContact: false,
      eventId: updatedVerifiedKeyAgentsEvent.id,
    }

    return verifiedKeyAgent
  }

  removeVerifiedKeyAgent = async (keyAgentPubKey: string): Promise<void> => {
    const authorityPubKey = this.authenticator.getPublicKey();
    if (authorityPubKey !== this.getAuthority()) {
      throw new Error('Unauthorized');
    }

    let verifiedKeyAgentsEvent;
    try {
      verifiedKeyAgentsEvent = await this.getVerifiedKeyAgentsEvent();
    } catch (e) {
      throw new Error('No verified key agents found');
    }

    const verifiedKeyAgents: SmartVaultsTypes.BaseVerifiedKeyAgents = verifiedKeyAgentsEvent?.content ? JSON.parse(verifiedKeyAgentsEvent.content) : {};

    if (!verifiedKeyAgents[keyAgentPubKey]) {
      console.info(`Key agent ${keyAgentPubKey} is not verified or already removed.`);
      return;
    }

    delete verifiedKeyAgents[keyAgentPubKey];
    const content = JSON.stringify(verifiedKeyAgents);

    const updatedVerifiedKeyAgentsEvent = await buildEvent({
      kind: SmartVaultsKind.VerifiedKeyAgents,
      content,
      tags: [[TagType.Identifier, this.getNetworkIdentifier()]],
    }, this.authenticator);

    const publishPromise = this.nostrClient.publish(updatedVerifiedKeyAgentsEvent);
    await publishPromise.onFirstOkOrCompleteFailure();
  }


  async _getSignerOfferings(filter: Filter<SmartVaultsKind.SignerOffering>[]): Promise<SmartVaultsTypes.PublishedSignerOffering[]> {
    const signerOfferingEvents = await this.nostrClient.list(filter)
    const signerOfferingHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.SignerOffering)
    return signerOfferingHandler.handle(signerOfferingEvents)
  }

  async getSignerOfferings(fromVerifiedKeyAgents?: boolean, paginationOpts?: PaginationOpts): Promise<SmartVaultsTypes.PublishedSignerOffering[]> {
    const verifiedKeyAgents = fromVerifiedKeyAgents ? await this.getVerifiedKeyAgentsPubKeys() : []
    const verifiedKeyAgentsPubkeys: string[] | undefined = verifiedKeyAgents.length ? verifiedKeyAgents : undefined
    const signerOfferingsFilter = this.getFilter(SmartVaultsKind.SignerOffering, { authors: verifiedKeyAgentsPubkeys, paginationOpts })
    const signerOfferings = await this._getSignerOfferings(signerOfferingsFilter)
    return signerOfferings
  }

  async getSignerOfferingsById(signerOfferingIds?: string[], fromVerifiedKeyAgents?: boolean, paginationOpts?: PaginationOpts): Promise<Map<string, SmartVaultsTypes.PublishedSignerOffering>> {
    const verifiedKeyAgents = fromVerifiedKeyAgents ? await this.getVerifiedKeyAgentsPubKeys() : []
    const verifiedKeyAgentsPubkeys: string[] | undefined = verifiedKeyAgents.length ? verifiedKeyAgents : undefined
    const signerOfferingsFilter = this.getFilter(SmartVaultsKind.SignerOffering, { identifiers: signerOfferingIds, authors: verifiedKeyAgentsPubkeys, paginationOpts })
    await this._getSignerOfferings(signerOfferingsFilter)
    const store = this.getStore(SmartVaultsKind.SignerOffering);
    return store.getMany(signerOfferingIds, "offeringId");
  }

  async getOwnedSignerOfferings(): Promise<SmartVaultsTypes.PublishedSignerOffering[]> {
    const isKeyAgent = await this.isKeyAgent()
    if (!isKeyAgent) return []
    const signerOfferingsFilter = this.getFilter(SmartVaultsKind.SignerOffering, { authors: this.authenticator.getPublicKey() })
    const signerOfferings = await this._getSignerOfferings(signerOfferingsFilter)
    return signerOfferings
  }

  async getOwnedSignerOfferingsById(signerOfferingIds?: string[]): Promise<Map<string, SmartVaultsTypes.PublishedSignerOffering>> {
    const isKeyAgent = await this.isKeyAgent()
    if (!isKeyAgent) return new Map()
    const signerOfferingsFilter = this.getFilter(SmartVaultsKind.SignerOffering, { identifiers: signerOfferingIds, authors: this.authenticator.getPublicKey() })
    const offerings = await this._getSignerOfferings(signerOfferingsFilter)
    const offeringsByOfferingId = new Map<string, SmartVaultsTypes.PublishedSignerOffering>()
    offerings.forEach(offering => offeringsByOfferingId.set(offering.offeringId, offering))
    return offeringsByOfferingId
  }

  async getOwnedSignerOfferingsBySignerFingerprint(signerFingerprints?: string[]): Promise<Map<string, SmartVaultsTypes.PublishedSignerOffering>> {
    const signerOfferingIdentifiersPromises = signerFingerprints ? signerFingerprints.map(fingerprint => this.generateSignerOfferingIdentifier(fingerprint)) : undefined
    let signerOfferingsIdentifiers: string[] | undefined
    if (signerOfferingIdentifiersPromises) signerOfferingsIdentifiers = await Promise.all(signerOfferingIdentifiersPromises)
    const signerOfferingsById = await this.getOwnedSignerOfferingsById(signerOfferingsIdentifiers)
    const offeringsBySignerFingerprint = new Map<string, SmartVaultsTypes.PublishedSignerOffering>()
    signerOfferingsById.forEach(offering => offeringsBySignerFingerprint.set(offering.signerFingerprint || 'unknown', offering))
    return offeringsBySignerFingerprint
  }

  async getOwnedSignerOfferingsBySignerDescriptor(signerDescriptors?: string[]): Promise<Map<string, SmartVaultsTypes.PublishedSignerOffering>> {
    const signerOfferingsFilter = this.getFilter(SmartVaultsKind.SignerOffering, { authors: this.authenticator.getPublicKey() })
    await this._getSignerOfferings(signerOfferingsFilter)
    const store = this.getStore(SmartVaultsKind.SignerOffering);
    return store.getMany(signerDescriptors, "signerDescriptor");
  }

  getSignerOfferingsByKeyAgentPubKey = async (keyAgentsPubKeys?: string[], fromVerifiedKeyAgents?: boolean, paginationOpts?: PaginationOpts): Promise<Map<string, SmartVaultsTypes.PublishedSignerOffering> | Map<string, Array<SmartVaultsTypes.PublishedSignerOffering>>> => {
    let authors: string[] | undefined
    if (keyAgentsPubKeys) {
      authors = keyAgentsPubKeys
    }
    if (fromVerifiedKeyAgents) {
      const verifiedKeyAgents = fromVerifiedKeyAgents ? await this.getVerifiedKeyAgentsPubKeys() : []
      const verifiedKeyAgentsPubkeys: string[] | undefined = verifiedKeyAgents.length ? verifiedKeyAgents : undefined
      if (verifiedKeyAgentsPubkeys) {
        authors = authors ? authors.filter(author => verifiedKeyAgentsPubkeys.includes(author)) : verifiedKeyAgentsPubkeys
      }
    }
    const signerOfferingsFilter = this.getFilter(SmartVaultsKind.SignerOffering, { authors, paginationOpts })
    await this._getSignerOfferings(signerOfferingsFilter)
    const store = this.getStore(SmartVaultsKind.SignerOffering);
    return store.getMany(authors, "keyAgentPubKey");
  }



  saveSignerOffering = async (signer: SmartVaultsTypes.PublishedOwnedSigner, offering: SmartVaultsTypes.SignerOffering, confirmationComponent?: () => Promise<boolean>): Promise<SmartVaultsTypes.PublishedSignerOffering> => {

    const isKeyAgent = await this.isKeyAgent()

    if (!isKeyAgent) {
      const isVerifiedKeyAgent = await this.isVerifiedKeyAgent()
      if (!isVerifiedKeyAgent) throw new Error('Only key agents can create signer offerings')
    }

    const fingerprint = signer.fingerprint
    const id = await this.generateSignerOfferingIdentifier(fingerprint)

    const ownedSignerOfferingsWithSameId = await this.getOwnedSignerOfferingsById([id])
    if (ownedSignerOfferingsWithSameId.size !== 0) {
      const confirmedByUser = confirmationComponent ? await confirmationComponent() : window.confirm(`Signer offering for signer with fingerprint ${fingerprint} already exists. Are you sure you want to replace it?`);
      if (!confirmedByUser) {
        throw new Error(`Canceled by user.`)
      }
    }

    const signerOfferingEvent = await buildEvent({
      kind: SmartVaultsKind.SignerOffering,
      content: JSON.stringify(offering),
      tags: [[TagType.Identifier, id]],
    },
      this.authenticator)

    const pub = this.nostrClient.publish(signerOfferingEvent)
    await pub.onFirstOkOrCompleteFailure()

    const publishedSignerOffering: SmartVaultsTypes.PublishedSignerOffering = {
      ...offering,
      offeringId: id,
      id: signerOfferingEvent.id,
      createdAt: fromNostrDate(signerOfferingEvent.created_at),
      keyAgentPubKey: signerOfferingEvent.pubkey,
      signerFingerprint: fingerprint,
      signerDescriptor: signer.descriptor,
    }

    return publishedSignerOffering
  }

  updateProfile = async (metadata: SmartVaultsTypes.Metadata): Promise<SmartVaultsTypes.Profile> => {
    const oldProfile = await this.getProfile() || {}
    const { publicKey, ...oldMetadata } = oldProfile
    const updatedMetadata: SmartVaultsTypes.Metadata = { ...oldMetadata, ...metadata }
    const updatedProfile = await this.setProfile(updatedMetadata)
    return updatedProfile
  }

  private publishKeyAgentSignalingEvent = async (): Promise<void> => {
    const identifier = this.getNetworkIdentifier();
    const keyAgentSignalingEvent = await buildEvent({
      kind: SmartVaultsKind.KeyAgents,
      content: '',
      tags: [[TagType.Identifier, identifier]],
    },
      this.authenticator)
    const pub = this.nostrClient.publish(keyAgentSignalingEvent)
    await pub.onFirstOkOrCompleteFailure()
  }

  saveKeyAgent = async (metadata?: SmartVaultsTypes.Metadata): Promise<SmartVaultsTypes.KeyAgent> => {
    const pubkey = this.authenticator.getPublicKey();
    const [isKeyAgent, isVerifiedKeyAgent] = await Promise.all([this.isKeyAgent(pubkey), this.isVerifiedKeyAgent(pubkey)]);

    if (isKeyAgent && !metadata) {
      return { pubkey } as SmartVaultsTypes.KeyAgent;
    }

    let profile: SmartVaultsTypes.Profile = { publicKey: pubkey };

    const promises = !isKeyAgent && !isVerifiedKeyAgent ? [this.publishKeyAgentSignalingEvent()] : [];

    if (metadata) {
      promises.push(this.updateProfile(metadata).then(updatedProfile => {
        profile = updatedProfile;
      }));
    }

    await Promise.all(promises);

    if (metadata && isKeyAgent && this.getStore(SmartVaultsKind.KeyAgents).has(pubkey)) {
      this.getStore(SmartVaultsKind.KeyAgents).get(pubkey).profile = profile;
    }

    if (metadata && isVerifiedKeyAgent && this.getStore(SmartVaultsKind.VerifiedKeyAgents).has(pubkey, 'pubkey')) {
      this.getStore(SmartVaultsKind.VerifiedKeyAgents).get(pubkey, 'pubkey').profile = profile;
    }

    const keyAgent: SmartVaultsTypes.KeyAgent = {
      pubkey,
      profile,
      isVerified: false,
      isContact: false,
    };

    return keyAgent;
  };

  getUnverifiedKeyAgents = async (): Promise<Array<SmartVaultsTypes.KeyAgent>> => {
    const keyAgentsFilter = this.getFilter(SmartVaultsKind.KeyAgents)
    const keyAgentsEvents = await this.nostrClient.list(keyAgentsFilter)
    const keyAgentHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.KeyAgents)
    const keyAgents = keyAgentHandler.handle(keyAgentsEvents)
    return keyAgents
  }

  getUnverifiedKeyAgentsByPubKeys = async (pubKeys: string[]): Promise<Map<string, Array<SmartVaultsTypes.KeyAgent>> | Map<string, SmartVaultsTypes.KeyAgent>> => {
    const keyAgentsFilter = this.getFilter(SmartVaultsKind.KeyAgents, { authors: pubKeys })
    const keyAgentsEvents = await this.nostrClient.list(keyAgentsFilter)
    const keyAgentHandler = this.eventKindHandlerFactor.getHandler(SmartVaultsKind.KeyAgents)
    await keyAgentHandler.handle(keyAgentsEvents)
    return this.getStore(SmartVaultsKind.KeyAgents).getMany(pubKeys, "pubkey")
  }

  getCompletedProposalsByType = async (policyId: string, type: ProposalType,): Promise<SmartVaultsTypes.CompletedPublishedProposal[]> => {
    const completedProposals = (await this.getCompletedProposalsByPolicyId(policyId)).get(policyId)
    if (!completedProposals) return []
    const completedProposalsArray = Array.isArray(completedProposals) ? completedProposals : [completedProposals]
    const completedProposalsByType = completedProposalsArray.filter(completedProposal => completedProposal.type === type)
    return completedProposalsByType
  }

  getActiveProposalsByType = async (policyId: string, type: ProposalType,): Promise<SmartVaultsTypes.ActivePublishedProposal[]> => {
    const activeProposals = (await this.getProposalsByPolicyId(policyId)).get(policyId)
    if (!activeProposals) return []
    const activeProposalsArray = Array.isArray(activeProposals) ? activeProposals : [activeProposals]
    const activeProposalsByType = activeProposalsArray.filter(activeProposal => activeProposal.type === type)
    return activeProposalsByType
  }


  getLastCompletedKeyAgentPaymentProposal = async (policyId: string, signerDescriptor?: string): Promise<SmartVaultsTypes.CompletedPublishedProposal | undefined> => {
    let completedProposals = await this.getCompletedProposalsByType(policyId, ProposalType.KeyAgentPayment)
    if (signerDescriptor) completedProposals = completedProposals.filter(completedProposal => 'signer_descriptor' in completedProposal && completedProposal.signer_descriptor === signerDescriptor)
    const lastCompletedProposal = completedProposals.sort((a, b) => b.completion_date.getTime() - a.completion_date.getTime())
    return lastCompletedProposal[0]
  }

  hasActiveKeyAgentPaymentProposal = async (policyId: string, signerDescriptor?: string): Promise<boolean> => {
    const activeProposals = await this.getActiveProposalsByType(policyId, ProposalType.KeyAgentPayment)
    if (signerDescriptor) return activeProposals.some(activeProposal => 'signer_descriptor' in activeProposal && activeProposal.signer_descriptor === signerDescriptor)
    return activeProposals.length > 0
  }

  getProposalPsbt = async (proposalId: string): Promise<string> => {
    const proposal = (await this.getProposalsById(proposalId)).get(proposalId)
    if (!proposal) throw new Error(`Proposal with id ${proposalId} not found`)
    return proposal.psbt
  }

  downloadProposalPsbt = async (proposalId: string): Promise<void> => {
    const psbt = await this.getProposalPsbt(proposalId)
    const bytes = new Uint8Array(this.bitcoinUtil.fromBase64(psbt))
    const name = `proposal-${proposalId.slice(-8)}`
    saveFile(name, bytes.buffer)
  }

  async getPsbtFromFileSystem(): Promise<string> {
    try {
      const fileContent = await readFile();
      return this.bitcoinUtil.toBase64(new Uint8Array(fileContent as ArrayBuffer));
    } catch (error) {
      throw new Error(`Could not read file: ${error}`);
    }
  }
}
