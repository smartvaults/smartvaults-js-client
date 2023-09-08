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
import { Coinstr } from '../Coinstr'

describe('PublishedPolicy', () => {
  let policyContent: Policy
  let policyEvent: Event<CoinstrKind.Policy>
  let bitcoinUtil: MockProxy<BitcoinUtil>
  let wallet: MockProxy<Wallet>
  let nostrPublicKeys: string[]
  let sharedKeyAuth: DirectPrivateKeyAuthenticator
  let policy: PublishedPolicy

  beforeEach(() => {
    const coinstr = mock<Coinstr>()
    policyContent = {
      description: "desc",
      descriptor: "descriptor",
      name: "name1",
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
      sharedKeyAuth,
    },
      coinstr.getSharedSigners,
      coinstr.getOwnedSigners,
      coinstr.getProposalsByPolicyId,
      coinstr.getLabelsByPolicyId,
      coinstr.getStore(CoinstrKind.Labels),
    )
  })

  describe('fromPolicyAndEvent', () => {

    it('it should properly initialize the published policy', () => {

      expect(policy.id).toBe(policyEvent.id)
      expect(policy.name).toBe(policyContent.name)
      expect(policy.description).toBe(policyContent.description)
      expect(policy.descriptor).toBe(policyContent.descriptor)
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


  describe('getPolicy', () => {

    it('should return correct policy', async () => {
      wallet.sync.mockResolvedValue()
      const p = new Map<string, any>()
      p.set("id", "asdas")
      p.set("type", "Signature")
      wallet.get_policy.mockReturnValue(p)
      let expected = policy.getPolicy()
      expect(expected).toEqual(p)
      expect(wallet.sync).toBeCalledTimes(0)
    })
  })

  describe('buildTrx', () => {

    it('should correctly call the build_trx method of the wallet instance without policy path, utxos and frozen_utxos', async () => {
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
      expect(wallet.build_trx).toHaveBeenNthCalledWith(1, "address", "1000", "low", undefined, undefined, undefined)
    })

    it('should correctly call the build_trx method of the wallet instance with policy path, utxos and frozen utxos', async () => {
      wallet.sync.mockResolvedValue()
      const expected = { amount: 3000, psbt: "psbt2" }
      wallet.build_trx.mockResolvedValue(expected)
      let policyPath = new Map<string, Array<number>>()
      policyPath.set("83aswe", [1])
      let utxos = ["05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d:1", "123ce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d:2"]
      let frozenUtxos = ["15dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204g:3"]
      let actual = await policy.buildTrx({
        address: "address1",
        amount: "3000",
        feeRate: "high",
        policyPath,
        utxos,
        frozenUtxos
      })
      expect(expected).toEqual(actual)
      expect(wallet.sync).toBeCalledTimes(1)
      expect(wallet.build_trx).toHaveBeenNthCalledWith(1, "address1", "3000", "high", policyPath, utxos, frozenUtxos)
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
      const expected = [{
        txid: "05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d",
        received: 2695,
        sent: 4000,
        fee: 305,
        net: -1305,
        confirmation_time: {
          height: 2441712,
          timestamp: 1689279109,
          confirmedAt: new Date(1689279109 * 1000)
        }
      },
      {
        txid: "c986542760cce19005b436fc45675a43819084bf37f683dae06e4816e77e8e9f",
        received: 4000,
        sent: 0,
        fee: 153,
        net: 4000
      }]
      let actual = await policy.getTrxs()
      expect(expected).toEqual(actual)
      expect(wallet.sync).toHaveBeenCalledTimes(1)
      expect(wallet.get_trxs).toHaveBeenCalledTimes(1)
    })
  })

  describe('getTrx', () => {

    it('should correctly call the get_trx method of the wallet instance and decorate the trx details', async () => {
      wallet.sync.mockResolvedValue()
      wallet.get_trx.mockResolvedValue({
        txid: "05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d",
        inputs: [
          {
            txid: "5b5a1db10af26adc77912e2db053489df2f82ec4a5836ee722b5f2feabbdccba",
            amount: 0
          }
        ],
        outputs: [
          {
            txid: "tb1pjs8ul94z5lwyfgtcd6xlvkjhrh4zu5ddj9ahn65ztsvvl3dxlh6qth0sua",
            amount: 4000
          },
          {
            txid: "tb1q0fcr4qa3p3l0hswk3mr4zkqmzs2x209kqpqvtx",
            amount: 1876061
          }
        ],
        lock_time: 2441704,
        received: 2695,
        sent: 4000,
        fee: 305,
        confirmation_time: {
          height: 2441712,
          timestamp: 1689279109,
          confirmations: 110
        }
      })
      const expected = {
        txid: "05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d",
        received: 2695,
        sent: 4000,
        fee: 305,
        net: -1305,
        inputs: [
          {
            txid: "5b5a1db10af26adc77912e2db053489df2f82ec4a5836ee722b5f2feabbdccba",
            amount: 0
          }
        ],
        outputs: [
          {
            txid: "tb1pjs8ul94z5lwyfgtcd6xlvkjhrh4zu5ddj9ahn65ztsvvl3dxlh6qth0sua",
            amount: 4000
          },
          {
            txid: "tb1q0fcr4qa3p3l0hswk3mr4zkqmzs2x209kqpqvtx",
            amount: 1876061
          }
        ],
        lock_time: 2441704,
        confirmation_time: {
          height: 2441712,
          timestamp: 1689279109,
          confirmedAt: new Date(1689279109 * 1000),
          confirmations: 110
        }
      }
      const txid = "05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d"
      let actual = await policy.getTrx(txid)
      expect(expected).toEqual(actual)
      expect(wallet.sync).toHaveBeenCalledTimes(1)
      expect(wallet.get_trx).toHaveBeenCalledWith(txid)
    })
  })

  describe('getUtxos', () => {

    it('should correctly call the get_utxos method of the wallet instance', async () => {
      wallet.sync.mockResolvedValue()

      const expected = [{
        "utxo": {
          "outpoint": "05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d:1",
          "txout": {
            "value": 2695,
            "script_pubkey": "5120ff7855d223320ed6c3116cf89d3eef8a03ffb9ed68002724f6d9be537efefa2d"
          },
          "keychain": "External",
          "is_spent": false
        },
        "address": "tb1plau9t53rxg8ddsc3dnuf60h03gpllw0ddqqzwf8kmxl9xlh7lgks7dfexg"
      }]
      wallet.get_utxos.mockReturnValue(expected)
      let actual = await policy.getUtxos()
      expect(expected).toEqual(actual)
      expect(wallet.sync).toHaveBeenCalledTimes(1)
      expect(wallet.get_utxos).toHaveBeenCalledTimes(1)
    })
  })
})

