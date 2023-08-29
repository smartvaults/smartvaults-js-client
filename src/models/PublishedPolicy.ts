import { Authenticator } from '@smontero/nostr-ual'
import { Event } from 'nostr-tools'
import { Balance } from './Balance'
import { Trx, Policy, FinalizeTrxResponse, BasicTrxDetails, TrxDetails } from './types'
import { BitcoinUtil, Wallet } from './interfaces'
import { TimeUtil, fromNostrDate, toPublished } from '../util'
import { generateUiMetadata, generateBlocklyJson, UIMetadata, Key } from '../util/GenerateUiMetadata'
import { PublishedOwnedSigner, PublishedSharedSigner } from '../types'

export class PublishedPolicy {
  id: string
  name: string
  description: string
  descriptor: string
  miniscript?: string
  createdAt: Date
  sharedKeyAuth: Authenticator
  nostrPublicKeys: string[]
  lastSyncTime?: Date
  generatedUiMetadata?: UIMetadata
  private wallet: Wallet
  private syncTimeGap: number
  private syncPromise?: Promise<void>
  private getSharedSigners: (publicKeys?: string | string[]) => Promise<PublishedSharedSigner[]>
  private getOwnedSigners: () => Promise<PublishedOwnedSigner[]>


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
    getOwnedSigners: () => Promise<PublishedOwnedSigner[]>
  )

    : PublishedPolicy {
    return new PublishedPolicy(
      toPublished(policyContent, policyEvent),
      bitcoinUtil,
      nostrPublicKeys,
      sharedKeyAuth,
      getSharedSigners,
      getOwnedSigners
    )
  }

  constructor({
    id,
    name,
    description,
    descriptor,
    miniscript,
    createdAt,
  }: {
    id: string
    name: string
    description: string
    descriptor: string
    miniscript?: string
    createdAt: Date
  },
    bitcoinUtil: BitcoinUtil,
    nostrPublicKeys: string[],
    sharedKeyAuth: Authenticator,
    getSharedSigners: (publicKeys?: string | string[]) => Promise<PublishedSharedSigner[]>,
    getOwnedSigners: () => Promise<PublishedOwnedSigner[]>
  ) {
    this.id = id
    this.name = name
    this.description = description
    this.descriptor = descriptor
    this.miniscript = miniscript
    this.createdAt = createdAt
    this.nostrPublicKeys = nostrPublicKeys
    this.syncTimeGap = bitcoinUtil.walletSyncTimeGap
    this.sharedKeyAuth = sharedKeyAuth
    this.wallet = bitcoinUtil.createWallet(descriptor)
    this.getSharedSigners = getSharedSigners
    this.getOwnedSigners = getOwnedSigners
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

    if (this.miniscript) {
      return this.getUiMetadataFromMiniscript(filteredOwnedSigners, keys);
    } else {
      return this.getUiMetadataFromDescriptor(filteredOwnedSigners, keys);
    }
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

  private getUiMetadataFromMiniscript(ownedSigners: Array<PublishedOwnedSigner>, keys: Array<Key>): UIMetadata {
    if (!this.miniscript) throw new Error('Miniscript is not defined');
    const json = generateBlocklyJson(this.miniscript, ownedSigners);
    const policyCode = this.miniscript;
    const uiMetadata = { json, policyCode, keys };
    this.generatedUiMetadata = uiMetadata;
    return uiMetadata;
  }

  private getUiMetadataFromDescriptor(ownedSigners: Array<PublishedOwnedSigner>, keys: Array<Key>): UIMetadata {
    const uiMetadata = generateUiMetadata(this.descriptor, ownedSigners);
    uiMetadata.keys = keys;
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
    policyPath
  }: {
    address: string,
    amount: string,
    feeRate: string,
    policyPath?: Map<string, Array<number>>
  }): Promise<Trx> {
    return (await this.synced()).build_trx(address, amount, feeRate, policyPath)
  }

  async finalizeTrx(psbts: string[], broadcast: boolean): Promise<FinalizeTrxResponse> {
    return this.wallet.finalize_trx(psbts, broadcast)
  }

  async getTrxs(): Promise<Array<BasicTrxDetails>> {
    const trxs = (await this.synced()).get_trxs()
    return trxs.map(this.decorateTrxDetails)
  }

  async getTrx(txid: string): Promise<TrxDetails> {
    const trx = await (await this.synced()).get_trx(txid)
    return this.decorateTrxDetails(trx)
  }

  private decorateTrxDetails(trxDetails: any): any {
    trxDetails.net = trxDetails.received - trxDetails.sent
    if (trxDetails.confirmation_time) {
      trxDetails.confirmation_time.confirmedAt = fromNostrDate(trxDetails.confirmation_time.timestamp)
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