import { Authenticator } from '@smontero/nostr-ual'
import { Event } from 'nostr-tools'
import { Balance } from './Balance'
import { BaseOwnedSigner, PolicyPathSelector, Trx, Policy, FinalizeTrxResponse, BasicTrxDetails, TrxDetails, Utxo, PolicyPathsResult, LabeledTrxDetails, UndecoratedBasicTrxDetails, UndecoratedTrxDetails, DatePeriod } from './types'
import { BitcoinUtil, Wallet } from './interfaces'
import { CurrencyUtil, PaginationOpts, TimeUtil, fromNostrDate, toPublished } from '../util'
import { generateUiMetadata, UIMetadata, Key } from '../util/GenerateUiMetadata'
import { LabeledUtxo, PublishedLabel, PublishedOwnedSigner, PublishedSharedSigner, PublishedSpendingProposal, ActivePublishedProposal } from '../types'
import { type Store } from '../service'
import { StringUtil } from '../util'
import { BitcoinExchangeRate } from '../util'
import { generateCsv, saveFile } from '../util'
import { AccountingMethod } from '../enum'
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
  bitcoinExchangeRate: BitcoinExchangeRate = BitcoinExchangeRate.getInstance();
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
      decoratedTrxDetails.confirmation_time.confirmedAt = date;
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


  async getAugmentedTransactions(method: AccountingMethod, period?: DatePeriod, costBasisProceedsMap?: Map<string, number>): Promise<Array<LabeledTrxDetails>> {

    if (method === AccountingMethod.ACTUAL) {
      return await this.getActualAugmentedTransactions(period, costBasisProceedsMap);
    }

    let confirmedTrxs = (await this.getLabeledTransactions()).filter(trx => trx.confirmation_time);
    if (period) confirmedTrxs = confirmedTrxs.filter(trx => trx.confirmation_time!.timestamp >= TimeUtil.toSeconds(period!.start.getTime()) && trx.confirmation_time!.timestamp <= TimeUtil.toSeconds(period!.end.getTime()));
    const trxs = confirmedTrxs.sort((a, b) => a.confirmation_time!.timestamp - b.confirmation_time!.timestamp);
    const receivedTrxs = trxs.filter(trx => trx.net > 0);
    const spendTrxs = trxs.filter(trx => trx.net < 0);

    for (const trx of receivedTrxs) {
      const date = fromNostrDate(trx.confirmation_time!.timestamp);
      const datedExchangeRate = await this.bitcoinExchangeRate.getDatedBitcoinExchangeRate(date);
      const netFiatAtConfirmation = await this.bitcoinExchangeRate.convertToFiat([trx.net], datedExchangeRate.rate);
      if (!trx.fee) {
        trx.fee = (await this.getFee(trx.txid)).fee;
        trx.feeFiat = (await this.bitcoinExchangeRate.convertToFiat([trx.fee]))[0];
      }
      const feeFiatAtConfirmation = await this.bitcoinExchangeRate.convertToFiat([trx.fee], datedExchangeRate.rate);
      trx.netFiatAtConfirmation = netFiatAtConfirmation[0];
      trx.feeFiatAtConfirmation = feeFiatAtConfirmation[0];
      trx.btcExchangeRateAtConfirmation = CurrencyUtil.toRoundedFloat(datedExchangeRate.rate);
      trx.costBasis = costBasisProceedsMap?.has(trx.txid) ? costBasisProceedsMap.get(trx.txid)! : CurrencyUtil.toRoundedFloat(trx.netFiatAtConfirmation + trx.feeFiatAtConfirmation);
      trx.proceeds = 0
      trx.capitalGainsLoses = 0
      trx.associatedCostBasis = 'N/A';
      trx.type = 'RECEIVE'
      trx.date = date;
    }


    switch (method) {
      case AccountingMethod.HIFO:
        receivedTrxs.sort((a, b) => b.btcExchangeRateAtConfirmation! - a.btcExchangeRateAtConfirmation!);
        break;
      case AccountingMethod.FIFO:
        break; // already sorted
      case AccountingMethod.LIFO:
        receivedTrxs.sort((a, b) => b.confirmation_time!.timestamp - a.confirmation_time!.timestamp);
        break;
      default:
        throw new Error(`Accounting method ${method} not supported`);
    }

    const costBasisArr = receivedTrxs.map(trx => trx.costBasis!);

    // idx -> [original amount, remaining amount]
    let costBasisMap = new Map<number, number[]>();
    receivedTrxs.forEach((_, idx) => {
      const receivedTrx = receivedTrxs[idx];
      const amount = receivedTrx.net;
      costBasisMap.set(idx, [amount, amount]);
    });

    let currentCostBasisIdx = 0;
    for (const trx of spendTrxs) {
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
      trx.btcExchangeRateAtConfirmation = CurrencyUtil.toRoundedFloat(datedExchangeRate.rate);
      if (trx.net < 0) {
        trx.type = 'SEND'
        trx.proceeds = costBasisProceedsMap?.has(trx.txid) ? costBasisProceedsMap.get(trx.txid)! : CurrencyUtil.toRoundedFloat((trx.netFiatAtConfirmation + trx.feeFiatAtConfirmation) * -1);
        trx.costBasis = 0
        let associatedCostBasis = '';
        const currentCostBasis = costBasisArr[currentCostBasisIdx];
        const [costBasisOrginalAmount, costBasisRemainingAmount] = costBasisMap.get(currentCostBasisIdx)!;
        let bitcoinSold = Math.min(Math.abs(trx.net), costBasisRemainingAmount);
        let accBitcoinSold = bitcoinSold;
        let costBasis = CurrencyUtil.toRoundedFloat(((bitcoinSold / costBasisOrginalAmount) * currentCostBasis))
        associatedCostBasis = `${bitcoinSold}` + '@' + currentCostBasis;
        if (accBitcoinSold === costBasisRemainingAmount) {
          costBasisMap.set(currentCostBasisIdx, [costBasisOrginalAmount, 0]);
          while (accBitcoinSold < Math.abs(trx.net) && currentCostBasisIdx < costBasisArr.length - 1) {
            currentCostBasisIdx++;
            const currentCostBasis = costBasisArr[currentCostBasisIdx];
            const [costBasisOrginalAmount, costBasisRemainingAmount] = costBasisMap.get(currentCostBasisIdx)!;
            bitcoinSold = costBasisRemainingAmount + accBitcoinSold > Math.abs(trx.net) ? Math.abs(trx.net) - accBitcoinSold : costBasisRemainingAmount;
            costBasis += CurrencyUtil.toRoundedFloat(((bitcoinSold / costBasisOrginalAmount) * currentCostBasis))
            associatedCostBasis += '  ' + `${bitcoinSold}` + '@' + currentCostBasis;
            const newCostBasisRemainingAmount = costBasisRemainingAmount - bitcoinSold;
            costBasisMap.set(currentCostBasisIdx, [costBasisOrginalAmount, newCostBasisRemainingAmount]);
            accBitcoinSold += bitcoinSold;
          }
        } else {
          costBasisMap.set(currentCostBasisIdx, [costBasisOrginalAmount, costBasisRemainingAmount - bitcoinSold]);
        }
        trx.capitalGainsLoses = CurrencyUtil.toRoundedFloat(trx.proceeds - costBasis);
        trx.associatedCostBasis = associatedCostBasis;
      }
    }
    return trxs
  }



  private async getActualAugmentedTransactions(period?: DatePeriod, costBasisProceedsMap?: Map<string, number>): Promise<Array<LabeledTrxDetails>> {

    let confirmedTrxs = (await this.getLabeledTransactions()).filter(trx => trx.confirmation_time);
    if (period) confirmedTrxs = confirmedTrxs.filter(trx => trx.confirmation_time!.timestamp >= TimeUtil.toSeconds(period!.start.getTime()) && trx.confirmation_time!.timestamp <= TimeUtil.toSeconds(period!.end.getTime()));
    const trxs = confirmedTrxs.sort((a, b) => a.confirmation_time!.timestamp - b.confirmation_time!.timestamp);
    let txidCostBasisMap = new Map<string, Map<number, number>>();
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
      trx.btcExchangeRateAtConfirmation = CurrencyUtil.toRoundedFloat(datedExchangeRate.rate);
      const type = trx.net > 0 ? 'RECEIVE' : 'SEND';
      trx.type = type;
      if (trx.net > 0) {
        trx.costBasis = costBasisProceedsMap?.has(trx.txid) ? costBasisProceedsMap.get(trx.txid)! : CurrencyUtil.toRoundedFloat(trx.netFiatAtConfirmation + trx.feeFiatAtConfirmation);
        trx.proceeds = 0
        trx.capitalGainsLoses = 0
        trx.associatedCostBasis = 'N/A';
        txidCostBasisMap.set(trx.txid, new Map([[trx.costBasis, trx.net]]));
      } else if (trx.net < 0) {
        trx.proceeds = costBasisProceedsMap?.has(trx.txid) ? costBasisProceedsMap.get(trx.txid)! : CurrencyUtil.toRoundedFloat((trx.netFiatAtConfirmation + trx.feeFiatAtConfirmation) * -1);
        trx.costBasis = 0
        const trxDetails = await this.getTrx(trx.txid);
        let inputs = trxDetails.inputs

        for (const input of inputs) {
          const txid = input.txid;
          const inputTrx = await this.getTrx(txid);
          input.amount = inputTrx.received;
        }

        inputs = inputs.sort((a, b) => a.amount - b.amount); // the actual order depends on the coin selection algorithm used by the wallet (defaults to the Branch and Bound algorithm)

        let capitalGainsLoses = 0;
        let accBitcoinSold = 0;
        trx.associatedCostBasis = '';
        let count = 0;
        for (const input of inputs) {
          const inputTrxId = input.txid;
          if (txidCostBasisMap.has(inputTrxId)) {
            const costBasisBitcoinQuantityMap = txidCostBasisMap.get(inputTrxId)!;
            const currentCostBasis = costBasisBitcoinQuantityMap.keys().next().value;
            let bitcoinAmountBought = costBasisBitcoinQuantityMap.get(currentCostBasis)!;
            const inputTrx = await this.getTrx(inputTrxId);
            const inputChangeOuputAmount = inputTrx.received
            let bitcoinSold = Math.min(Math.abs(trx.net), inputChangeOuputAmount); // we either used the entire change output or a portion of it
            accBitcoinSold += bitcoinSold;
            if (accBitcoinSold > Math.abs(trx.net)) {
              bitcoinSold = bitcoinSold - (accBitcoinSold - Math.abs(trx.net));
            }
            capitalGainsLoses += ((bitcoinSold / bitcoinAmountBought) * currentCostBasis)
            const associatedCostBasisString = `${bitcoinSold}` + '@' + currentCostBasis;
            if (!trx.associatedCostBasis.includes(associatedCostBasisString)) trx.associatedCostBasis = trx.associatedCostBasis + '  ' + associatedCostBasisString;
            trx.associatedCostBasis = trx.associatedCostBasis.trim();
            if (count === inputs.length - 1) txidCostBasisMap.set(trx.txid, new Map([[currentCostBasis, bitcoinAmountBought]]));
            if (accBitcoinSold === Math.abs(trx.net)) {
              txidCostBasisMap.set(trx.txid, new Map([[currentCostBasis, bitcoinAmountBought]]));
              break; // otherwise the next input could divide by zero
            }
            count++;
          } else {
            console.log('No cost basis found for input transaction: ', inputTrxId);
          }
        }
        trx.capitalGainsLoses = CurrencyUtil.toRoundedFloat(trx.proceeds - capitalGainsLoses);
      } else {
        trx.costBasis = 0
        trx.proceeds = 0
      }
    }
    return trxs
  }

  async generateTxsCsv(method: AccountingMethod, period?: DatePeriod, costBasisProceedsMap?: Map<string, number>): Promise<string> {

    const trxs = await this.getAugmentedTransactions(method, period, costBasisProceedsMap);

    const headers = [
      'date',
      'type',
      'txid',
      'costBasis',
      'proceeds',
      'associatedCostBasis',
      'capitalGainsLoses',
      'sent',
      'received',
      'net',
      'netFiatAtConfirmation',
      'fee',
      'feeFiatAtConfirmation',
      'btcExchangeRateAtConfirmation',
      'labelText'
    ];

    const vaultData = JSON.parse(this.getVaultData());
    const vaultDataHeaders = ['Vault name:,' + vaultData.name, 'Vault description:,' + vaultData.description, 'Vault members:,' + vaultData.publicKeys];

    let csv = generateCsv(trxs, headers, vaultDataHeaders);

    const currentFiat = this.bitcoinExchangeRate.getActiveFiatCurrency().toLocaleUpperCase();

    const columnReplacements = {
      'txid': 'Transaction ID',
      'type': 'Type',
      'date': 'Date',
      'netFiatAtConfirmation': `Net at Confirmation Time (${currentFiat})`,
      'feeFiatAtConfirmation': `Fee at Confirmation Time (${currentFiat})`,
      'netFiat': `Net (${currentFiat})`,
      'feeFiat': `Fee (${currentFiat})`,
      'net': `Net (SATS)`,
      'fee': `Fee (SATS)`,
      'costBasis': `Cost Basis (${currentFiat})`,
      'proceeds': `Proceeds (${currentFiat})`,
      'capitalGainsLoses': `Capital Gains / Loses (${currentFiat})`,
      'associatedCostBasis': `Sold (SATS) @ Associated Cost Basis (${currentFiat})`,
      'labelText': 'Label',
      'received': 'Received (SATS)',
      'sent': 'Sent (SATS)',
      'btcExchangeRateAtConfirmation': `BTC Exchange Rate at Confirmation Time (${currentFiat})`
    };

    for (const [key, value] of Object.entries(columnReplacements)) {
      csv = csv.replace(key, value);
    }
    return csv;
  }

  public async downloadTransactions(method: AccountingMethod, period?: DatePeriod, costBasisProceedsMap?: Map<string, number>): Promise<void> {

    const csv = await this.generateTxsCsv(method, period, costBasisProceedsMap);
    const vaultName = this.name.replace(/\s/g, '-');
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `TXS-${vaultName}-${date}-${method}`;

    saveFile(fileName, csv, 'Text', '.csv');
  }
}