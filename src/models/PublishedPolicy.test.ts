import sleep from 'await-sleep'
import { Event } from 'nostr-tools'
import { mock, MockProxy } from 'jest-mock-extended'
import { BitcoinUtil, Wallet } from './interfaces'
import { PublishedPolicy } from './PublishedPolicy'
import { Policy } from './types'
import { CoinstrKind } from '../enum'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Keys } from '../service'
import { fromNostrDate } from '../util'

describe('PublishedPolicy', () => {
  let policyContent: Policy
  let policyEvent: Event<CoinstrKind.Policy>
  let bitcoinUtil: MockProxy<BitcoinUtil>
  let wallet: MockProxy<Wallet>
  let nostrPublicKeys: string[]
  let sharedKeyAuth: DirectPrivateKeyAuthenticator
  let policy: PublishedPolicy

  beforeEach(() => {
    policyContent = {
      description: "desc",
      descriptor: "descriptor",
      name: "name1",
      uiMetadata: { p1: 'p1' }
    }

    policyEvent = {
      id: 'id1',
      content: 'content',
      kind: CoinstrKind.Policy,
      pubkey: "pubkey1",
      sig: "sig",
      tags: [],
      created_at: Date.now()
    }
    bitcoinUtil = mock<BitcoinUtil>()
    wallet = mock<Wallet>()
    bitcoinUtil.createWallet.mockReturnValue(wallet)
    nostrPublicKeys = ["pub1", "pub2"]
    sharedKeyAuth = new DirectPrivateKeyAuthenticator(new Keys().privateKey)
    policy = PublishedPolicy.fromPolicyAndEvent({
      policyContent,
      policyEvent,
      bitcoinUtil,
      nostrPublicKeys,
      sharedKeyAuth
    })
  })

  describe('fromPolicyAndEvent', () => {

    it('it should properly initialize the published policy', () => {

      expect(policy.id).toBe(policyEvent.id)
      expect(policy.name).toBe(policyContent.name)
      expect(policy.description).toBe(policyContent.description)
      expect(policy.descriptor).toBe(policyContent.descriptor)
      expect(policy.uiMetadata).toEqual(policyContent.uiMetadata)
      expect(policy.createdAt).toEqual(fromNostrDate(policyEvent.created_at))
      expect(policy.sharedKeyAuth).toEqual(sharedKeyAuth)
      expect(policy.nostrPublicKeys).toEqual(nostrPublicKeys)
      expect(bitcoinUtil.createWallet).toHaveBeenCalledWith(policyContent.descriptor)
    })
  })

  describe('sync', () => {

    it('should call wallet sync again if there is one in progress', async () => {
      wallet.sync.mockResolvedValue()
      const promise1 = policy.sync()
      let promise2 = policy.sync()
      expect(wallet.sync).toBeCalledTimes(1)
      expect(promise1 === promise2).toBe(true)
      await sleep(1)
      promise2 = policy.sync()
      expect(wallet.sync).toBeCalledTimes(2)
      expect(promise1 === promise2).toBe(false)
    })
  })

  describe('get balance', () => {

    it('should return correct balance', async () => {
      wallet.sync.mockResolvedValue()
      wallet.get_balance.mockReturnValue({
        confirmed: 1000,
        immature: 2000,
        trusted_pending: 4000,
        untrusted_pending: 340
      })
      let totalBalance = (await policy.getBalance()).totalBalance()
      expect(totalBalance).toBe(7340)
      expect(wallet.sync).toBeCalledTimes(1)
    })
  })
})

