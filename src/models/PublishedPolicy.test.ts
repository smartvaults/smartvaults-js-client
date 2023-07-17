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

  describe('getBalance', () => {

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

  describe('getNewAddress', () => {

    it('should return correct address', async () => {
      wallet.sync.mockResolvedValue()
      wallet.get_new_address.mockReturnValue("newaddress")
      let newAddres = await policy.getNewAddress()
      expect(newAddres).toBe("newaddress")
      expect(wallet.sync).toBeCalledTimes(1)
    })
  })

  describe('buildTrx', () => {

    it('should correctly call the build_trx method of the wallet instance', async () => {
      wallet.sync.mockResolvedValue()
      const expected = { amount: 1000, psbt: "psbt1" }
      wallet.build_trx.mockResolvedValue(expected)
      let actual = await policy.buildTrx({
        address: "address",
        amount: "1000",
        feeRate: "low"
      })
      expect(expected).toEqual(actual)
      expect(wallet.sync).toBeCalledTimes(1)
      expect(wallet.build_trx).toHaveBeenNthCalledWith(1, "address", "1000", "low")
    })
  })

  describe('finalizeTrx', () => {

    it('should correctly call the finalize_trx method of the wallet instance', async () => {
      wallet.sync.mockResolvedValue()
      const expected = { txid: "", psbt: "psbt1", trx: { inputs: ["input1"] } }
      wallet.finalize_trx.mockResolvedValue(expected)
      const psbts = ["psbt1", "psbt2"]
      let actual = await policy.finalizeTrx(psbts, true)
      expect(expected).toEqual(actual)
      expect(wallet.sync).toHaveBeenCalledTimes(0)
      expect(wallet.finalize_trx).toHaveBeenNthCalledWith(1, psbts, true)
    })
  })

  describe('getTrxs', () => {

    it('should correctly call the get_trxs method of the wallet instance and decorate the trx details', async () => {
      wallet.sync.mockResolvedValue()
      const expected = [{
        txid: "05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d",
        received: 2695,
        sent: 4000,
        fee: 305,
        confirmation_time: {
          height: 2441712,
          timestamp: 1689279109
        }
      },
      {
        txid: "c986542760cce19005b436fc45675a43819084bf37f683dae06e4816e77e8e9f",
        received: 4000,
        sent: 0,
        fee: 153,
      }]

      wallet.get_trxs.mockReturnValue([{
        txid: "05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d",
        received: 2695,
        sent: 4000,
        fee: 305,
        confirmation_time: {
          height: 2441712,
          timestamp: 1689279109
        }
      },
      {
        txid: "c986542760cce19005b436fc45675a43819084bf37f683dae06e4816e77e8e9f",
        received: 4000,
        sent: 0,
        fee: 153,
      }])
      const psbts = ["psbt1", "psbt2"]
      let actual = await policy.finalizeTrx(psbts, true)
      expect(expected).toEqual(actual)
      expect(wallet.sync).toHaveBeenCalledTimes(0)
      expect(wallet.finalize_trx).toHaveBeenNthCalledWith(1, psbts, true)
    })
  })
})

