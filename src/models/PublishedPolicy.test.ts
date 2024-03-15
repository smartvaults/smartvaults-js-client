import sleep from 'await-sleep'
import { Event } from 'nostr-tools'
import { mock, MockProxy } from 'jest-mock-extended'
import { BitcoinUtil, Wallet } from './interfaces'
import { PublishedPolicy } from './PublishedPolicy'
import { AugmentedTransactionDetails, Policy, TrxInput } from './types'
import { AccountingMethod, SmartVaultsKind } from '../enum'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Keys, Store } from '../service'
import { fromNostrDate } from '../util'
import { SmartVaults } from '../SmartVaults'
import { LabeledUtxo, PublishedOwnedSigner } from '../types'

describe('PublishedPolicy', () => {
  let policyContent: Policy
  let policyEvent: Event<SmartVaultsKind.Policy>
  let bitcoinUtil: MockProxy<BitcoinUtil>
  let wallet: MockProxy<Wallet>
  let nostrPublicKeys: string[]
  let sharedKeyAuth: DirectPrivateKeyAuthenticator
  let policy: PublishedPolicy
  let policy2: PublishedPolicy
  let smartVaults: MockProxy<SmartVaults>

  beforeAll(() => {
    global.fetch = jest.fn().mockReturnValue(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ bitcoin: { usd: 100_000_000 } }),
    }));
  }
  )

  beforeEach(() => {
    smartVaults = mock<SmartVaults>()
    policyContent = {
      description: "desc",
      descriptor: "descriptor",
      name: "name1",
    }

    const policyContent2 = {
      description: "Vault with transactions",
      descriptor: "tr([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*,pk([b150be21/86'/1'/784923']tpubDD1ia3f2aAzNkLAWSu59muoayHdoqycw3A1YDrSY77VDRbDi7SjBRvm2aNDrrmFz9SMsPCXGB5WPMwJ9K5XduvzBvnSXHYi8BgVvE59N4Bc/0/*))#t6rh87kk",
      name: "Vault with txs",
    }

    policyEvent = {
      id: 'id1',
      content: 'content',
      kind: SmartVaultsKind.Policy,
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
      smartVaults.getSharedSigners,
      smartVaults.getOwnedSigners,
      smartVaults.getProposalsByPolicyId,
      smartVaults.getTransactionMetadataByPolicyId,
      smartVaults.saveTransactionMetadata,
      Store.createSingleIndexStore('id'),
    )
    policy2 = PublishedPolicy.fromPolicyAndEvent({
      policyContent: policyContent2,
      policyEvent,
      bitcoinUtil,
      nostrPublicKeys,
      sharedKeyAuth,
    },
      smartVaults.getSharedSigners,
      smartVaults.getOwnedSigners,
      smartVaults.getProposalsByPolicyId,
      smartVaults.getTransactionMetadataByPolicyId,
      smartVaults.saveTransactionMetadata,
      Store.createSingleIndexStore('id'),
    )
    policy.getVaultData()
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

  describe('getVaultData', () => {

    it('it should return the vault data', () => {
      const expected = JSON.stringify({ description: policy.description, descriptor: policy.descriptor, name: policy.name, publicKeys: policy.nostrPublicKeys }, null, 2)
      expect(policy.getVaultData()).toEqual(expected)
      expect(policy.vaultData).toEqual(expected)
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
      let policyPath = { "83aswe": [1] }
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
      wallet.get_trxs.mockResolvedValue([{
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
        unconfirmed_last_seen: 1689279110
      }])
      const expected = [{
        txid: "05dce7f5440ded30bd55359d9e4f65de34fefaaef5fb16ac4cfaf72375fd204d",
        received: 2695,
        receivedFiat: 2695,
        sent: 4000,
        sentFiat: 4000,
        fee: 305,
        feeFiat: 305,
        net: -1305,
        netFiat: -1305,
        confirmation_time: {
          height: 2441712,
          timestamp: 1689279109,
          confirmedAt: new Date(1689279109 * 1000)
        }
      },
      {
        txid: "c986542760cce19005b436fc45675a43819084bf37f683dae06e4816e77e8e9f",
        received: 4000,
        receivedFiat: 4000,
        sent: 0,
        sentFiat: 0,
        fee: 153,
        feeFiat: 153,
        net: 4000,
        netFiat: 4000,
        unconfirmed_last_seen: 1689279110,
        unconfirmedLastSeenAt: new Date(1689279110 * 1000)
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
        receivedFiat: 2695,
        sent: 4000,
        sentFiat: 4000,
        fee: 305,
        feeFiat: 305,
        net: -1305,
        netFiat: -1305,
        inputs: [
          {
            txid: "5b5a1db10af26adc77912e2db053489df2f82ec4a5836ee722b5f2feabbdccba",
            amount: 0,
            amountFiat: 0
          }
        ],
        outputs: [
          {
            txid: "tb1pjs8ul94z5lwyfgtcd6xlvkjhrh4zu5ddj9ahn65ztsvvl3dxlh6qth0sua",
            amount: 4000,
            amountFiat: 4000
          },
          {
            txid: "tb1q0fcr4qa3p3l0hswk3mr4zkqmzs2x209kqpqvtx",
            amount: 1876061,
            amountFiat: 1876061
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

  describe('getPolicyPathFromSigner', () => {

    it('should correctly call the get_policy_path_from_signer method of the wallet instance', async () => {
      const signer = { description: null, descriptor: "tr([f57a6b99/86'/1'/784923']tpubDC45v32EZGP2U4qVTKayC3kkdKmFAFDxxA7wnCCVgUuPXRFNms1W1LZq2LiCUBk5XmNvTZcEtbexZUMtY4ubZGS74kQftEGibUxUpybMan7/0/*)#jakwhh0u", fingerprint: 'f57a6b99', name: 'SmartVaults', t: 'Seed' }
      const expected = {
        complete: {
          path: new Map([
            [
              "fx0z8u06",
              [
                0
              ]
            ],
            [
              "y46gds64",
              [
                1
              ]
            ]
          ])
        }
      }
      wallet.get_policy_path_from_signer.mockReturnValue(expected)
      let actual = policy.getPolicyPathFromSigner(signer)
      expect(expected).toEqual(actual)
      expect(wallet.get_policy_path_from_signer).toHaveBeenNthCalledWith(1, signer)
    })
  })

  describe('getPolicyPathsFromSigners', () => {

    it('should correctly call the get_policy_paths_from_signers method of the wallet instance', async () => {
      const signer1 = { name: 'SmartVaults', description: undefined, fingerprint: 'f57a6b99', descriptor: "tr([f57a6b99/86'/1'/784923']tpubDC45v32EZGP2U4qVTK…tbexZUMtY4ubZGS74kQftEGibUxUpybMan7/0/*)#jakwhh0u", t: 'Seed', id: "1", createdAt: new Date(10000), key: "key1", ownerPubKey1: "ownerPubKey1" }
      const signer2 = { name: 'SmartVaults', description: undefined, fingerprint: 'f3ab64d8', descriptor: "tr([f3ab64d8/86'/1'/784923']tpubDCh4uyVDVretfgTNka…91gN5LYtuSCbr1Vo6mzQmD49sF2vGpReZp2/0/*)#yavh9uq5", t: 'Seed', id: "2", createdAt: new Date(10000), key: "key2", ownerPubKey: "ownerPubKey2" }
      smartVaults.getOwnedSigners.mockResolvedValue([signer1, signer2])
      const policy_paths = new Map(
        [
          [
            signer1.fingerprint, {
              complete: {
                path: new Map([
                  [
                    "fx0z8u06",
                    [
                      0
                    ]
                  ],
                  [
                    "y46gds64",
                    [
                      1
                    ]
                  ]
                ])
              }
            }
          ],
          [
            signer2.fingerprint, {
              partial: {
                missing_to_select: new Map([
                  [
                    "fx0z8u06",
                    [
                      '0e36xhlc',
                      'm4n7s285'
                    ]
                  ]
                ]),
                selected_path: new Map([
                  [
                    "y46gds64",
                    [
                      1
                    ]
                  ]
                ])
              }
            }
          ]
        ]
      )
      const expected = {
        multiple: policy_paths
      }
      wallet.get_policy_paths_from_signers.mockReturnValue(expected)
      let signers = [signer1, signer2]
      let actual = await policy.getPolicyPathsFromSigners()
      expect(expected).toEqual(actual)
      expect(smartVaults.getOwnedSigners).toHaveBeenCalledTimes(1)
      expect(wallet.get_policy_paths_from_signers).toHaveBeenNthCalledWith(1, signers)
    })

    it('should return the correct policy path result when wallet returns string none', async () => {
      const signer1 = { name: 'SmartVaults', description: undefined, fingerprint: 'f57a6b99', descriptor: "tr([f57a6b99/86'/1'/784923']tpubDC45v32EZGP2U4qVTK…tbexZUMtY4ubZGS74kQftEGibUxUpybMan7/0/*)#jakwhh0u", t: 'Seed', id: "1", createdAt: new Date(10000), key: "key1", ownerPubKey1: "ownerPubKey1" }
      const signer2 = { name: 'SmartVaults', description: undefined, fingerprint: 'f3ab64d8', descriptor: "tr([f3ab64d8/86'/1'/784923']tpubDCh4uyVDVretfgTNka…91gN5LYtuSCbr1Vo6mzQmD49sF2vGpReZp2/0/*)#yavh9uq5", t: 'Seed', id: "2", createdAt: new Date(10000), key: "key2", ownerPubKey: "ownerPubKey2" }
      smartVaults.getOwnedSigners.mockResolvedValue([signer1, signer2])
      wallet.get_policy_paths_from_signers.mockReturnValue("none")
      let signers = [signer1, signer2]
      let actual = await policy.getPolicyPathsFromSigners()
      expect({ none: true }).toEqual(actual)
      expect(smartVaults.getOwnedSigners).toHaveBeenCalledTimes(1)
      expect(wallet.get_policy_paths_from_signers).toHaveBeenNthCalledWith(1, signers)
    })
  })

  describe('searchUsedSigners', () => {

    it('should correctly call the search_used_signers method of the wallet instance', async () => {
      const signer1 = { name: 'SmartVaults', description: undefined, fingerprint: 'f57a6b99', descriptor: "tr([f57a6b99/86'/1'/784923']tpubDC45v32EZGP2U4qVTK…tbexZUMtY4ubZGS74kQftEGibUxUpybMan7/0/*)#jakwhh0u", t: 'Seed' }
      const signer2 = { name: 'SmartVaults', description: undefined, fingerprint: 'f3ab64d8', descriptor: "tr([f3ab64d8/86'/1'/784923']tpubDCh4uyVDVretfgTNka…91gN5LYtuSCbr1Vo6mzQmD49sF2vGpReZp2/0/*)#yavh9uq5", t: 'Seed' }
      const expected = [signer2]
      wallet.search_used_signers.mockReturnValue(expected)
      let signers = [signer1, signer2]
      let actual = policy.searchUsedSigners(signers)
      expect(expected).toEqual(actual)
      expect(wallet.search_used_signers).toHaveBeenNthCalledWith(1, signers)
    })
  })

  describe('hasTimelock', () => {

    it('should correctly call the has_timelock method of the wallet instance', async () => {
      wallet.has_timelock.mockReturnValue(true)
      let actual = policy.hasTimelock()
      expect(true).toEqual(actual)
      expect(wallet.has_timelock).toHaveBeenCalledTimes(1)
    })
  })

  describe('getExpectedSigners', () => {

    it('should return the expected signers when theres no policy path', async () => {
      const signer1 = { name: 'SmartVaults', description: undefined, fingerprint: 'f57a6b99', descriptor: "tr([f57a6b99/86'/1'/784923']tpubDC45v32EZGP2U4qVTK…tbexZUMtY4ubZGS74kQftEGibUxUpybMan7/0/*)#jakwhh0u", t: 'Seed' } as PublishedOwnedSigner
      const signer2 = { name: 'SmartVaults', description: undefined, fingerprint: 'f3ab64d8', descriptor: "tr([f3ab64d8/86'/1'/784923']tpubDCh4uyVDVretfgTNka…91gN5LYtuSCbr1Vo6mzQmD49sF2vGpReZp2/0/*)#yavh9uq5", t: 'Seed' } as PublishedOwnedSigner
      smartVaults.getOwnedSigners.mockResolvedValue([signer1, signer2])
      jest.spyOn(policy, 'getPolicy').mockReturnValue(undefined!)
      const proposal = { descriptor: "descriptor" + signer1.fingerprint }
      const actual = await policy.getExpectedSigners(proposal, [signer1, signer2])
      expect([signer1.fingerprint]).toEqual(actual)
    })

    it('should return the expected signers when theres policy path', async () => {
      const signer1 = { name: 'SmartVaults', description: undefined, fingerprint: 'f57a6b99', descriptor: "tr([f57a6b99/86'/1'/784923']tpubDC45v32EZGP2U4qVTK…tbexZUMtY4ubZGS74kQftEGibUxUpybMan7/0/*)#jakwhh0u", t: 'Seed' } as PublishedOwnedSigner
      const signer2 = { name: 'SmartVaults', description: undefined, fingerprint: 'f3ab64d8', descriptor: "tr([f3ab64d8/86'/1'/784923']tpubDCh4uyVDVretfgTNka…91gN5LYtuSCbr1Vo6mzQmD49sF2vGpReZp2/0/*)#yavh9uq5", t: 'Seed' } as PublishedOwnedSigner
      smartVaults.getOwnedSigners.mockResolvedValue([signer1, signer2])
      const policyPath = { "83aswe": [0], "a2A8ds": [2], "dsdnii": [0] }
      const proposal = { descriptor: "descriptor" + signer1.fingerprint, policy_path: policyPath }
      const policyTree = new Map<string, any>()
      policyTree.set("id", "83aswe")
      const lastItem = new Map<string, any>()
      lastItem.set("id", "any")
      lastItem.set("fingerprint", "f3ab64d8")
      policyTree.set("items", [new Map<string, any>([["id", "a2A8ds"], ["items", [new Map(), new Map(), lastItem]]]),])
      jest.spyOn(policy, 'getPolicy').mockReturnValue(policyTree)
      const actual = await policy.getExpectedSigners(proposal, [signer1, signer2])
      expect([signer2.fingerprint]).toEqual(actual)
    })
  })

  describe('Augmented transaction details', () => {

    let date1;
    let date2;
    let date3;
    let trxMetadata1;
    let trxMetadata2;
    let trxMetadata3;
    let trx1;
    let trx2;
    let trx3;
    beforeAll(() => {
      date1 = new Date("2023-07-13T20:11:49.000Z")
      date2 = new Date("2023-07-14T20:11:50.000Z")
      date3 = new Date("2023-07-15T20:11:50.000Z")
      trxMetadata1 = { transactionMetadata: { data: {}, text: 'transactionMetadata1' }, transactionMetadataId: 'id1', policy_id: policy2.id }
      trxMetadata2 = { transactionMetadata: { data: {}, text: 'transactionMetadata2' }, transactionMetadataId: 'id2', policy_id: policy2.id }
      trxMetadata3 = { transactionMetadata: { data: {}, text: 'transactionMetadata3' }, transactionMetadataId: 'id3', policy_id: policy2.id }
      trx1 = { txid: "txid1", date: date1, sent: 0, received: 50000, net: 50000, fee: 5000, transactionMetadata: trxMetadata1.transactionMetadata, transactionMetadataId: trxMetadata1.transactionMetadataId, transactionMetadataText: trxMetadata1.transactionMetadata.text, confirmation_time: { height: 2441712, timestamp: 1689279109, confirmedAt: date1 } }
      trx2 = { txid: "txid2", date: date2, sent: 0, received: 100000, net: 100000, fee: 2000, transactionMetadata: trxMetadata2.transactionMetadata, transactionMetadataId: trxMetadata2.transactionMetadataId, transactionMetadataText: trxMetadata2.transactionMetadata.text, confirmation_time: { height: 2441712, timestamp: 1689365510, confirmedAt: date2 } }
      trx3 = { txid: "txid3", date: date3, sent: 140000, received: 0, net: -150000, fee: 6000, transactionMetadata: trxMetadata3.transactionMetadata, transactionMetadataId: trxMetadata3.transactionMetadataId, transactionMetadataText: trxMetadata3.transactionMetadata.text, confirmation_time: { height: 2441712, timestamp: 1689451910, confirmedAt: date3 } }
    })

    it('getAugmentedTransactions using SpecID should generate correct details', async () => {

      const datedBitcoinExchangeRateSpyon = jest.spyOn(policy2.bitcoinExchangeRate, 'getDatedBitcoinExchangeRate')
      const getAugmentedTransactionsSpyon = jest.spyOn(policy2, 'getTrxs')
      const transactionMetadataStoreSpyon = jest.spyOn(policy2.transactionMetadataStore, 'get')
      transactionMetadataStoreSpyon
        .mockReturnValueOnce(trxMetadata1)
        .mockReturnValueOnce(trxMetadata2)
        .mockReturnValueOnce(trxMetadata3)

      datedBitcoinExchangeRateSpyon
        .mockResolvedValueOnce({ rate: 40000, date: date1 })
        .mockResolvedValueOnce({ rate: 60000, date: date2 })
        .mockResolvedValueOnce({ rate: 50000, date: date3 })

      getAugmentedTransactionsSpyon.mockResolvedValueOnce(([trx1, trx2, trx3]))

      jest.spyOn(policy2, 'getLabeledUtxos').mockResolvedValue([] as Array<LabeledUtxo>)
      const expected: AugmentedTransactionDetails[] = [
        { ...trx1, type: "RECEIVE", costBasis: 22, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 20, feeFiatAtConfirmation: 2, btcExchangeRateAtConfirmation: 40000 },
        { ...trx2, type: "RECEIVE", costBasis: 61.2, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 60, feeFiatAtConfirmation: 1.2, btcExchangeRateAtConfirmation: 60000 },
        { ...trx3, type: "SEND", costBasis: 0, associatedCostBasis: "50000@22  100000@61.2", proceeds: 72, capitalGainsLoses: -11.2, netFiatAtConfirmation: -75, feeFiatAtConfirmation: 3, btcExchangeRateAtConfirmation: 50000 }
      ]
      const getTrx1 = { ...trx1, outputs: [], inputs: [], lock_time: 1, confirmation_time: { height: 2441712, timestamp: 1689279109, confirmedAt: date1, confirmations: 1 } }
      const getTrx2 = { ...trx2, outputs: [], inputs: [], lock_time: 1, confirmation_time: { height: 2441712, timestamp: 1689365510, confirmedAt: date2, confirmations: 1 } }
      const getTrx3 = { ...trx3, outputs: [], inputs: [{ txid: "txid1" } as TrxInput, { txid: "txid2" } as TrxInput], lock_time: 1, confirmation_time: { height: 2441712, timestamp: 1689451910, confirmedAt: date3, confirmations: 1 } }
      const getTrxSpyon = jest.spyOn(policy2, 'getTrx')
      getTrxSpyon
        .mockResolvedValueOnce(getTrx3)
        .mockResolvedValueOnce(getTrx1)
        .mockResolvedValueOnce(getTrx2)
        .mockResolvedValueOnce(getTrx1)
        .mockResolvedValueOnce(getTrx2)

      const actual = await policy2.getAugmentedTransactions({ method: AccountingMethod.SpecID })
      actual.map((trx, i) => expected[i].transactionMetadata = trx.transactionMetadata)
      expect(actual).toEqual(expected)

    })

    it('getAugmentedTransactions using FIFO should generate correct details', async () => {

      const datedBitcoinExchangeRateSpyon = jest.spyOn(policy2.bitcoinExchangeRate, 'getDatedBitcoinExchangeRate')
      const getAugmentedTransactionsSpyon = jest.spyOn(policy2, 'getTrxs')

      datedBitcoinExchangeRateSpyon
        .mockResolvedValueOnce({ rate: 40000, date: date1 })
        .mockResolvedValueOnce({ rate: 60000, date: date2 })
        .mockResolvedValueOnce({ rate: 50000, date: date3 })

      getAugmentedTransactionsSpyon.mockResolvedValueOnce(([trx1, trx2, trx3]))

      const transactionMetadataStoreSpyon = jest.spyOn(policy2.transactionMetadataStore, 'get')
      transactionMetadataStoreSpyon
        .mockReturnValueOnce(trxMetadata1)
        .mockReturnValueOnce(trxMetadata2)
        .mockReturnValueOnce(trxMetadata3)

      jest.spyOn(policy2, 'getLabeledUtxos').mockResolvedValue([] as Array<LabeledUtxo>)
      const expected: AugmentedTransactionDetails[] = [
        { ...trx1, type: "RECEIVE", costBasis: 22, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 20, feeFiatAtConfirmation: 2, btcExchangeRateAtConfirmation: 40000 },
        { ...trx2, type: "RECEIVE", costBasis: 61.2, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 60, feeFiatAtConfirmation: 1.2, btcExchangeRateAtConfirmation: 60000 },
        { ...trx3, type: "SEND", costBasis: 0, associatedCostBasis: "50000@22  100000@61.2", proceeds: 72, capitalGainsLoses: -11.2, netFiatAtConfirmation: -75, feeFiatAtConfirmation: 3, btcExchangeRateAtConfirmation: 50000 }
      ]

      const actual = await policy2.getAugmentedTransactions({ method: AccountingMethod.FIFO })
      actual.map((trx, i) => expected[i].transactionMetadata = trx.transactionMetadata)
      expect(actual).toEqual(expected)

    })

    it('getAugmentedTransactions using LIFO should generate correct details', async () => {


      const datedBitcoinExchangeRateSpyon = jest.spyOn(policy2.bitcoinExchangeRate, 'getDatedBitcoinExchangeRate')
      const getAugmentedTransactionsSpyon = jest.spyOn(policy2, 'getTrxs')
      const transactionMetadataStoreSpyon = jest.spyOn(policy2.transactionMetadataStore, 'get')
      transactionMetadataStoreSpyon
        .mockReturnValueOnce(trxMetadata1)
        .mockReturnValueOnce(trxMetadata2)
        .mockReturnValueOnce(trxMetadata3)
      datedBitcoinExchangeRateSpyon
        .mockResolvedValueOnce({ rate: 40000, date: date1 })
        .mockResolvedValueOnce({ rate: 60000, date: date2 })
        .mockResolvedValueOnce({ rate: 50000, date: date3 })

      getAugmentedTransactionsSpyon.mockResolvedValueOnce(([trx1, trx2, trx3]))

      jest.spyOn(policy2, 'getLabeledUtxos').mockResolvedValue([] as Array<LabeledUtxo>)
      const expected: AugmentedTransactionDetails[] = [
        { ...trx1, type: "RECEIVE", costBasis: 22, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 20, feeFiatAtConfirmation: 2, btcExchangeRateAtConfirmation: 40000 },
        { ...trx2, type: "RECEIVE", costBasis: 61.2, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 60, feeFiatAtConfirmation: 1.2, btcExchangeRateAtConfirmation: 60000 },
        { ...trx3, type: "SEND", costBasis: 0, associatedCostBasis: "100000@61.2  50000@22", proceeds: 72, capitalGainsLoses: -11.2, netFiatAtConfirmation: -75, feeFiatAtConfirmation: 3, btcExchangeRateAtConfirmation: 50000 }
      ]

      const actual = await policy2.getAugmentedTransactions({ method: AccountingMethod.LIFO })
      actual.map((trx, i) => expected[i].transactionMetadata = trx.transactionMetadata)
      expect(actual).toEqual(expected)

    })

    it('getAugmentedTransactions using HIFO should generate correct details', async () => {

      const datedBitcoinExchangeRateSpyon = jest.spyOn(policy2.bitcoinExchangeRate, 'getDatedBitcoinExchangeRate')
      const getAugmentedTransactionsSpyon = jest.spyOn(policy2, 'getTrxs')
      const transactionMetadataStoreSpyon = jest.spyOn(policy2.transactionMetadataStore, 'get')
      transactionMetadataStoreSpyon
        .mockReturnValueOnce(trxMetadata1)
        .mockReturnValueOnce(trxMetadata2)
        .mockReturnValueOnce(trxMetadata3)

      datedBitcoinExchangeRateSpyon
        .mockResolvedValueOnce({ rate: 40000, date: date1 })
        .mockResolvedValueOnce({ rate: 60000, date: date2 })
        .mockResolvedValueOnce({ rate: 50000, date: date3 })

      getAugmentedTransactionsSpyon.mockResolvedValueOnce(([trx1, trx2, trx3]))

      jest.spyOn(policy2, 'getLabeledUtxos').mockResolvedValue([] as Array<LabeledUtxo>)
      const expected: AugmentedTransactionDetails[] = [
        { ...trx1, type: "RECEIVE", costBasis: 22, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 20, feeFiatAtConfirmation: 2, btcExchangeRateAtConfirmation: 40000 },
        { ...trx2, type: "RECEIVE", costBasis: 61.2, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 60, feeFiatAtConfirmation: 1.2, btcExchangeRateAtConfirmation: 60000 },
        { ...trx3, type: "SEND", costBasis: 0, associatedCostBasis: "100000@61.2  50000@22", proceeds: 72, capitalGainsLoses: -11.2, netFiatAtConfirmation: -75, feeFiatAtConfirmation: 3, btcExchangeRateAtConfirmation: 50000 }
      ]

      const actual = await policy2.getAugmentedTransactions({ method: AccountingMethod.HIFO })
      actual.map((trx, i) => expected[i].transactionMetadata = trx.transactionMetadata)
      expect(actual).toEqual(expected)

    })

    it('using provided cost basis and proceeds should generate correct details', async () => {

      const datedBitcoinExchangeRateSpyon = jest.spyOn(policy2.bitcoinExchangeRate, 'getDatedBitcoinExchangeRate')
      const getAugmentedTransactionsSpyon = jest.spyOn(policy2, 'getTrxs')
      const transactionMetadataStoreSpyon = jest.spyOn(policy2.transactionMetadataStore, 'get')

      transactionMetadataStoreSpyon
        .mockReturnValueOnce(trxMetadata1)
        .mockReturnValueOnce(trxMetadata2)
        .mockReturnValueOnce(trxMetadata3)

      datedBitcoinExchangeRateSpyon
        .mockResolvedValueOnce({ rate: 40000, date: date1 })
        .mockResolvedValueOnce({ rate: 60000, date: date2 })
        .mockResolvedValueOnce({ rate: 50000, date: date3 })

      getAugmentedTransactionsSpyon.mockResolvedValueOnce(([trx1, trx2, trx3]))

      jest.spyOn(policy2, 'getLabeledUtxos').mockResolvedValue([] as Array<LabeledUtxo>)
      const expected: AugmentedTransactionDetails[] = [
        { ...trx1, type: "RECEIVE", costBasis: 50, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 20, feeFiatAtConfirmation: 2, btcExchangeRateAtConfirmation: 40000 },
        { ...trx2, type: "RECEIVE", costBasis: 100, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 60, feeFiatAtConfirmation: 1.2, btcExchangeRateAtConfirmation: 60000 },
        { ...trx3, type: "SEND", costBasis: 0, associatedCostBasis: "100000@100  50000@50", proceeds: 150, capitalGainsLoses: 0, netFiatAtConfirmation: -75, feeFiatAtConfirmation: 3, btcExchangeRateAtConfirmation: 50000 }
      ]
      const costBasisProceedsMap = new Map<string, number>(([[trx1.txid, 50], [trx2.txid, 100], [trx3.txid, 150]]))
      const actual = await policy2.getAugmentedTransactions({ method: AccountingMethod.HIFO, costBasisProceedsMap })
      actual.map((trx, i) => expected[i].transactionMetadata = trx.transactionMetadata)
      expect(actual).toEqual(expected)

    }
    )

    it('using provided btc exchange rate should generate correct details', async () => {

      const getAugmentedTransactionsSpyon = jest.spyOn(policy2, 'getTrxs')
      const transactionMetadataStoreSpyon = jest.spyOn(policy2.transactionMetadataStore, 'get')

      transactionMetadataStoreSpyon
        .mockReturnValueOnce(trxMetadata1)
        .mockReturnValueOnce(trxMetadata2)
        .mockReturnValueOnce(trxMetadata3)

      const btcExchangeRateMap = new Map<string, number>(([[trx1.txid, 40000], [trx2.txid, 60000], [trx3.txid, 50000]]))

      getAugmentedTransactionsSpyon.mockResolvedValueOnce(([trx1, trx2, trx3]))

      jest.spyOn(policy2, 'getLabeledUtxos').mockResolvedValue([] as Array<LabeledUtxo>)
      const expected: AugmentedTransactionDetails[] = [
        { ...trx1, type: "RECEIVE", costBasis: 22, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 20, feeFiatAtConfirmation: 2, btcExchangeRateAtConfirmation: 40000 },
        { ...trx2, type: "RECEIVE", costBasis: 61.2, associatedCostBasis: "N/A", proceeds: 0, capitalGainsLoses: 0, netFiatAtConfirmation: 60, feeFiatAtConfirmation: 1.2, btcExchangeRateAtConfirmation: 60000 },
        { ...trx3, type: "SEND", costBasis: 0, associatedCostBasis: "100000@61.2  50000@22", proceeds: 72, capitalGainsLoses: -11.2, netFiatAtConfirmation: -75, feeFiatAtConfirmation: 3, btcExchangeRateAtConfirmation: 50000 }
      ]
      const actual = await policy2.getAugmentedTransactions({ method: AccountingMethod.HIFO, btcExchangeRatesMap: btcExchangeRateMap })
      actual.map((trx, i) => expected[i].transactionMetadata = trx.transactionMetadata)
      expect(actual).toEqual(expected)
    })

  }
  )
})

