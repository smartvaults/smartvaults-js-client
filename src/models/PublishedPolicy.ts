import { Authenticator } from '@smontero/nostr-ual'
import { Event } from 'nostr-tools'
import { Balance } from './Balance'
import { BaseOwnedSigner, PolicyPathSelector, Trx, Policy, FinalizeTrxResponse, BasicTrxDetails, TrxDetails, Utxo, PolicyPathsResult, LabeledTrxDetails, UndecoratedBasicTrxDetails, UndecoratedTrxDetails } from './types'
import { BitcoinUtil, Wallet } from './interfaces'
import { PaginationOpts, TimeUtil, fromNostrDate, toPublished } from '../util'
import { generateUiMetadata, UIMetadata, Key } from '../util/GenerateUiMetadata'
import { LabeledUtxo, PublishedLabel, PublishedOwnedSigner, PublishedSharedSigner, PublishedSpendingProposal, ActivePublishedProposal } from '../types'
import { type Store } from '../service'
import { StringUtil } from '../util'
import { BitcoinExchangeRate } from '../util'
import { generateCsv, saveFile } from '../util'
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
  private readonly bitcoinExchangeRate: BitcoinExchangeRate = BitcoinExchangeRate.getInstance();
  private wallet: Wallet
  private syncTimeGap: number
  private syncPromise?: Promise<void>
  private getSharedSigners: (publicKeys?: string | string[]) => Promise<PublishedSharedSigner[]>
  private getOwnedSigners: () => Promise<PublishedOwnedSigner[]>
  private toMiniscript: (descriptor: string) => string
  private getProposalsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, ActivePublishedProposal | Array<ActivePublishedProposal>>>
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
    getProposalsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, ActivePublishedProposal | Array<ActivePublishedProposal>>>,
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
    getProposalsByPolicyId: (policy_ids: string[] | string, paginationOpts: PaginationOpts) => Promise<Map<string, ActivePublishedProposal | Array<ActivePublishedProposal>>>,
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
    return new Balance(balance)
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
    const decoratedTrxPromises: Promise<BasicTrxDetails>[] = trxs.map((trx: UndecoratedBasicTrxDetails) => this.decorateTrxDetails(trx, exchangeRate));
    const decoratedTrxs: Array<BasicTrxDetails> = await Promise.all(decoratedTrxPromises);
    return decoratedTrxs
  }

  async getTrx(txid: string): Promise<TrxDetails> {
    const trx = await (await this.synced()).get_trx(txid)
    const exchangeRate = await this.bitcoinExchangeRate.getExchangeRate();
    const decoratedTrx = await this.decorateTrxDetails(trx, exchangeRate) as TrxDetails;
    return decoratedTrx
  }

  async getFee(txid: string): Promise<{ fee: number }> {
    return await (await this.synced()).get_fee(txid)
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
      console.error("An error occurred while getting labeled utxos:", error);
      return [];
    }
    const indexKey = "labelData";
    const frozenUtxos = await this.getFrozenUtxosOutpoints();
    const exchangeRate = await this.bitcoinExchangeRate.getExchangeRate();
    if (exchangeRate) {
      const values = utxos.map(utxo => utxo.utxo.txout.value);
      const valuesFiat = await this.bitcoinExchangeRate.convertToFiat(values, exchangeRate);
      utxos.forEach((utxo, index) => {
        utxo.utxo.txout.valueFiat = valuesFiat[index];
      });
    }
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

  async getFrozenBalance(): Promise<{ frozen: number, frozenFiat?: number }> {
    const [utxos, exchangeRate] = await Promise.all([
      this.getLabeledUtxos(),
      this.bitcoinExchangeRate.getExchangeRate()
    ]);
    const frozenUtxos = utxos.filter(utxo => utxo.frozen);
    const frozenBalance = frozenUtxos.reduce((accumulator, current) => accumulator + current.utxo.txout.value, 0);
    if (exchangeRate) {
      const [frozenBalanceFiat] = await this.bitcoinExchangeRate.convertToFiat([frozenBalance], exchangeRate);
      return { frozen: frozenBalance, frozenFiat: frozenBalanceFiat };
    }
    return { frozen: frozenBalance };
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
    const indexKey = "labelData";

    const maybeLabeledTrxs: Array<LabeledTrxDetails> = trxs.map(trx => {
      const label: PublishedLabel | undefined = this.labelStore.get(trx.txid, indexKey);
      if (label) {
        return { ...trx, labelText: label.label.text, labelId: label.label_id };
      }
      return trx;
    });

    return maybeLabeledTrxs;
  }

  private decorateTrxDetails = async (trxDetails: UndecoratedBasicTrxDetails | UndecoratedTrxDetails, exchangeRate?: number): Promise<BasicTrxDetails | TrxDetails> => {
    const isExtendedTrxDetails = 'lock_time' in trxDetails && trxDetails.lock_time !== undefined;
    const decoratedTrxDetails: any = { ...trxDetails };
    decoratedTrxDetails.net = trxDetails.received - trxDetails.sent;

    if (exchangeRate) {
      const commonValuesToConvert = [
        decoratedTrxDetails.net,
        trxDetails.sent,
        trxDetails.received,
        trxDetails.fee
      ];

      const additionalValuesToConvert = isExtendedTrxDetails ? [
        ...trxDetails.inputs.map(input => input.amount),
        ...trxDetails.outputs.map(output => output.amount)
      ] : [];

      const valuesToConvert = [...commonValuesToConvert, ...additionalValuesToConvert];
      const convertedValues = await this.bitcoinExchangeRate.convertToFiat(valuesToConvert, exchangeRate);

      const [netFiat, sentFiat, receivedFiat, feeFiat, ...inputOutputFiat] = convertedValues;

      decoratedTrxDetails.netFiat = netFiat;
      decoratedTrxDetails.sentFiat = sentFiat;
      decoratedTrxDetails.receivedFiat = receivedFiat;
      decoratedTrxDetails.feeFiat = feeFiat;

      if (isExtendedTrxDetails) {
        const inputFiat = inputOutputFiat.slice(0, trxDetails.inputs.length);
        const outputFiat = inputOutputFiat.slice(trxDetails.inputs.length);

        decoratedTrxDetails.inputs = trxDetails.inputs.map((input, idx) => ({ ...input, amountFiat: inputFiat[idx] }));
        decoratedTrxDetails.outputs = trxDetails.outputs.map((output, idx) => ({ ...output, amountFiat: outputFiat[idx] }));
      }
    }

    if (trxDetails.confirmation_time) {
      const date = fromNostrDate(trxDetails.confirmation_time.timestamp);
      const datedExchangeRate = await this.bitcoinExchangeRate.getDatedBitcoinExchangeRate(date);
      decoratedTrxDetails.confirmation_time.confirmedAt = date;
      const netFiatAtConfirmation = await this.bitcoinExchangeRate.convertToFiat([decoratedTrxDetails.net], datedExchangeRate.rate);
      const feeFiatAtConfirmation = await this.bitcoinExchangeRate.convertToFiat([decoratedTrxDetails.fee], datedExchangeRate.rate);
      decoratedTrxDetails.netFiatAtConfirmation = netFiatAtConfirmation[0];
      decoratedTrxDetails.feeFiatAtConfirmation = feeFiatAtConfirmation[0];
    }

    if (trxDetails.unconfirmed_last_seen != null) {
      decoratedTrxDetails.unconfirmedLastSeenAt = fromNostrDate(trxDetails.unconfirmed_last_seen);
    }

    return decoratedTrxDetails;
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


  public async downloadTransactions(): Promise<void> {
    const confirmedTrxs = (await this.getLabeledTransactions()).filter(trx => trx.confirmation_time);
    const trxs = confirmedTrxs.sort((a, b) => a.confirmation_time!.timestamp - b.confirmation_time!.timestamp);
    let acc = 0;
    for (const trx of trxs) {
      const date = fromNostrDate(trx.confirmation_time!.timestamp);
      const datedExchangeRate = await this.bitcoinExchangeRate.getDatedBitcoinExchangeRate(date);

      trx.date = date;
      const netFiatAtConfirmation = await this.bitcoinExchangeRate.convertToFiat([trx.net], datedExchangeRate.rate);
      if (!trx.fee) {
        trx.fee = (await this.getFee(trx.txid)).fee;
        trx.feeFiat = (await this.bitcoinExchangeRate.convertToFiat([trx.fee]))[0];
      }
      const feeFiatAtConfirmation = await this.bitcoinExchangeRate.convertToFiat([trx.fee], datedExchangeRate.rate);
      trx.netFiatAtConfirmation = netFiatAtConfirmation[0];
      trx.feeFiatAtConfirmation = feeFiatAtConfirmation[0];
      const type = trx.net > 0 ? 'RECEIVE' : 'SEND';
      trx.type = type;
      if (trx.net > 0) {
        trx.costBasis = trx.netFiatAtConfirmation + trx.feeFiatAtConfirmation;
        trx.proceeds = 0
        trx.cumulativeCapitalGains = acc + trx.costBasis * -1;
        acc = trx.cumulativeCapitalGains;
      } else if (trx.net < 0) {
        trx.proceeds = (trx.netFiatAtConfirmation + trx.feeFiatAtConfirmation) * -1;
        trx.costBasis = 0
        trx.cumulativeCapitalGains = acc + trx.proceeds;
        acc = trx.cumulativeCapitalGains;
      } else {
        trx.costBasis = 0
        trx.proceeds = 0
      }
    }

    const headers = [
      'date',
      'type',
      'txid',
      'costBasis',
      'proceeds',
      'cumulativeCapitalGains',
      'sent',
      'received',
      'net',
      'netFiat',
      'netFiatAtConfirmation',
      'fee',
      'feeFiat',
      'feeFiatAtConfirmation',
      'label'
    ];

    let csv = generateCsv(trxs, headers);
    const currentFiat = this.bitcoinExchangeRate.getActiveFiatCurrency().toLocaleUpperCase();

    const columnReplacements = {
      'txid': 'Transaction ID',
      'type': 'Type',
      'date': 'Date',
      'net': `Net (SATS)`,
      'netFiat': `Net (${currentFiat})`,
      'feeFiat': `Fee (${currentFiat})`,
      'netFiatAtConfirmation': `Net at confirmation (${currentFiat})`,
      'feeFiatAtConfirmation': `Fee at confirmation (${currentFiat})`,
      'costBasis': `Cost Basis (${currentFiat})`,
      'proceeds': `Proceeds (${currentFiat})`,
      'cumulativeCapitalGains': `Cumulative Capital Gains (${currentFiat})`
    };

    for (const [key, value] of Object.entries(columnReplacements)) {
      csv = csv.replace(new RegExp(key, 'g'), value);
    }

    saveFile('transactions', csv, 'Text', '.csv');
  }
}