import { Authenticator } from '@smontero/nostr-ual'
import { Event } from 'nostr-tools'
import { Balance } from './Balance'
import { Trx, Policy } from './types'
import {BitcoinUtil, Wallet} from './interfaces'
import { TimeUtil, toPublished } from '../util'


export class PublishedPolicy {
  id: string
  name: string
  description: string
  descriptor: string
  uiMetadata?: any
  createdAt: Date
  sharedKeyAuth: Authenticator
  nostrPublicKeys: string[]
  private wallet: Wallet
  private syncTimeGap: number
  private lastSyncTime?: Date
  private syncPromise?: Promise<void>


  static fromPolicyAndEvent<K extends number>({
    policyContent,
    policyEvent,
    bitcoinUtil,
    nostrPublicKeys,
    sharedKeyAuth
  }:
    {
      policyContent: Policy,
      policyEvent: Event<K>,
      bitcoinUtil: BitcoinUtil,
      nostrPublicKeys: string[],
      sharedKeyAuth: Authenticator
    }): PublishedPolicy {
    return new PublishedPolicy(
      toPublished(policyContent, policyEvent),
      bitcoinUtil,
      nostrPublicKeys,
      sharedKeyAuth
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
    sharedKeyAuth: Authenticator) {
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
  }

  async sync(): Promise<void> {
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

  async getNewAddress(): Promise<String> {
    return (await this.synced()).get_new_address()
  }

  async build_trx({
    address,
    amount,
    feeRate
  }: {
    address: string,
    amount: string,
    feeRate: string
  }): Promise<Trx> {
    return (await this.synced()).build_trx(address, amount, feeRate)
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
}