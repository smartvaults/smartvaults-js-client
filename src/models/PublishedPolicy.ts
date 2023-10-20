import { Authenticator } from '@smontero/nostr-ual'
import { Event } from 'nostr-tools'
import { Balance } from './Balance'
import { BaseOwnedSigner, PolicyPathSelector, Trx, Policy, FinalizeTrxResponse, BasicTrxDetails, TrxDetails, Utxo, PolicyPathsResult, LabeledTrxDetails, UndecoratedBasicTrxDetails } from './types'
import { BitcoinUtil, Wallet } from './interfaces'
import { CurrencyUtil, PaginationOpts, TimeUtil, fromNostrDate, toPublished } from '../util'
import { generateUiMetadata, UIMetadata, Key } from '../util/GenerateUiMetadata'
import { LabeledUtxo, PublishedLabel, PublishedOwnedSigner, PublishedProofOfReserveProposal, PublishedSharedSigner, PublishedSpendingProposal } from '../types'
import { type Store } from '../service'
import { StringUtil } from '../util'
import { type BitcoinExchangeRate } from '../util'
export class PublishedPolicy {
  id: string
  name: string
  description: string
  descriptor: string
  createdAt: Date
  sharedKeyAuth: Authenticator
  nostrPublicKeys: string[]
  lastSyncTime?: Date
  generatedUiMetadata?: UIMetadata
  vaultData?: string
  bitcoinExchangeRate: BitcoinExchangeRate
  private wallet: Wallet
  private syncTimeGap: number
  private syncPromise?: Promise<void>
  private getSharedSigners: (publicKeys?: string | string[]) => Promise<PublishedSharedSigner[]>
  private getOwnedSigners: () => Promise<PublishedOwnedSigner[]>
  private toMiniscript: (descriptor: string) => string
  private getProposalsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, (PublishedSpendingProposal | PublishedProofOfReserveProposal) | Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>>>
  private getLabelsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, PublishedLabel | Array<PublishedLabel>>>
  private labelStore: Store

  static fromPolicyAndEvent<K extends number>({
    policyContent,
    policyEvent,
    bitcoinUtil,
    nostrPublicKeys,
    sharedKeyAuth,
  }:
    {
      policyContent: Policy,
      policyEvent: Event<K>,
      bitcoinUtil: BitcoinUtil,
      nostrPublicKeys: string[],
      sharedKeyAuth: Authenticator
    },
    getSharedSigners: (publicKeys?: string | string[]) => Promise<PublishedSharedSigner[]>,
    getOwnedSigners: () => Promise<PublishedOwnedSigner[]>,
    getProposalsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, (PublishedSpendingProposal | PublishedProofOfReserveProposal) | Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>>>,
    getLabelsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, PublishedLabel | Array<PublishedLabel>>>,
    labelStore: Store
  )

    : PublishedPolicy {
    return new PublishedPolicy(
      toPublished(policyContent, policyEvent),
      bitcoinUtil,
      nostrPublicKeys,
      sharedKeyAuth,
      getSharedSigners,
      getOwnedSigners,
      getProposalsByPolicyId,
      getLabelsByPolicyId,
      labelStore
    )
  }

  constructor({
    id,
    name,
    description,
    descriptor,
    createdAt,
  }: {
    id: string
    name: string
    description: string
    descriptor: string
    createdAt: Date
  },
    bitcoinUtil: BitcoinUtil,
    nostrPublicKeys: string[],
    sharedKeyAuth: Authenticator,
    getSharedSigners: (publicKeys?: string | string[]) => Promise<PublishedSharedSigner[]>,
    getOwnedSigners: () => Promise<PublishedOwnedSigner[]>,
    getProposalsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, (PublishedSpendingProposal | PublishedProofOfReserveProposal) | Array<PublishedSpendingProposal | PublishedProofOfReserveProposal>>>,
    getLabelsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, PublishedLabel | Array<PublishedLabel>>>,
    labelStore: Store,

  ) {
    this.id = id
    this.name = name
    this.description = description
    this.descriptor = descriptor
    this.createdAt = createdAt
    this.nostrPublicKeys = nostrPublicKeys
    this.syncTimeGap = bitcoinUtil.walletSyncTimeGap
    this.sharedKeyAuth = sharedKeyAuth
    this.wallet = bitcoinUtil.createWallet(descriptor)
    this.getSharedSigners = getSharedSigners
    this.getOwnedSigners = getOwnedSigners
    this.toMiniscript = bitcoinUtil.toMiniscript
    this.getProposalsByPolicyId = getProposalsByPolicyId
    this.getLabelsByPolicyId = getLabelsByPolicyId
    this.labelStore = labelStore
    this.bitcoinExchangeRate = bitcoinUtil.bitcoinExchangeRate
  }

