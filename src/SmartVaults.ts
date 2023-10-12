import { Authenticator, DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { generatePrivateKey, Kind, Event, Filter, Sub } from 'nostr-tools'
import { SmartVaultsKind, TagType, ProposalType, ProposalStatus, ApprovalStatus, StoreKind, AuthenticatorType, NetworkType } from './enum'
import { NostrClient, PubPool, Store } from './service'
import { buildEvent, filterBuilder, getTagValues, PaginationOpts, fromNostrDate, toPublished, nostrDate, isNip05Verified } from './util'
import { BasicTrxDetails, BaseOwnedSigner, BaseSharedSigner, BitcoinUtil, Contact, Policy, PublishedPolicy, TrxDetails } from './models'
import * as SmartVaultsTypes from './types'
import { EventKindHandlerFactory } from './event-kind-handler'

export class SmartVaults {
  authenticator: Authenticator
  bitcoinUtil: BitcoinUtil
  nostrClient: NostrClient
  stores!: Map<number, Store>
  network: NetworkType
  private eventKindHandlerFactor!: EventKindHandlerFactory

  constructor({
    authenticator,
    bitcoinUtil,
    nostrClient,
    network,
  }: {
    authenticator: Authenticator,
    bitcoinUtil: BitcoinUtil,
    nostrClient: NostrClient,
    network: NetworkType,
  }) {
    this.authenticator = authenticator
    this.bitcoinUtil = bitcoinUtil
    this.nostrClient = nostrClient
    this.network = network
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
    this.stores.set(SmartVaultsKind.Labels, Store.createMultiIndexStore(["id", "policy_id", "label_id", "unhashed"], "id"))
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
  async getProfiles(publicKeys: string[]): Promise<SmartVaultsTypes.Profile[]> {
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
    useFrozenUtxos = false
  }: SmartVaultsTypes.SpendProposalPayload): Promise<SmartVaultsTypes.PublishedSpendingProposal> {

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
    let proposalContent: SmartVaultsTypes.SpendingProposal = {
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
      kind: SmartVaultsKind.Proposal,
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
    const utxo = this.bitcoinUtil.getPsbtUtxos(psbt)
    Promise.all(promises)
    return {
      ...proposalContent[type],
      signer,
      fee,
      utxos: utxo,
      type: ProposalType.Spending,
      status: ProposalStatus.Unsigned,
      policy_id: policy.id,
      proposal_id: proposalEvent.id,
      createdAt
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

  private buildFilter(kind: SmartVaultsKind | Kind, useAuthors = false, paginationOpts: PaginationOpts = {}): Filter<number> {


    let builder = filterBuilder().kinds(kind).pagination(paginationOpts)

    if (useAuthors) {
      builder = builder.authors(this.authenticator.getPublicKey())
    } else {
      builder = builder.pubkeys(this.authenticator.getPublicKey())
    }

    return builder.toFilter()
  }

  private subscriptionFilters(kinds: (SmartVaultsKind | Kind)[]): Filter<number>[] {
    let filters: Filter<number>[] = [];
    const smartVaultsKinds = new Set(Object.values(SmartVaultsKind));
    const kindsSet = new Set(Object.values(Kind));
    const paginationOpts = {
      since: nostrDate()
    }
    for (const kind of kinds) {
      if (smartVaultsKinds.has(kind as SmartVaultsKind)) {
        const useAuthors = kind === SmartVaultsKind.Signers;
        filters.push(this.buildFilter(kind as SmartVaultsKind, useAuthors, paginationOpts));
      } else if (kindsSet.has(kind as Kind)) {
        const useAuthors = kind === Kind.Metadata || kind === Kind.Contacts;
        filters.push(this.buildFilter(kind as Kind, useAuthors, paginationOpts));
      } else {
        throw new Error(`Invalid kind: ${kind}`);
      }
    }

    return filters;
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
    const signersFilter = this.buildOwnedSignersFilter()
    return this._getOwnedSigners(signersFilter)
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
    const sharedSignersFilter = this.buildSharedSignersFilter();
    if (keysToFilter.length > 0) {
      sharedSignersFilter.authors(keysToFilter);
    }
    return this._getSharedSigners(sharedSignersFilter.toFilters());
  }

  extractKey(descriptor: string): string {
    const matches = descriptor.match(/\((.*?)\)/)
    if (!matches) throw new Error('Invalid descriptor')
    return matches[1]
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

    const directMessagesFilter = filterBuilder()
      .kinds(Kind.EncryptedDirectMessage)
      .pubkeys(this.authenticator.getPublicKey())
      .pagination(paginationOpts)
      .toFilters()
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

  private buildSharedSignersFilter() {
    return filterBuilder()
      .kinds(SmartVaultsKind.SharedSigners)
      .pubkeys(this.authenticator.getPublicKey())
  }

  private buildOwnedSignersFilter() {
    return filterBuilder()
      .kinds(SmartVaultsKind.Signers)
      .authors(this.authenticator.getPublicKey())
      .toFilters();
  }

  private buildMySharedSignersFilter() {
    return filterBuilder()
      .kinds(SmartVaultsKind.SharedSigners)
      .authors(this.authenticator.getPublicKey())
  }

  private buildProposalsFilter() {
    return filterBuilder()
      .kinds(SmartVaultsKind.Proposal)
      .pubkeys(this.authenticator.getPublicKey())
  }

  private buildCompletedProposalsFilter() {
    return filterBuilder()
      .kinds(SmartVaultsKind.CompletedProposal)
      .pubkeys(this.authenticator.getPublicKey())
  }

  private buildApprovedProposalsFilter() {
    return filterBuilder()
      .kinds(SmartVaultsKind.ApprovedProposal)
      .pubkeys(this.authenticator.getPublicKey())
  }

  private buildLabelsFilter() {
    return filterBuilder()
      .kinds(SmartVaultsKind.Labels)
      .pubkeys(this.authenticator.getPublicKey())
  }

  private async getProposalEvent(proposal_id: any) {
    const proposalsFilter = filterBuilder()
      .kinds(SmartVaultsKind.Proposal)
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
   * @returns {Promise<Map<string, SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal>>} 
   *          - A promise that resolves to a map where the keys are proposal IDs and the values are either PublishedCompletedSpendingProposal or PublishedCompletedProofOfReserveProposal objects.
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
   * @see SmartVaultsTypes.PublishedCompletedSpendingProposal - For the structure of a PublishedCompletedSpendingProposal object.
   * @see SmartVaultsTypes.PublishedCompletedProofOfReserveProposal - For the structure of a PublishedCompletedProofOfReserveProposal object.
   */
  async getCompletedProposalsById(ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal>> {
    const completedProposalsIds = Array.isArray(ids) ? ids : [ids]
    const store = this.getStore(SmartVaultsKind.CompletedProposal);
    const missingIds = store.missing(completedProposalsIds);
    if (missingIds.length) {
      const completedProposalsFilter = this.buildCompletedProposalsFilter().ids(missingIds).pagination(paginationOpts).toFilters();
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
   * @returns {Promise<Map<string, (SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal)
   *          | Array<SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal>
    *          >>} 
    *          - A promise that resolves to a map where the keys are policy IDs and the values are either single or arrays of PublishedCompletedSpendingProposal or PublishedCompletedProofOfReserveProposal objects.
    * 
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
    * @see SmartVaultsTypes.PublishedCompletedProofOfReserveProposal - For the structure of a PublishedCompletedProofOfReserveProposal object.
    */
  getCompletedProposalsByPolicyId = async (policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, (SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal)
    | Array<SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal>
  >> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(SmartVaultsKind.CompletedProposal);
    const missingIds = store.missing(policyIds, "policy_id");
    if (missingIds.length) {
      const completedProposalsFilter = this.buildCompletedProposalsFilter().events(policyIds).pagination(paginationOpts).toFilters();
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
   * @returns {Promise<(SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal)[]>} 
   *          - A promise that resolves to an array of either PublishedCompletedSpendingProposal or PublishedCompletedProofOfReserveProposal objects.
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
   * @see SmartVaultsTypes.PublishedCompletedSpendingProposal - For the structure of a PublishedCompletedSpendingProposal object.
   * @see SmartVaultsTypes.PublishedCompletedProofOfReserveProposal - For the structure of a PublishedCompletedProofOfReserveProposal object.
   */
  async getCompletedProposals(paginationOpts: PaginationOpts = {}): Promise<(SmartVaultsTypes.PublishedCompletedSpendingProposal | SmartVaultsTypes.PublishedCompletedProofOfReserveProposal)[]> {
    const completedProposalsFilter = this.buildCompletedProposalsFilter().pagination(paginationOpts).toFilters()
    const completedProposals = await this._getCompletedProposals(completedProposalsFilter)
    return completedProposals
  }

  private async _getApprovals(filter: Filter<SmartVaultsKind.ApprovedProposal>[]): Promise<SmartVaultsTypes.PublishedApprovedProposal[]> {
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
    let approvedProposalsFilter = this.buildApprovedProposalsFilter();
    if (proposalIds) {
      approvedProposalsFilter = approvedProposalsFilter.events(proposalIds);
    }
    const approvalsArray = await this._getApprovals(approvedProposalsFilter.toFilters());
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
   * @returns {Promise<Map<string, (SmartVaultsTypes.PublishedApprovedProposal) | Array<SmartVaultsTypes.PublishedApprovedProposal>>>} 
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
    let approvedProposalsFilter = this.buildApprovedProposalsFilter();
    const store = this.getStore(SmartVaultsKind.ApprovedProposal);
    if (policyIds) {
      approvedProposalsFilter = approvedProposalsFilter.events(policyIds);
    }
    await this._getApprovals(approvedProposalsFilter.toFilters());
    return store.getMany(policyIds, "policy_id");
  }


  /**
  * @ignore
  */
  private async _getProposals(filter: Filter<SmartVaultsKind.Policy>[]): Promise<Array<SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedProofOfReserveProposal>> {
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
   * @returns {Promise<Map<string, SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedProofOfReserveProposal>>} 
   *          - A promise that resolves to a Map. Each key corresponds to a proposal ID, and the value is either a PublishedSpendingProposal or PublishedProofOfReserveProposal object.
   *
   * @throws {Error} - Throws an error if there is a failure in fetching the proposals.
   *
   * @example
   * const proposalsById = await getProposalsById('some-proposal-id');
   */
  async getProposalsById(proposal_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedProofOfReserveProposal>> {
    const proposalIds = Array.isArray(proposal_ids) ? proposal_ids : [proposal_ids]
    const store = this.getStore(SmartVaultsKind.Proposal);
    const proposalsFilter = this.buildProposalsFilter().ids(proposal_ids).pagination(paginationOpts).toFilters();
    await this._getProposals(proposalsFilter);
    return store.getMany(proposalIds, "proposal_id");
  }

  /**
   * Asynchronously fetches proposals by associated policy IDs.
   *
   * @async
   * @param {string[] | string} policy_ids - A single policy ID or an array of policy IDs for which to fetch proposals.
   * @param {PaginationOpts} [paginationOpts={}] - Optional pagination options.
   * @returns {Promise<Map<string, (SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedProofOfReserveProposal) 
   *           | Array<SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedProofOfReserveProposal>>>} 
   *          - A promise that resolves to a Map. Each key corresponds to a policy ID, and the value is either a single PublishedSpendingProposal or PublishedProofOfReserveProposal object or an array of them.
   *
   * @throws {Error} - Throws an error if there is a failure in fetching the proposals.
   *
   * @example
   * const proposalsByPolicyId = await getProposalsByPolicyId('some-policy-id');
   */
  getProposalsByPolicyId = async (policy_ids: string[] | string, paginationOpts: PaginationOpts = {}): Promise<Map<string, (SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedProofOfReserveProposal)
    | Array<SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedProofOfReserveProposal>
  >> => {
    const policyIds = Array.isArray(policy_ids) ? policy_ids : [policy_ids]
    const store = this.getStore(SmartVaultsKind.Proposal);
    const proposalsFilter = this.buildProposalsFilter().events(policyIds).pagination(paginationOpts).toFilters();
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
  async getProposals(paginationOpts: PaginationOpts = {}): Promise<Array<SmartVaultsTypes.PublishedSpendingProposal | SmartVaultsTypes.PublishedProofOfReserveProposal>> {
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
  async finalizeSpendingProposal(proposalId: string): Promise<SmartVaultsTypes.PublishedCompletedSpendingProposal> {
    const proposalMap = await this.getProposalsById(proposalId)

    const proposal = proposalMap.get(proposalId) as SmartVaultsTypes.PublishedSpendingProposal
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

    const completedProposal: SmartVaultsTypes.CompletedSpendingProposal = {
      [type]: {
        tx: txResponse.trx,
        description: proposal.description,
      }
    }

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


    const publishedCompletedProposal: SmartVaultsTypes.PublishedCompletedSpendingProposal = {
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
  async _saveApprovedProposal(proposal_id: string): Promise<SmartVaultsTypes.PublishedApprovedProposal> {
    const proposalEvent = await this.getProposalEvent(proposal_id)
    const policyId = getTagValues(proposalEvent, TagType.Event)[0]
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyMembers = policyEvent.tags

    const sharedKeyAuthenticator: any = (await this.getSharedKeysById([policyId])).get(policyId)?.sharedKeyAuthenticator

    const decryptedProposalObj = await sharedKeyAuthenticator.decryptObj(proposalEvent.content)
    const type = decryptedProposalObj[ProposalType.Spending] ? ProposalType.Spending : ProposalType.ProofOfReserve

    const approvedProposal: SmartVaultsTypes.BaseApprovedProposal = {
      [type]: {
        ...decryptedProposalObj[type],
      }
    }

    const expirationDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    const content = await sharedKeyAuthenticator.encryptObj(approvedProposal)
    const approvedProposalEvent = await buildEvent({
      kind: SmartVaultsKind.ApprovedProposal,
      content,
      tags: [...policyMembers, [TagType.Event, proposal_id], [TagType.Event, policyId], [TagType.Expiration, expirationDate.toString()]],
    },
      this.authenticator)

    const publishedApprovedProposal: SmartVaultsTypes.PublishedApprovedProposal = {
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

  /**
  * @ignore
  */
  async _saveCompletedProposal(proposal_id: string, payload: SmartVaultsTypes.CompletedProofOfReserveProposal | SmartVaultsTypes.CompletedSpendingProposal): Promise<any> {
    const proposalEvent = await this.getProposalEvent(proposal_id)
    const policyId = getTagValues(proposalEvent, TagType.Event)[0]
    const policyEvent = await this.getPolicyEvent(policyId)
    const policyMembers = policyEvent.tags

    const sharedKeyAuthenticator: any = (await this.getSharedKeysById([policyId])).get(policyId)?.sharedKeyAuthenticator

    const completedProposal: SmartVaultsTypes.CompletedProofOfReserveProposal | SmartVaultsTypes.CompletedSpendingProposal = {
      ...payload
    }
    const type = payload[ProposalType.Spending] ? ProposalType.Spending : ProposalType.ProofOfReserve
    const content = await sharedKeyAuthenticator.encryptObj(completedProposal)
    let txId;
    if (type === ProposalType.Spending) {
      const spendingProposal: SmartVaultsTypes.CompletedSpendingProposal = payload as SmartVaultsTypes.CompletedSpendingProposal;
      txId = this.bitcoinUtil.getTrxId(spendingProposal[type].tx)
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

    const publishedCompletedProposal: SmartVaultsTypes.PublishedCompletedProofOfReserveProposal | SmartVaultsTypes.PublishedCompletedSpendingProposal = {
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

  private async generateIdentifier(labelData: string, sharedKey: string): Promise<string> {
    const unhashedIdentifier = `${sharedKey}:${labelData}`
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
    if (!publishedSharedKeyAuthenticator) return {} as SmartVaultsTypes.PublishedLabel
    const sharedKeyAuthenticator = publishedSharedKeyAuthenticator?.sharedKeyAuthenticator
    const privateKey = publishedSharedKeyAuthenticator?.privateKey
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
      unhashed: Object.values(label.data)[0]
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
    const labelsFilter = this.buildLabelsFilter().pagination(paginationOpts).toFilters()
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
    const labelsFilter = this.buildLabelsFilter().events(policyIds).pagination(paginationOpts).toFilters();
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
    const labelsFilter = this.buildLabelsFilter().ids(labelIds).pagination(paginationOpts).toFilters();
    await this._getLabels(labelsFilter);
    return store.getMany(labelIds, "label_id");
  }

  /**
   * Asynchronously retrieves a label given its label data.
   *
   * @async
   * @param {string} labelData - The label data (could be an address a trxid, etc).
   * @returns {Promise<SmartVaultsTypes.PublishedLabel>} - 
   * A promise that resolves to a PublishedLabel.
   *
   * @example
   * const labels = await getLabelByLabelData("trxid");
   */
  async getLabelByLabelData(labelData: string): Promise<SmartVaultsTypes.PublishedLabel> {
    await this.getLabels()
    const store = this.getStore(SmartVaultsKind.Labels);
    const label: SmartVaultsTypes.PublishedLabel | undefined = store.get(labelData, "labelData");
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
    const contactsFilter = filterBuilder()
      .kinds(Kind.Contacts)
      .authors(pubKey)
      .toFilters()
    const contactsEvents = await this.nostrClient.list(contactsFilter)
    if (contactsEvents.length === 0) return 0
    const contactsEvent = contactsEvents[0]
    const contactsPubkeys: string[] = getTagValues(contactsEvent, TagType.PubKey)
    const sharedSigners = await this.getSharedSigners(contactsPubkeys)
    if (sharedSigners.length === 0) return 0
    const sharedSignerPubkeys = sharedSigners.map(({ ownerPubKey }) => ownerPubKey)
    // remove duplicates
    const uniqueSharedSigners = new Set(sharedSignerPubkeys)
    return uniqueSharedSigners.size
  }

}
