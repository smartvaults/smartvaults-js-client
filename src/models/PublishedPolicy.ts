import { Authenticator } from '@smontero/nostr-ual'
import { Event } from 'nostr-tools'
import { Balance } from './Balance'
import { Trx, Policy, FinalizeTrxResponse, BasicTrxDetails, TrxDetails } from './types'
import { BitcoinUtil, Wallet } from './interfaces'
import { TimeUtil, fromNostrDate, toPublished } from '../util'
import { generateUiMetadata, type UIMetadata } from '../util/GenerateUiMetadata'
import { PublishedOwnedSigner, PublishedSharedSigner } from '../types'

export class PublishedPolicy {
  id: string
  name: string
  description: string
  descriptor: string
  uiMetadata?: any
  createdAt: Date
  sharedKeyAuth: Authenticator
  nostrPublicKeys: string[]
  lastSyncTime?: Date
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
    uiMetadata,
    createdAt,
  }: {
    id: string
    name: string
    description: string
    descriptor: string
    uiMetadata?: any
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
    this.uiMetadata = uiMetadata
    this.createdAt = createdAt
    this.nostrPublicKeys = nostrPublicKeys
    this.syncTimeGap = bitcoinUtil.walletSyncTimeGap
    this.sharedKeyAuth = sharedKeyAuth
    this.wallet = bitcoinUtil.createWallet(descriptor)
    this.getSharedSigners = getSharedSigners
    this.getOwnedSigners = getOwnedSigners
  }

  async getUiMetadata(): Promise<UIMetadata | null> {
     if (this.uiMetadata) {
      return this.uiMetadata
     }
    const filter = this.wallet.network() === 'testnet' ? 'tpub' : 'xpub'
    const ownedSigners = await this.getOwnedSigners()
    const filteredOwnedSigners = ownedSigners.filter(signer => signer.descriptor.includes(filter))
    let uiMetadata = generateUiMetadata(this.descriptor, filteredOwnedSigners)
    if (!uiMetadata) {
      console.error('Could not generate UI metadata')
      return null
    }
    const sharedSigners = await this.getSharedSigners(this.nostrPublicKeys)
    const filteredSharedSigners = sharedSigners.filter(signer => signer.descriptor.includes(filter))
    const uniqueSigners = this.removeDuplicates(filteredSharedSigners)
    uiMetadata.keys = uniqueSigners.map(signer => ({ pubkey: signer.ownerPubKey, fingerprint: signer.fingerprint, descriptor: signer.descriptor }))
    this.uiMetadata = uiMetadata
    return uiMetadata
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