  async getUiMetadata(): Promise<UIMetadata> {
    if (this.generatedUiMetadata) {
      return this.generatedUiMetadata;
    }
    const filter = this.getFilter();
    const filteredOwnedSigners = this.filterSigners(await this.getOwnedSigners(), filter) as Array<PublishedOwnedSigner>;
    const filteredSharedSigners = this.filterSigners(await this.getSharedSigners(this.nostrPublicKeys), filter) as Array<PublishedSharedSigner>;
    const uniqueSigners = this.removeDuplicates([...filteredSharedSigners, ...filteredOwnedSigners]);
    const keys = this.getKeys(uniqueSigners);

    return this.getUiMetadataFromDescriptor(filteredOwnedSigners, keys);
  }

  private getFilter(): string {
    return this.wallet.network() === 'testnet' ? 'tpub' : 'xpub';
  }

  private filterSigners(signers: Array<PublishedOwnedSigner> | Array<PublishedSharedSigner>, filter: string): Array<PublishedOwnedSigner> | Array<PublishedSharedSigner> {
    return signers.filter(signer => signer.descriptor.includes(filter));
  }

  private getKeys(signers: Array<PublishedSharedSigner>): Array<Key> {
    const filteredSigners = this.nostrPublicKeys.length > 0 ? signers.filter(signer => this.nostrPublicKeys.includes(signer.ownerPubKey!)) : signers;
    return filteredSigners.map(signer => ({
      pubkey: signer.ownerPubKey!,
      fingerprint: signer.fingerprint,
      descriptor: signer.descriptor
    }))
  }

  private getUiMetadataFromDescriptor(ownedSigners: Array<PublishedOwnedSigner>, keys: Array<Key>): UIMetadata {
    let uiMetadata = generateUiMetadata(this.descriptor, ownedSigners, this.toMiniscript);
    const keysWithOutPubkeys = uiMetadata.keys
    const keysWithPubkeys = keysWithOutPubkeys.map(key => {
      const keyWithPubkey = keys.find(k => k.fingerprint === key.fingerprint)
      if (keyWithPubkey) {
        return { ...key, pubkey: keyWithPubkey.pubkey }
      }
      return key
    }
    )
    uiMetadata.keys = keysWithPubkeys
    this.generatedUiMetadata = uiMetadata;
    return uiMetadata;
  }

  sync(): Promise<void> {
    if (!this.syncPromise) {
      this.syncPromise = this.wallet.sync()
      this.syncPromise
        .then(() => this.lastSyncTime = new Date())
        .finally(() => this.syncPromise = undefined)
    }
    return this.syncPromise
  }

  async getBalance(): Promise<Balance> {
    let balance = (await this.synced()).get_balance()
    let bitcoinExchangeRate: number | undefined;
    try {
      bitcoinExchangeRate = await this.bitcoinExchangeRate.getExchangeRate();
    } catch (error) {
      console.warn(`Failed to fetch exchange rate for ${error}`);
    }
    return new Balance(balance, bitcoinExchangeRate)
  }


  async getNewAddress(): Promise<string> {
    return (await this.synced()).get_new_address()
  }

  getPolicy(): Map<string, any> {
    return this.wallet.get_policy()
  }

  async buildTrx({
    address,
    amount,
    feeRate,
    policyPath,
    utxos,
    frozenUtxos
  }: {
    address: string,
    amount: string,
    feeRate: string,
    policyPath?: Map<string, Array<number>>,
    utxos?: Array<string>,
    frozenUtxos?: Array<string>
  }): Promise<Trx> {
    return (await this.synced()).build_trx(address, amount, feeRate, policyPath, utxos, frozenUtxos)
  }

  async finalizeTrx(psbts: string[], broadcast: boolean): Promise<FinalizeTrxResponse> {
    return this.wallet.finalize_trx(psbts, broadcast)
  }

  async getTrxs(): Promise<Array<BasicTrxDetails>> {
    const trxs = await (await this.synced()).get_trxs()
    const exchangeRate = await this.bitcoinExchangeRate.getExchangeRate();
    let decoratedTrxs: Array<BasicTrxDetails> = trxs.map((trx: UndecoratedBasicTrxDetails) => this.decorateTrxDetails(trx, exchangeRate))
    return decoratedTrxs
  }

  async getTrx(txid: string): Promise<TrxDetails> {
    const trx = await (await this.synced()).get_trx(txid)
    const exchangeRate = await this.bitcoinExchangeRate.getExchangeRate();
    return this.decorateTrxDetails(trx, exchangeRate)
  }

  async getUtxos(): Promise<Array<Utxo>> {
    return (await this.synced()).get_utxos()
  }

  getPolicyPathFromSigner(signer: BaseOwnedSigner): PolicyPathSelector | null {
    return this.wallet.get_policy_path_from_signer(signer)
  }

  async getPolicyPathsFromSigners(): Promise<PolicyPathsResult | null> {
    const signers = await this.getOwnedSigners()
    const result = this.wallet.get_policy_paths_from_signers(signers)
    if (StringUtil.isString(result)) {
      return { none: true }
    }
    return result
  }

  searchUsedSigners(signers: Array<BaseOwnedSigner>): Array<BaseOwnedSigner> {
    return this.wallet.search_used_signers(signers)
  }

  hasTimelock(): boolean {
    return this.wallet.has_timelock()
  }

  async getLabeledUtxos(): Promise<Array<LabeledUtxo>> {
    let utxos: Array<Utxo> = [];
    try {
      [utxos] = await Promise.all([
        this.getUtxos(),
        this.getLabelsByPolicyId(this.id, {})
      ]);
    } catch (error) {
      console.error("An error occurred:", error);
      return [];
    }
    const indexKey = "unhashed";
    const frozenUtxos = await this.getFrozenUtxosOutpoints();

    const maybeLabeledUtxos: Array<LabeledUtxo> = utxos.map(utxo => {
      const label: PublishedLabel | undefined = this.labelStore.get(utxo.address, indexKey) || this.labelStore.get(utxo.utxo.outpoint, indexKey);
      const frozen = frozenUtxos.includes(utxo.utxo.outpoint) ? true : false;
      if (label) {
        return { ...utxo, labelText: label.label.text, labelId: label.label_id, frozen };
      }
      return { ...utxo, frozen };
    });

    return maybeLabeledUtxos;
  }

  async getFrozenUtxosOutpoints(): Promise<string[]> {
    const policyId = this.id;
    const proposal = (await this.getProposalsByPolicyId(policyId, {})).get(policyId) as Array<PublishedSpendingProposal> || [];
    const proposals = Array.isArray(proposal) ? proposal : [proposal];
    const utxos = proposals.flatMap(proposal => proposal.utxos);
    return utxos;
  }

  async getUtxosOutpoints(): Promise<string[]> {
    const utxos = await this.getUtxos() || [];
    const utxosOutpoints = utxos.map(utxo => utxo.utxo.outpoint);
    return utxosOutpoints;
  }

  async getFrozenBalance(): Promise<number> {
    const utxos = await this.getLabeledUtxos();
    const frozenUtxos = utxos.filter(utxo => utxo.frozen);
    const frozenBalance = frozenUtxos.reduce((accumulator, current) => accumulator + current.utxo.txout.value, 0);
    return frozenBalance;
  }

  getVaultData(): string {
    if (this.vaultData) {
      return this.vaultData
    }
    const vaultData = {
      description: this.description,
      descriptor: this.descriptor,
      name: this.name,
      publicKeys: this.nostrPublicKeys,
    }
    try {
      const vaultDataJSON = JSON.stringify(vaultData, null, 2)
      this.vaultData = vaultDataJSON
      return vaultDataJSON
    } catch (error) {
      throw new Error(`Error while parsing vault data: ${error}`)
    }
  }

  async getLabeledTransactions(): Promise<Array<LabeledTrxDetails>> {
    let trxs: Array<BasicTrxDetails> = [];
    try {
      [trxs] = await Promise.all([
        this.getTrxs(),
        this.getLabelsByPolicyId(this.id, {})
      ]);
    } catch (error) {
      console.error("Error while fetching labeled transactions:", error);
      return [];
    }
    const indexKey = "unhashed";

    const maybeLabeledTrxs: Array<LabeledTrxDetails> = trxs.map(trx => {
      const label: PublishedLabel | undefined = this.labelStore.get(trx.txid, indexKey);
      if (label) {
        return { ...trx, labelText: label.label.text, labelId: label.label_id };
      }
      return trx;
    });

    return maybeLabeledTrxs;
  }

  private decorateTrxDetails = (trxDetails: any, exchangeRate?: number): any => {
    trxDetails.net = trxDetails.received - trxDetails.sent
    if (exchangeRate) {
      const bitcoin = CurrencyUtil.fromSatsToBitcoin(trxDetails.net)
      const fiat = bitcoin * exchangeRate
      trxDetails.netFiat = CurrencyUtil.toRoundedFloat(fiat)
    }
    if (trxDetails.confirmation_time) {
      trxDetails.confirmation_time.confirmedAt = fromNostrDate(trxDetails.confirmation_time.timestamp)
    }
    if (trxDetails.unconfirmed_last_seen != null) {
      trxDetails.unconfirmedLastSeenAt = fromNostrDate(trxDetails.unconfirmed_last_seen)
    }
    return trxDetails
  }

  private async synced(): Promise<Wallet> {
    if (this.requiresSync()) {
      await this.sync()
    }
    return this.wallet
  }

  private requiresSync(): boolean {
    return !this.lastSyncTime || this.lastSyncTime < TimeUtil.addMinutes(-1 * this.syncTimeGap)
  }

  private removeDuplicates(arr: any[]): any[] {
    return arr.reduce((accumulator: any[], current: any) => {
      const isDuplicate = accumulator.some(item =>
        item.pubkey === current.pubkey &&
        item.fingerprint === current.fingerprint &&
        item.descriptor === current.descriptor
      );

      if (!isDuplicate) {
        accumulator.push(current);
      }
      return accumulator;
    }, []);
  }

}
