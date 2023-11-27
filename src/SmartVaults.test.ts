import sleep from 'await-sleep'
import { MockProxy, mock } from 'jest-mock-extended'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { SmartVaults } from './SmartVaults'
import { NostrClient, Keys, Store } from './service'
import { TimeUtil, buildEvent } from './util'
import { BaseOwnedSigner, Contact, PublishedPolicy, BitcoinUtil, Wallet, type FinalizeTrxResponse } from './models'
import { Metadata, Profile, SavePolicyPayload, SpendProposalPayload, PublishedDirectMessage, PublishedSpendingProposal, PublishedApprovedProposal, PublishedSharedSigner, PublishedOwnedSigner, MySharedSigner, KeyAgentMetadata, SignerOffering, KeyAgent, PublishedSignerOffering, PublishedKeyAgentPaymentProposal, PublishedCompletedKeyAgentPaymentProposal } from './types'
import { SmartVaultsKind, ProposalStatus, NetworkType, FiatCurrency, PaymentType } from './enum'
import { Kind } from 'nostr-tools'

jest.setTimeout(1000000);

describe('SmartVaults', () => {
  let smartVaults: SmartVaults
  let nostrClient: NostrClient
  let authenticator: DirectPrivateKeyAuthenticator
  let network: NetworkType
  let authority: string
  let bitcoinUtil: MockProxy<BitcoinUtil>
  let keySet1
  let keySet2
  let altKeySet
  let keyAgentPaymentProposal1: PublishedKeyAgentPaymentProposal

  beforeAll(async () => {
    keySet1 = new KeySet(3)
    keySet2 = keySet1.derive(2)
    altKeySet = new KeySet(2)
    nostrClient = new NostrClient([
      //'wss://relay.rip',
      // 'wss://test.relay.report'
      'ws://localhost:7777'
    ])
    bitcoinUtil = mock<BitcoinUtil>()
    bitcoinUtil.toDescriptor.mockReturnValue("Descriptor")
    authenticator = new DirectPrivateKeyAuthenticator(keySet1.mainKey().privateKey)
    network = NetworkType.Bitcoin
    authority = authenticator.getPublicKey()
    smartVaults = new SmartVaults({
      authenticator,
      bitcoinUtil,
      nostrClient,
      network,
      authority
    })
    global.fetch = jest.fn().mockReturnValue(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ bitcoin: { usd: 100_000_000 } }),
    }));
    jest.spyOn(smartVaults, 'getPsbtFromFileSystem').mockResolvedValue('psbt')
    jest.spyOn(smartVaults, 'signedPsbtSanityCheck').mockResolvedValue()
  })

  afterEach(() => {
    smartVaults.disconnect()
  })

  describe('mock', () => {
    it('bit', async () => {
      bitcoinUtil.walletSyncTimeGap = 1
      bitcoinUtil.createWallet("asds")
      const wallet = mock<Wallet>()
      wallet.sync()
      expect(bitcoinUtil.walletSyncTimeGap).toBe(1)
      expect(bitcoinUtil.createWallet).toHaveBeenCalledWith("asds")
      expect(wallet.sync).toBeCalledTimes(1)
    })
  })

  describe('profiles', () => {
    let profile1: Profile
    let profile2: Profile
    let profile3: Profile
    let profile4: Profile
    let profile5: Profile
    let contact1: Contact
    let contact2: Contact
    let contact3: Contact
    beforeAll(async () => {
      profile1 = await setProfile(1, smartVaults)
      profile2 = await setProfile(2, smartVaults)
      profile3 = await setProfile(3, smartVaults)
      smartVaults.setAuthenticator(authenticator)
      profile4 = await smartVaults.setProfile(getMetadata(420))
      contact1 = getContact(1, profile1.publicKey)
      contact2 = getContact(2, profile2.publicKey)
      contact3 = getContact(3, profile3.publicKey)
      await smartVaults.upsertContacts([contact1, contact2, contact3])
    })

    it('getProfile', async () => {
      const profile = await smartVaults.getProfile(profile1.publicKey)
      expect(profile).toEqual(profile1)
      const own_profile = await smartVaults.getProfile(profile4.publicKey)
      expect(own_profile).toEqual(profile4)
      profile5 = await smartVaults.setProfile(getMetadata(69))
      const own_profile2 = await smartVaults.getProfile(profile5.publicKey)
      expect(own_profile2).toEqual(profile5)
    })

    it('getContacts', async () => {
      const contacts = await smartVaults.getContacts()
      expect(contacts.length).toBe(3)
      expect(contacts).toEqual(expect.arrayContaining(
        [
          { ...contact1 },
          { ...contact2 },
          { ...contact3 },
        ]
      ))
    })

    it('getContactProfiles', async () => {
      const profiles = await smartVaults.getContactProfiles()
      expect(profiles.length).toBe(3)
      expect(profiles).toEqual(expect.arrayContaining(
        [
          { ...contact1, ...profile1 },
          { ...contact2, ...profile2 },
          { ...contact3, ...profile3 },
        ]
      ))
    })

    it('removeContacts', async () => {
      await sleep(200)
      await smartVaults.removeContacts([contact1.publicKey, contact2.publicKey])
      const contacts = await smartVaults.getContacts()
      expect(contacts.length).toBe(1)
      expect(contacts).toEqual(expect.arrayContaining(
        [
          { ...contact3 },
        ]
      ))
    })

    it('getProfile if not metadata should return undefined', async () => {
      const newKeySet = new KeySet(1)
      const newPubKey = newKeySet.mainKey().publicKey
      const newAuthenticator = new DirectPrivateKeyAuthenticator(newKeySet.mainKey().privateKey)
      smartVaults.setAuthenticator(newAuthenticator)
      await smartVaults.upsertContacts([contact1, contact2, contact3])
      await smartVaults.getContactProfiles()
      const profiles = await smartVaults.getProfile(newPubKey)
      expect(profiles).toEqual(undefined)
    })

    it('getContactsProfiles should return the contact even if a contact has no metadata', async () => {
      const newKeySet = new KeySet(1)
      const altKeySet = new KeySet(1)

      const altPubKey = altKeySet.mainKey().publicKey
      const contact = new Contact({ publicKey: altPubKey, relay: "relay", petname: "pet" })
      const newAuthenticator = new DirectPrivateKeyAuthenticator(newKeySet.mainKey().privateKey)
      smartVaults.setAuthenticator(newAuthenticator)
      await smartVaults.upsertContacts([contact1, contact2, contact3, contact])

      const profiles = await smartVaults.getContactProfiles()
      expect(profiles.length).toBe(4)
      expect(profiles).toEqual(expect.arrayContaining(
        [
          { ...contact1, ...profile1 },
          { ...contact2, ...profile2 },
          { ...contact3, ...profile3 },
          { ...contact },
        ]
      ))
    }
    )

    it('getContactProfiles should return empty array if a user has no contacts', async () => {
      const newKeySet = new KeySet(1)
      const newPubKey = newKeySet.mainKey().publicKey
      const newAuthenticator = new DirectPrivateKeyAuthenticator(newKeySet.mainKey().privateKey)
      smartVaults.setAuthenticator(newAuthenticator)
      const metadata = { ...getMetadata(1), publicKey: newPubKey }
      await smartVaults.setProfile(metadata)
      const profiles = await smartVaults.getContactProfiles()
      const fetchedMetadata = await smartVaults.getProfile(newPubKey)
      expect(metadata).toEqual(fetchedMetadata)
      expect(profiles).toEqual([])
      smartVaults.setAuthenticator(authenticator)
    }
    )

    it('getRecommendedContacts works', async () => {
      let recommended = await smartVaults.getRecommendedContacts()
      expect(recommended.length).toBe(0)
      const newKeySet = new KeySet(1)
      const newPubKey = newKeySet.mainKey().publicKey
      const newAuthenticator = new DirectPrivateKeyAuthenticator(newKeySet.mainKey().privateKey)
      smartVaults.setAuthenticator(newAuthenticator)
      const signer = await saveSharedSignerPayload(smartVaults, 1)
      const signer2 = await saveSharedSignerPayload(smartVaults, 2)
      await smartVaults.saveSharedSigner(signer, keySet1.mainKey().publicKey)
      await smartVaults.saveSharedSigner(signer2, keySet1.mainKey().publicKey)
      smartVaults.setAuthenticator(authenticator)
      recommended = await smartVaults.getRecommendedContacts()
      expect(recommended.length).toBe(1)
      expect(recommended).toEqual([newPubKey])
      smartVaults.setAuthenticator(newAuthenticator)
      const metadata = { ...getMetadata(1), publicKey: newPubKey }
      const profile = await smartVaults.setProfile(metadata)
      smartVaults.setAuthenticator(authenticator)
      recommended = await smartVaults.getRecommendedContacts()
      expect(recommended.length).toBe(1)
      expect(recommended).toEqual([profile])
      await smartVaults.upsertContacts(new Contact({ publicKey: newPubKey, relay: "relay", petname: "pet" }))
      recommended = await smartVaults.getRecommendedContacts()
      expect(recommended.length).toBe(0)
    }
    )
  })

  describe('getPolicies', () => {
    let policy1: PublishedPolicy
    let policy2: PublishedPolicy
    let policy3: PublishedPolicy
    let wallet: MockProxy<Wallet>

    beforeAll(async () => {
      wallet = mock<Wallet>()
      wallet.sync.mockResolvedValue()
      wallet.get_balance.mockReturnValue({
        confirmed: 0,
        immature: 0,
        trusted_pending: 0,
        untrusted_pending: 0
      })
      bitcoinUtil.createWallet.mockReturnValue(wallet)
      let savePayload = getSavePolicyPayload(1, keySet1.getPublicKeys(), -20)
      policy1 = await smartVaults.savePolicy(savePayload)
      savePayload = getSavePolicyPayload(2, keySet1.getPublicKeys(), -10)
      policy2 = await smartVaults.savePolicy(savePayload)
      savePayload = getSavePolicyPayload(3, keySet2.getPublicKeys())
      policy3 = await smartVaults.savePolicy(savePayload)
      bitcoinUtil.getPsbtUtxos.mockReturnValue(["utxo1", "utxo2"])
      jest.spyOn(smartVaults, 'getPsbtFromFileSystem').mockResolvedValue('psbt')
      jest.spyOn(smartVaults, 'signedPsbtSanityCheck').mockResolvedValue()
    })

    // it('lee policies', async () => {
    //   smartVaults.setAuthenticator(new DirectPrivateKeyAuthenticator("3fec18a9e196fd3a6417b45fad7005edb23d8529cb41d8ac738cfdd7d2b75677"))
    //   const policies = await smartVaults.getPolicies()
    //   // expect(policies.length).toBe(3)
    //   // expect(policies[0]).toEqual(policy3)
    //   // expect(policies[1]).toEqual(policy2)
    //   // expect(policies[2]).toEqual(policy1)
    // })

    it('all policies works', async () => {
      const policies = await smartVaults.getPolicies()
      expect(policies.length).toBe(3)
      assertPublishedPolicy(policies[0], policy3)
      assertPublishedPolicy(policies[1], policy2)
      assertPublishedPolicy(policies[2], policy1)
    })

    it('since works', async () => {
      let policies = await smartVaults.getPolicies({ since: policy2.createdAt })
      expect(policies.length).toBe(2)
      assertPublishedPolicy(policies[0], policy3)
      assertPublishedPolicy(policies[1], policy2)

      policies = await smartVaults.getPolicies({ since: policy3.createdAt })
      expect(policies.length).toBe(1)
      assertPublishedPolicy(policies[0], policy3)
    })

    it('until works', async () => {
      let policies = await smartVaults.getPolicies({ until: policy2.createdAt })
      expect(policies.length).toBe(1)
      assertPublishedPolicy(policies[0], policy1)

      policies = await smartVaults.getPolicies({ until: policy1.createdAt })
      expect(policies.length).toBe(0)
    })

    it('limit works', async () => {
      let policies = await smartVaults.getPolicies({ limit: 2 })
      expect(policies.length).toBe(2)
      assertPublishedPolicy(policies[0], policy3)
      assertPublishedPolicy(policies[1], policy2)

      policies = await smartVaults.getPolicies({ since: policy2.createdAt, limit: 1 })
      expect(policies.length).toBe(1)
      assertPublishedPolicy(policies[0], policy3)
    })

    it('ids filter works', async () => {
      let policies = await smartVaults.getPoliciesById([policy1.id, policy3.id])
      expect(policies.size).toBe(2)
      assertPublishedPolicy(policies.get(policy3.id)!, policy3)
      assertPublishedPolicy(policies.get(policy1.id)!, policy1)

    })

    it('deletePolicies works', async () => {
      const proposal1 = await smartVaults._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload(1))
      await smartVaults._saveCompletedProposal(proposal1.proposal_id, saveProofOfReserveProposalPayload(1))
      const policies = await smartVaults.getPolicies()
      const completedProposals = await smartVaults.getCompletedProposals()
      const proposal2 = await smartVaults._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload(2))
      const proposals = await smartVaults.getProposals()
      await smartVaults.saveApprovedProposal(proposal2.proposal_id, 'signedPsbt')
      const approvals = await smartVaults.getApprovals()
      expect(proposals.length).toBe(1)
      expect(policies.length).toBe(3)
      expect(completedProposals.length).toBe(1)
      expect(approvals.size).toBe(1)
      await smartVaults.deletePolicies([policy1.id, policy2.id])
      const policies2 = await smartVaults.getPolicies()
      const proposals2 = await smartVaults.getProposals()
      const completedProposals2 = await smartVaults.getCompletedProposals()
      const approvals2 = await smartVaults.getApprovals()
      expect(policies2.length).toBe(1)
      expect(proposals2.length).toBe(0)
      expect(completedProposals2.length).toBe(0)
      expect(approvals2.size).toBe(0)
      assertPublishedPolicy(policies2[0], policy3)
    })

  })

  describe('subscribe', () => {
    let smartVaults: SmartVaults
    let keySet: KeySet
    beforeEach(async () => {
      keySet = new KeySet(2)
      smartVaults = new SmartVaults({
        authenticator: new DirectPrivateKeyAuthenticator(keySet.mainKey().privateKey),
        bitcoinUtil,
        nostrClient,
        network,
        authority
      })
      const wallet = mock<Wallet>()
      wallet.sync.mockResolvedValue()
      wallet.build_trx
        .mockResolvedValueOnce({ amount: 1000, psbt: "encoded psbt1" })
        .mockResolvedValueOnce({ amount: 2000, psbt: "encoded psbt2" })
        .mockResolvedValueOnce({ amount: 3000, psbt: "encoded psbt3" })
        .mockResolvedValueOnce({ amount: 4000, psbt: "encoded psbt4" })
      bitcoinUtil.createWallet.mockReturnValue(wallet)
      bitcoinUtil.getFee.mockReturnValue(100)
      bitcoinUtil.getPsbtUtxos.mockReturnValue(["utxo1", "utxo2"])
      jest.spyOn(smartVaults, 'getPsbtFromFileSystem').mockResolvedValue('psbt')
      jest.spyOn(smartVaults, 'signedPsbtSanityCheck').mockResolvedValue()
    })

    it('should receive policy events', async () => {
      expect.assertions(12)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      const sub = smartVaults.subscribe(SmartVaultsKind.Policy, (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionPolicyPayload(kind, payload, savePolicyPayload1)
            break
          case 1:
            assertSubscriptionPolicyPayload(kind, payload, savePolicyPayload2)
            break
        }
        counter++
      }
      )

      await smartVaults.savePolicy(savePolicyPayload1)
      await smartVaults.savePolicy(savePolicyPayload2)
      await sleep(500)
      sub.unsub()

    })


    it('should receive OwnedSigner and SharedSigners events', async () => {
      expect.assertions(22)
      const pubKey = smartVaults.authenticator.getPublicKey()
      let counter: number = 0
      let saveOwnedSignerPayload1 = saveOwnedSignerPayload(1, pubKey)
      let saveOwnedSignerPayload2 = saveOwnedSignerPayload(2, pubKey)
      let saveSharedSignerPayload1 = await saveSharedSignerPayload(smartVaults, 1)
      let saveSharedSignerPayload2 = await saveSharedSignerPayload(smartVaults, 2)
      await sleep(1000)
      const sub = smartVaults.subscribe([SmartVaultsKind.Signers, SmartVaultsKind.SharedSigners], (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionOwnedSignerPayload(kind, payload, saveOwnedSignerPayload1)
            break
          case 1:
            assertSubscriptionOwnedSignerPayload(kind, payload, saveOwnedSignerPayload2)
            break
          case 2:
            assertSubscriptionSharedSignerPayload(kind, payload, saveSharedSignerPayload1)
            break
          case 3:
            assertSubscriptionSharedSignerPayload(kind, payload, saveSharedSignerPayload2)
            break
        }
        counter++
      })

      await smartVaults.saveOwnedSigner(saveOwnedSignerPayload1)
      await smartVaults.saveOwnedSigner(saveOwnedSignerPayload2)
      await smartVaults.saveSharedSigner(saveSharedSignerPayload1, pubKey)
      await smartVaults.saveSharedSigner(saveSharedSignerPayload2, pubKey)
      await sleep(1000)
      sub.unsub()
    })

    it('should receive Proposal events', async () => {

      expect.assertions(8)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      let policy1 = await smartVaults.savePolicy(savePolicyPayload1)
      let policy2 = await smartVaults.savePolicy(savePolicyPayload2)
      let spendProposalPayload1 = spendProposalPayload(1, policy1)
      let spendProposalPayload2 = spendProposalPayload(2, policy2)
      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(1)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(2)

      const sub = smartVaults.subscribe(SmartVaultsKind.Proposal, (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionSpendProposalPayload(kind, payload, spendProposal1)
            break
          case 1:
            assertSubscriptionSpendProposalPayload(kind, payload, spendProposal2)
            break
          case 2:
            assertSubscriptionProofOfReserveProposalPayload(kind, payload, proofOfReserveProposal1)
            break
          case 3:
            assertSubscriptionProofOfReserveProposalPayload(kind, payload, proofOfReserveProposal2)
            break
        }
        counter++
      })

      let spendProposal1 = await smartVaults.spend(spendProposalPayload1)
      let spendProposal2 = await smartVaults.spend(spendProposalPayload2)
      let proofOfReserveProposal1 = await smartVaults._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      let proofOfReserveProposal2 = await smartVaults._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)

      await sleep(2000)
      sub.unsub()
    })


    it('should receive ApprovedProposal events', async () => {
      expect.assertions(8)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      let policy1 = await smartVaults.savePolicy(savePolicyPayload1)
      let policy2 = await smartVaults.savePolicy(savePolicyPayload2)
      let spendProposalPayload1 = spendProposalPayload(1, policy1)
      let spendProposalPayload2 = spendProposalPayload(2, policy2)
      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(1)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(2)

      const sub = smartVaults.subscribe(SmartVaultsKind.ApprovedProposal, (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionApprovedProposalPayload(kind, payload, approvedProposal1)
            break
          case 1:
            assertSubscriptionApprovedProposalPayload(kind, payload, approvedProposal2)
            break
          case 2:
            assertSubscriptionApprovedProposalPayload(kind, payload, approvedProposal3)
            break
          case 3:
            assertSubscriptionApprovedProposalPayload(kind, payload, approvedProposal4)
            break
        }
        counter++
      })

      let spendProposal1 = await smartVaults.spend(spendProposalPayload1)
      let spendProposal2 = await smartVaults.spend(spendProposalPayload2)
      let proofOfReserveProposal1 = await smartVaults._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      let proofOfReserveProposal2 = await smartVaults._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)
      let approvedProposal1 = await smartVaults.saveApprovedProposal(spendProposal1.proposal_id, 'signedPsbt')
      let approvedProposal2 = await smartVaults.saveApprovedProposal(spendProposal2.proposal_id, 'signedPsbt')
      let approvedProposal3 = await smartVaults.saveApprovedProposal(proofOfReserveProposal1.proposal_id, 'signedPsbt')
      let approvedProposal4 = await smartVaults.saveApprovedProposal(proofOfReserveProposal2.proposal_id, 'signedPsbt')

      await sleep(100)
      sub.unsub()
    }
    )


    it('should receive CompletedProposal events', async () => {
      expect.assertions(4)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      let policy1 = await smartVaults.savePolicy(savePolicyPayload1)
      let policy2 = await smartVaults.savePolicy(savePolicyPayload2)
      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(1)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(2)
      let proofOfReserveProposal1 = await smartVaults._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      let proofOfReserveProposal2 = await smartVaults._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)
      let completedProposal1;
      let completedProposal2;
      const sub = smartVaults.subscribe(SmartVaultsKind.CompletedProposal, (kind: number, payload: any) => {
        sleep(2000)
        switch (counter) {
          case 0:
            assertSubscriptionCompletedProposalPayload(kind, payload, completedProposal1)
            break
          case 1:
            assertSubscriptionCompletedProposalPayload(kind, payload, completedProposal2)
            break
        }
        counter++
      })


      completedProposal1 = await smartVaults._saveCompletedProposal(proofOfReserveProposal1.proposal_id, saveProofOfReserveProposalPayload1)
      completedProposal2 = await smartVaults._saveCompletedProposal(proofOfReserveProposal2.proposal_id, saveProofOfReserveProposalPayload2)

      await sleep(100)
      sub.unsub()
    }
    )

    it('should receive many events', async () => {
      let counter: number = 0
      expect.assertions(23)
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let pubkey = smartVaults.authenticator.getPublicKey()
      let saveOwnedSignerPayload1 = saveOwnedSignerPayload(1, pubkey)
      let saveSharedSignerPayload1 = await saveSharedSignerPayload(smartVaults, 1)
      await sleep(2000)
      const sub = smartVaults.subscribe([SmartVaultsKind.Policy, SmartVaultsKind.Signers, SmartVaultsKind.SharedSigners, SmartVaultsKind.Proposal, SmartVaultsKind.ApprovedProposal, SmartVaultsKind.CompletedProposal],
        (kind: number, payload: any) => {
          switch (counter) {
            case 0:
              assertSubscriptionPolicyPayload(kind, payload, savePolicyPayload1)
              break
            case 1:
              assertSubscriptionOwnedSignerPayload(kind, payload, saveOwnedSignerPayload1)
              break
            case 2:
              assertSubscriptionSharedSignerPayload(kind, payload, saveSharedSignerPayload1)
              break
            case 3:
              assertSubscriptionProofOfReserveProposalPayload(kind, payload, proofOfReserveProposal1)
              break
            case 4:
              assertSubscriptionApprovedProposalPayload(kind, payload, approvedProposal1)
              break
            case 5:
              assertSubscriptionCompletedProposalPayload(kind, payload, completedProposal1)
              break
          }
          counter++
        })

      let policy1 = await smartVaults.savePolicy(savePolicyPayload1)
      await sleep(100)
      await smartVaults.saveOwnedSigner(saveOwnedSignerPayload1)
      await sleep(100)
      await smartVaults.saveSharedSigner(saveSharedSignerPayload1, pubkey)
      await sleep(100)
      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(1)
      let proofOfReserveProposal1 = await smartVaults._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      await sleep(100)
      let approvedProposal1 = await smartVaults.saveApprovedProposal(proofOfReserveProposal1.proposal_id, 'signedPsbt')
      await sleep(100)
      let completedProposal1 = await smartVaults._saveCompletedProposal(proofOfReserveProposal1.proposal_id, saveProofOfReserveProposalPayload1)
      await sleep(300)
      sub.unsub()
    }
    )

    it('should receive Metadata events', async () => {
      let counter: number = 0
      expect.assertions(2)
      const sub = smartVaults.subscribe(Kind.Metadata, (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionMetadataPayload(kind, payload, metadata1)
            break
        }
        counter++
      })

      const metadata1 = await smartVaults.setProfile(getMetadata(1));

      await sleep(200)
      sub.unsub()
    }
    )

    it('should receive Contacts events', async () => {
      let counter: number = 0
      expect.assertions(2)
      const contact = new Contact({ publicKey: keySet1.mainKey().publicKey, relay: "relay", petname: "pet" })
      const sub = smartVaults.subscribe(Kind.Contacts, (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionContactPayload(kind, payload, contact)
            break
        }
        counter++
      })

      await smartVaults.upsertContacts(contact);

      await sleep(200)
      sub.unsub()
    }
    )

    it('should receive delete events', async () => {
      let counter: number = 0
      expect.assertions(12)
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      let policy1 = await smartVaults.savePolicy(savePolicyPayload1)
      let policy2 = await smartVaults.savePolicy(savePolicyPayload2)
      let spendProposalPayload1 = spendProposalPayload(1, policy1)
      let spendProposalPayload2 = spendProposalPayload(2, policy2)
      let spendProposal1 = await smartVaults.spend(spendProposalPayload1)
      let spendProposal2 = await smartVaults.spend(spendProposalPayload2)
      let approval1 = await smartVaults.saveApprovedProposal(spendProposal2.proposal_id, 'signedPsbt')
      let approval2 = await smartVaults.saveApprovedProposal(spendProposal2.proposal_id, 'signedPsbt')
      let approval3 = await smartVaults.saveApprovedProposal(spendProposal2.proposal_id, 'signedPsbt')
      const expectedDeleteEvent1 = new Map([[SmartVaultsKind.Proposal, [spendProposal1.proposal_id]]])
      const expectedDeleteEvent2 = new Map([[SmartVaultsKind.Policy, [policy1.id]]])
      const expectedDeleteEvent3 = new Map([[SmartVaultsKind.ApprovedProposal, [approval1.approval_id, approval2.approval_id, approval3.approval_id]]])

      const sub = smartVaults.subscribe(Kind.EventDeletion, (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            expect(kind).toBe(Kind.EventDeletion)
            expect(payload).toEqual(expectedDeleteEvent1)
            break
          case 1:
            expect(kind).toBe(Kind.EventDeletion)
            expect(payload).toEqual(expectedDeleteEvent2)
            break
          case 2:
            expect(kind).toBe(Kind.EventDeletion)
            expect(new Set(payload.get(SmartVaultsKind.ApprovedProposal))).toEqual(new Set(expectedDeleteEvent3.get(SmartVaultsKind.ApprovedProposal)))
            break
        }
        counter++
      })

      const policies = await smartVaults.getPolicies()
      const proposals = await smartVaults.getProposals()
      const approvals = await smartVaults.getApprovals()
      expect(policies.length).toBe(2)
      expect(proposals.length).toBe(2)
      expect(approvals.size).toBe(1)

      await _deleteProposals([spendProposal1.proposal_id], smartVaults)
      await sleep(100)
      const proposals2 = await smartVaults.getProposals()
      expect(proposals2.length).toBe(1)
      await _deletePolicies([policy1.id], smartVaults)
      await sleep(100)
      const policies2 = await smartVaults.getPolicies()
      expect(policies2.length).toBe(1)
      await _deleteApprovals([approval1.approval_id, approval2.approval_id, approval3.approval_id], smartVaults)
      await sleep(200)
      const approvals2 = await smartVaults.getApprovals()
      expect(approvals2.size).toBe(0)
      await sleep(200)
      sub.unsub()
    })
  })

  describe('Store methods work as expected', () => {
    let store: Store;

    beforeEach(() => {
      store = new Store({ 'id': ['id', 'id2'], 'name': ['name', 'id2'] });
    });

    it('should store and retrieve objects with multiple index keys correctly', () => {
      const obj1 = { id: 'id1', id2: 'id2', name: 'name1' };
      const obj2 = { id: 'id2', id2: 'otherID', name: 'name2' };
      store.store([obj1, obj2]);

      const retrievedObj1 = store.get('id1', 'id');
      const retrievedObj2 = store.get('id2', 'id');
      const retrievedObj3 = store.get('name1', 'name');
      const retrievedObj4 = store.get('name2', 'name');

      expect(retrievedObj1).toEqual(obj1);
      expect(retrievedObj2).toEqual(obj2);
      expect(retrievedObj3).toEqual(obj1);
      expect(retrievedObj4).toEqual(obj2);
    });

    it('getMany should return a map with key as indexValue and value as array of objects matching the indexKey', () => {
      const obj1 = { id: 'id1', id2: 'id2', name: 'name1' };
      const obj2 = { id: 'id1', id2: 'otherID', name: 'name2' };
      const obj3 = { id: 'id1', id2: 'id3', name: 'name3' };
      store.store([obj1, obj2, obj3]);

      const map = store.getMany(['id1'], 'id');
      expect(map.get('id1')).toEqual([obj1, obj2, obj3]);
    });

    it('getManyAsArray should return an array of objects matching the indexKey and indexValues', () => {
      const obj1 = { id: 'id1', id2: 'id2', name: 'name1' };
      const obj2 = { id: 'id1', id2: 'otherID', name: 'name2' };
      const obj3 = { id: 'id1', id2: 'id3', name: 'name1' };
      store.store([obj1, obj2, obj3]);
      const arr = store.getManyAsArray(['name1'], 'name');
      expect(arr).toEqual([obj1, obj3]);
    });

    it('has should return true if object exists in index', () => {
      const obj1 = { id: 'id1', id2: 'id2', name: 'name1' };
      store.store(obj1);

      const exists = store.has('id1', 'id');
      const existsByName = store.has('name1', 'name');

      expect(exists).toBeTruthy();
      expect(existsByName).toBeTruthy();
    });

    it('missing should return array of missing index values', () => {
      const obj1 = { id: 'id1', id2: 'id2', name: 'name1' };
      store.store(obj1);

      const missing = store.missing(['id1', 'id2'], 'id');
      const missingNames = store.missing(['name1', 'name2'], 'name');

      expect(missing).toEqual(['id2']);
      expect(missingNames).toEqual(['name2']);
    });

  });

  describe('getOwnedSigners', () => {
    let ownedSigner1: BaseOwnedSigner
    let ownedSigner2: BaseOwnedSigner
    let ownedSigner3: BaseOwnedSigner
    beforeAll(async () => {
      const pubKey = smartVaults.authenticator.getPublicKey()
      let saveOwnedSignerPayload1 = saveOwnedSignerPayload(1, pubKey)
      ownedSigner1 = await smartVaults.saveOwnedSigner(saveOwnedSignerPayload1)
      let saveOwnedSignerPayload2 = saveOwnedSignerPayload(2, pubKey)
      ownedSigner2 = await smartVaults.saveOwnedSigner(saveOwnedSignerPayload2)
      let saveOwnedSignerPayload3 = saveOwnedSignerPayload(3, pubKey)
      ownedSigner3 = await smartVaults.saveOwnedSigner(saveOwnedSignerPayload3)
    })
    it('returns owned signers', async () => {
      const signers = await smartVaults.getOwnedSigners();
      expect(signers.length).toBe(3);
      expect(signers[0]).toEqual(ownedSigner3)
      expect(signers[1]).toEqual(ownedSigner2)
      expect(signers[2]).toEqual(ownedSigner1)

      signers.forEach(signer => {
        expect(signer).toHaveProperty('ownerPubKey');
        expect(signer).toHaveProperty('descriptor');
        expect(signer).toHaveProperty('fingerprint');
        expect(signer).toHaveProperty('name');
        expect(signer).toHaveProperty('t');
        expect(signer).toHaveProperty('description');
      });
    });

    it('deleteSigners works', async () => {
      const signers = await smartVaults.getOwnedSigners();
      expect(signers.length).toBe(3);
      await smartVaults.deleteSigners([signers[0].id, signers[1].id])
      const signers2 = await smartVaults.getOwnedSigners();
      expect(signers2.length).toBe(1);
      expect(signers2[0]).toEqual(ownedSigner1)
    }
    );
  });

  describe('getSharedSigners', () => {
    let sharedSigner1: PublishedSharedSigner;
    let sharedSigner11: PublishedSharedSigner;
    let sharedSigner2: PublishedSharedSigner;
    let sharedSigner3: PublishedSharedSigner;
    let sharedSigner4: PublishedSharedSigner;
    let sharedSigner5: PublishedSharedSigner;
    let ownedSigner1: PublishedOwnedSigner;
    let ownedSigner2: PublishedOwnedSigner;
    let ownedSigner3: PublishedOwnedSigner;
    let ownedSigner4: PublishedOwnedSigner;
    let ownedSigner5: PublishedOwnedSigner;
    let smartVaultsWithAuthenticator2: SmartVaults // New instance of SmartVaults
    let smartVaultsWithAuthenticator3: SmartVaults
    let pubKey: string
    let pubKey2: string

    beforeAll(async () => {
      const authenticator2 = new DirectPrivateKeyAuthenticator(keySet1.keys[1].privateKey) // Second authenticator
      const authenticator3 = new DirectPrivateKeyAuthenticator(keySet1.keys[2].privateKey) // Third authenticator
      smartVaultsWithAuthenticator2 = new SmartVaults({ // New instance of SmartVaults with different authenticator
        authenticator: authenticator2,
        bitcoinUtil,
        nostrClient,
        network,
        authority
      });

      pubKey = keySet1.keys[1].publicKey
      pubKey2 = keySet1.keys[2].publicKey
      ownedSigner1 = await saveSharedSignerPayload(smartVaults, 1)
      let sharedSignerResult = await smartVaults.saveSharedSigner(ownedSigner1, pubKey)
      sharedSigner11 = (await smartVaults.saveSharedSigner(ownedSigner1, pubKey2))[0]
      sharedSigner1 = sharedSignerResult[0]
      ownedSigner2 = await saveSharedSignerPayload(smartVaults, 2)
      sharedSignerResult = await smartVaults.saveSharedSigner(ownedSigner2, pubKey)
      sharedSigner2 = sharedSignerResult[0]
      ownedSigner3 = await saveSharedSignerPayload(smartVaults, 3)
      sharedSignerResult = await smartVaults.saveSharedSigner(ownedSigner3, pubKey)
      sharedSigner3 = sharedSignerResult[0]

      smartVaultsWithAuthenticator3 = new SmartVaults({ // New instance of SmartVaults with different authenticator
        authenticator: authenticator3,
        bitcoinUtil,
        nostrClient,
        network,
        authority
      });

      ownedSigner4 = await saveSharedSignerPayload(smartVaultsWithAuthenticator3, 6)
      sharedSignerResult = await smartVaultsWithAuthenticator3.saveSharedSigner(ownedSigner4, pubKey)
      sharedSigner4 = sharedSignerResult[0]
      ownedSigner5 = await saveSharedSignerPayload(smartVaultsWithAuthenticator3, 7)
      sharedSignerResult = await smartVaultsWithAuthenticator3.saveSharedSigner(ownedSigner5, pubKey)
      sharedSigner5 = sharedSignerResult[0]


    })

    it('returns shared all signers (default)', async () => {
      const signers = await smartVaultsWithAuthenticator2.getSharedSigners(); // Using the new instance of SmartVaults
      expect(signers.length).toBe(5);
      expect(new Set(signers)).toEqual(new Set([sharedSigner1, sharedSigner2, sharedSigner3, sharedSigner4, sharedSigner5]));

      signers.forEach(signer => {
        expect(signer).toHaveProperty('ownerPubKey');
        expect(signer).toHaveProperty('descriptor');
        expect(signer).toHaveProperty('fingerprint');
      });
    });

    it('returns shared signers for a specific owner', async () => {
      if (!sharedSigner1.ownerPubKey) {
        throw new Error('SharedSigner1 ownerPubKey is undefined');
      }
      const signers1 = await smartVaultsWithAuthenticator2.getSharedSigners(sharedSigner1.ownerPubKey);
      expect(signers1.length).toBe(3);
      expect(new Set(signers1)).toEqual(new Set([sharedSigner1, sharedSigner2, sharedSigner3]));


      const signers2 = await smartVaultsWithAuthenticator2.getSharedSigners(sharedSigner4.ownerPubKey);
      expect(signers2.length).toBe(2);
      expect(new Set(signers2)).toEqual(new Set([sharedSigner4, sharedSigner5]))
    });

    it('returns all signer for an array of owners', async () => {

      if (!sharedSigner1.ownerPubKey || !sharedSigner4.ownerPubKey) {
        throw new Error('SharedSigner1 ownerPubKey is undefined');
      }
      const signers = await smartVaultsWithAuthenticator2.getSharedSigners([sharedSigner1.ownerPubKey, sharedSigner4.ownerPubKey]);
      expect(signers.length).toBe(5);
      expect(new Set(signers)).toEqual(new Set([sharedSigner1, sharedSigner2, sharedSigner3, sharedSigner4, sharedSigner5]));
    }
    );

    it('getMySharedSigners', async () => {
      const mySharedSigners = await smartVaults.getMySharedSigners();
      const mySharedSigner1 = [
        { id: sharedSigner11.id, sharedDate: sharedSigner1.createdAt, signerId: ownedSigner1.id, sharedWith: pubKey2 },
        { id: sharedSigner1.id, sharedDate: sharedSigner1.createdAt, signerId: ownedSigner1.id, sharedWith: pubKey }
      ]
      const mySharedSigner2 = { id: sharedSigner2.id, sharedDate: sharedSigner2.createdAt, signerId: ownedSigner2.id, sharedWith: pubKey }
      const mySharedSigner3 = { id: sharedSigner3.id, sharedDate: sharedSigner3.createdAt, signerId: ownedSigner3.id, sharedWith: pubKey }
      const expected1: Map<string, MySharedSigner | MySharedSigner[]> = new Map()
      expected1.set(ownedSigner3.id, mySharedSigner3);
      expected1.set(ownedSigner2.id, mySharedSigner2);
      expected1.set(ownedSigner1.id, mySharedSigner1);
      expect(mySharedSigners).toEqual(expected1)
    })

    it('revokeSharedSigner', async () => {
      await smartVaults.revokeMySharedSigners(sharedSigner1.id)
      await smartVaults.revokeMySharedSigners(sharedSigner11.id)
      const mySharedSigners = await smartVaults.getMySharedSigners();
      const mySharedSigner2 = { id: sharedSigner2.id, sharedDate: sharedSigner2.createdAt, signerId: ownedSigner2.id, sharedWith: pubKey }
      const mySharedSigner3 = { id: sharedSigner3.id, sharedDate: sharedSigner3.createdAt, signerId: ownedSigner3.id, sharedWith: pubKey }
      const expected1: Map<string, MySharedSigner | MySharedSigner[]> = new Map()
      expected1.set(ownedSigner3.id, mySharedSigner3);
      expected1.set(ownedSigner2.id, mySharedSigner2);
      expect(mySharedSigners).toEqual(expected1)
    })

    it('getContactSignersCount', async () => {
      const myPubKey = smartVaultsWithAuthenticator2.authenticator.getPublicKey()
      const count = await smartVaults.getContactSignersCount(myPubKey);
      expect(count).toEqual(0)
      const contact = new Contact({ publicKey: pubKey2 })
      await smartVaultsWithAuthenticator2.upsertContacts(contact);
      const count2 = await smartVaultsWithAuthenticator2.getContactSignersCount(myPubKey);
      expect(count2).toEqual(1)
      await sleep(100)
      await smartVaultsWithAuthenticator3.saveSharedSigner(ownedSigner4, myPubKey)
      const count3 = await smartVaultsWithAuthenticator2.getContactSignersCount(myPubKey);
      expect(count3).toEqual(1)
      const contact2 = new Contact({ publicKey: smartVaults.authenticator.getPublicKey() })
      await smartVaultsWithAuthenticator2.upsertContacts(contact2);
      const count4 = await smartVaultsWithAuthenticator2.getContactSignersCount(myPubKey);
      expect(count4).toEqual(2)
    })

  });

  describe('getProposals', () => {
    let spendProposal1;
    let spendProposal2;
    let spendProposal3;
    let proofOfReserveProposal1;
    let proofOfReserveProposal2;
    let proofOfReserveProposal3;
    let saveApprovedProposal1;
    let saveApprovedProposal2;
    let saveApprovedProposal3;
    let saveApprovedProposal4;
    let proposalApproved1;
    let proposalApproved2;
    let completedProposal2;
    let completedProposal3;
    let firstCallTime1;
    let firstCallTime2;
    let secondCallTime1;
    let secondCallTime2;
    let expectedTrx: FinalizeTrxResponse;
    let smartVaults2: SmartVaults
    let finalizedProposal;
    let policy1;

    beforeAll(async () => {


      smartVaults2 = newSmartVaults(altKeySet.mainKey())
      let wallet = mock<Wallet>()
      wallet.sync.mockResolvedValue()
      wallet.build_trx
        .mockResolvedValueOnce({ amount: 1000, psbt: "encoded psbt1" })
        .mockResolvedValueOnce({ amount: 2000, psbt: "encoded psbt2" })
        .mockResolvedValueOnce({ amount: 3000, psbt: "encoded psbt3" })
        .mockResolvedValueOnce({ amount: 4000, psbt: "encoded psbt4" })
        .mockResolvedValueOnce({ amount: 5000, psbt: "encoded psbt5" })
        .mockResolvedValueOnce({ amount: 6000, psbt: "encoded psbt6" })
      bitcoinUtil.createWallet.mockReturnValue(wallet)
      let mockTxid = Math.random().toString(36).substring(7)
      expectedTrx = { txid: mockTxid, psbt: "psbt1", trx: { inputs: ["input1"], txid: mockTxid, net: -1, confirmation_time: { confirmetAt: (new Date()).toString() } } }
      wallet.finalize_trx.mockResolvedValue(expectedTrx)
      bitcoinUtil.getTrxId.mockReturnValue(mockTxid)
      bitcoinUtil.getFee.mockReturnValue(420)
      bitcoinUtil.canFinalizePsbt.mockReturnValue(false)
      bitcoinUtil.getPsbtUtxos.mockReturnValue(['utxo1', 'utxo2'])
      jest.spyOn(smartVaults, 'getPsbtFromFileSystem').mockResolvedValue('psbt')
      jest.spyOn(smartVaults, 'signedPsbtSanityCheck').mockResolvedValue()
      let savePolicyPayload1 = getSavePolicyPayload(11, keySet1.getPublicKeys(), -10)
      policy1 = await smartVaults.savePolicy(savePolicyPayload1) // Policy 1 is created by authenticator 1
      let savePolicyPayload2 = getSavePolicyPayload(12, altKeySet.getPublicKeys(), -12)
      let policy2 = await smartVaults2.savePolicy(savePolicyPayload2) // Policy 2 is created by authenticator 2
      let payloadWithBothKeys = getSavePolicyPayload(13, [...keySet1.getPublicKeys(), ...altKeySet.getPublicKeys()], -13)
      let policy3 = await smartVaults.savePolicy(payloadWithBothKeys) // Policy 3 is created by authenticator 1 but has both keys
      let savePolicyPayload3 = getSavePolicyPayload(14, keySet1.getPublicKeys(), -14)
      let policy4 = await smartVaults.savePolicy(savePolicyPayload3)


      let spendProposalPayload1 = spendProposalPayload(11, policy1)
      let spendProposalPayload2 = spendProposalPayload(12, policy2)
      let spendProposalPayload3 = spendProposalPayload(13, policy3)

      spendProposal1 = await smartVaults.spend(spendProposalPayload1)
      spendProposal2 = await smartVaults2.spend(spendProposalPayload2)
      spendProposal3 = await smartVaults.spend(spendProposalPayload3)

      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(11)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(12)
      let saveProofOfReserveProposalPayload3 = saveProofOfReserveProposalPayload(13)

      proofOfReserveProposal1 = await smartVaults._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      proofOfReserveProposal2 = await smartVaults2._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)
      proofOfReserveProposal3 = await smartVaults._saveProofOfReserveProposal(policy3.id, saveProofOfReserveProposalPayload3)

      let keyAgentPaymentPayload1 = keyAgentPaymentPayload(14, policy4)
      keyAgentPaymentProposal1 = await smartVaults.spend(keyAgentPaymentPayload1) as PublishedKeyAgentPaymentProposal

      proposalApproved1 = proofOfReserveProposal3.proposal_id
      proposalApproved2 = spendProposal3.proposal_id

    }
    )
    it('save approvals', async () => {
      saveApprovedProposal1 = await smartVaults.saveApprovedProposal(proposalApproved1, 'signedPsbt')
      saveApprovedProposal2 = await smartVaults.saveApprovedProposal(proposalApproved2, 'signedPsbt')
      saveApprovedProposal3 = await smartVaults.saveApprovedProposal(proposalApproved2, 'signedPsbt')
      saveApprovedProposal4 = await smartVaults.saveApprovedProposal(proposalApproved1, 'signedPsbt')
    });

    const checkProposals = async (smartVaults: SmartVaults, expectedLength: number, expectedProposals: any) => {
      const proposals = await smartVaults.getProposals();
      expect(proposals.length).toBe(expectedLength);
      expect(new Set(proposals)).toEqual(new Set(expectedProposals));
    };

    it('returns proposals', async () => {
      const start = Date.now();
      await checkProposals(smartVaults, 5, [spendProposal1, proofOfReserveProposal1, proofOfReserveProposal3, spendProposal3, keyAgentPaymentProposal1]);
      firstCallTime1 = Date.now() - start;
      const start2 = Date.now();
      await checkProposals(smartVaults2, 4, [spendProposal2, proofOfReserveProposal2, proofOfReserveProposal3, spendProposal3]);
      firstCallTime2 = Date.now() - start2;
    });

    it('return proposal should be faster because of cache', async () => {
      const start = Date.now();
      await checkProposals(smartVaults, 5, [spendProposal1, proofOfReserveProposal1, proofOfReserveProposal3, spendProposal3, keyAgentPaymentProposal1]);
      secondCallTime1 = Date.now() - start;
      const start2 = Date.now();
      await checkProposals(smartVaults2, 4, [spendProposal2, proofOfReserveProposal2, proofOfReserveProposal3, spendProposal3]);
      secondCallTime2 = Date.now() - start2;
      expect(secondCallTime1).toBeLessThan(firstCallTime1);
      expect(secondCallTime2).toBeLessThan(firstCallTime2);
    });

    it('getProposals should be sensible to status changes', async () => {
      bitcoinUtil.canFinalizePsbt.mockReturnValue(true)
      const proposals = await smartVaults.getProposalsById([proposalApproved1, proposalApproved2]);
      expect(proposals.size).toBe(2);
      for (const proposal of Array.from(proposals.values())) {
        expect(proposal).toHaveProperty('status');
        expect(proposal.status).toBe(ProposalStatus.Signed);
      }
      bitcoinUtil.canFinalizePsbt.mockReturnValue(false)
    });


    it('getProposalsById', async () => {
      const proposals = await smartVaults.getProposalsById([spendProposal1.proposal_id, spendProposal3.proposal_id, keyAgentPaymentProposal1.proposal_id]);
      expect(proposals.size).toBe(3);
      expect(new Set(Array.from(proposals.values()))).toEqual(new Set([spendProposal1, spendProposal3, keyAgentPaymentProposal1]));
    });

    it('getProposalsByPolicyId', async () => {
      const policyId1 = spendProposal1.policy_id;
      const policyId3 = spendProposal3.policy_id;
      const expectedMap = new Map([
        [policyId1, [proofOfReserveProposal1, spendProposal1]],
        [policyId3, [proofOfReserveProposal3, spendProposal3]]
      ]);
      const proposals = await smartVaults.getProposalsByPolicyId([spendProposal1.policy_id, spendProposal3.policy_id]);
      expect(proposals.size).toBe(2);
      expect(Array.from(proposals.values()).sort).toEqual(Array.from(expectedMap.values()).sort);
    });

    it('returns proposals with limit works', async () => {
      const proposalsAuth1 = await smartVaults.getProposals({ limit: 2 });
      const proposalsAuth2 = await smartVaults2.getProposals({ limit: 3 });
      expect(proposalsAuth1.length).toBe(2);
      expect(proposalsAuth2.length).toBe(3);
    });

    it('sent proposal direct messages', async () => {

      // Each set of keys creates one SpendProposal (1 and 2), SpendProposal3 is created by auth 1 but has both keys in the policy
      // hence the message is sent to both Auth 1 and Auth 2.

      let smartVaults = newSmartVaults(keySet1.keys[1])
      let directMessages = await smartVaults.getDirectMessages();
      expect(directMessages.length).toBe(3) // 3 proposals sent by key 1
      let publicKeyAuth1 = keySet1.mainKey().publicKey
      assertProposalDirectMessage(directMessages[1], spendProposal3, publicKeyAuth1)
      assertProposalDirectMessage(directMessages[2], spendProposal1, publicKeyAuth1)
      assertProposalDirectMessage(directMessages[0], keyAgentPaymentProposal1, publicKeyAuth1)

      smartVaults = newSmartVaults(altKeySet.keys[1])
      directMessages = await smartVaults.getDirectMessages();
      let publicKeyAuth2 = altKeySet.mainKey().publicKey
      expect(directMessages.length).toBe(2)
      assertProposalDirectMessage(directMessages[0], spendProposal3, publicKeyAuth1)
      assertProposalDirectMessage(directMessages[1], spendProposal2, publicKeyAuth2)
    });



    const checkApprovals = async (expectedSize: number, expectedProposals: Record<string, PublishedApprovedProposal[]>) => {
      const approvedProposals = await smartVaults.getApprovals();
      expect(approvedProposals.size).toBe(expectedSize);

      for (const [proposalId, expected] of Object.entries(expectedProposals)) {
        const approvals = approvedProposals.get(proposalId);
        expect(approvals).toBeDefined();
        expect(approvals).toHaveLength(expected.length);
        expect(new Set(approvals)).toEqual(new Set(expected));
      }
    };

    it('getApprovals retrieves all proposals', async () => {
      const expectedProposals = {
        [proposalApproved1]: [saveApprovedProposal1, saveApprovedProposal4],
        [proposalApproved2]: [saveApprovedProposal2, saveApprovedProposal3]
      };

      await checkApprovals(Object.keys(expectedProposals).length, expectedProposals);
    });

    it('getApprovals retrieves correct proposals when passing array of proposal_ids', async () => {
      const proposalIds = [saveApprovedProposal1.proposal_id, saveApprovedProposal2.proposal_id];
      const expectedProposals = {
        [proposalApproved1]: [saveApprovedProposal1, saveApprovedProposal4],
        [proposalApproved2]: [saveApprovedProposal2, saveApprovedProposal3]
      };

      await checkApprovals(proposalIds.length, expectedProposals);

      for (const proposalId of proposalIds) {
        const singleApprovedProposal = await smartVaults.getApprovals([proposalId]);
        expect(singleApprovedProposal.size).toBe(1);
      }
    });

    it('save completed proposals', async () => {
      completedProposal2 = await smartVaults._saveCompletedProposal(proposalApproved1, saveProofOfReserveProposalPayload(12))
      completedProposal3 = await smartVaults2._saveCompletedProposal(proposalApproved2, saveProofOfReserveProposalPayload(13))
    });
    it('returns completed proposals', async () => {
      const completedProposals = await smartVaults.getCompletedProposals();
      expect(completedProposals.length).toBe(2);
      expect(new Set(completedProposals)).toEqual(new Set([completedProposal2, completedProposal3]));
      let activeProposalsAuth1 = await smartVaults.getProposals();
      expect(activeProposalsAuth1.length).toBe(3);
      let activeProposalsAuth2 = await smartVaults2.getProposals();
      expect(activeProposalsAuth2.length).toBe(2);
    });

    it('getCompletedProposalsById', async () => {
      const proposals = await smartVaults.getCompletedProposalsById([completedProposal2.id, completedProposal3.id]);
      expect(proposals.size).toBe(2);
      expect(proposals.get(completedProposal2.id)).toEqual(completedProposal2);
      expect(proposals.get(completedProposal3.id)).toEqual(completedProposal3);
    }
    );

    it('getCompletedProposalsByPolicyId', async () => {
      const policyId1 = completedProposal2.policy_id;
      const expectedMap1 = new Map([[policyId1, [completedProposal3, completedProposal2]]]);
      const proposals1 = await smartVaults.getCompletedProposalsByPolicyId([policyId1]);
      expect(proposals1.size).toBe(1);
      expect(proposals1).toEqual(expectedMap1);
    }
    );


    it('deleteProposals works', async () => {
      const spendProposal = await smartVaults.getProposalsById([spendProposal3.proposal_id]);
      const approvals = await smartVaults.getApprovals([spendProposal3.proposal_id]);
      expect(spendProposal.size).toBe(1);
      expect(approvals.size).toBe(1);
      expect(approvals.get(spendProposal3.proposal_id)!.length).toBe(2);
      await smartVaults.deleteProposals(spendProposal3.proposal_id)
      await sleep(200)
      const proposals = await smartVaults.getProposalsById([spendProposal3.proposal_id]);
      const approvals2 = await smartVaults.getApprovals([spendProposal3.proposal_id]);
      expect(proposals.size).toBe(0);
      expect(approvals2.size).toBe(0);
    }
    );

    it('finalizeSpendingProposal works', async () => {
      bitcoinUtil.canFinalizePsbt.mockReturnValue(true)
      bitcoinUtil.getPsbtUtxos.mockReturnValue(['utxo1', 'otherUtxo'])
      await smartVaults.saveApprovedProposal(spendProposal1.proposal_id, 'signedPsbt')
      const proposalWithOneCommonUtxo = await smartVaults.spend(spendProposalPayload(22, policy1))
      await smartVaults.getProposals()
      bitcoinUtil.getPsbtUtxos.mockReturnValue(['nocommon', 'utxos'])
      const proposalWithNoCommonUtxo = await smartVaults.spend(spendProposalPayload(23, policy1))
      const proposalsBefore = await smartVaults.getProposals()
      expect(proposalsBefore.length).toBe(5)
      expect(proposalsBefore[1]).toEqual(proposalWithOneCommonUtxo)
      finalizedProposal = await smartVaults.finalizeSpendingProposal(spendProposal1.proposal_id)
      const proposalsAfter = await smartVaults.getProposals()
      expect(proposalsAfter.length).toBe(2)
      expect(proposalsAfter[0]).toEqual(proposalWithNoCommonUtxo)
      expect(finalizedProposal.tx).toEqual(expectedTrx.trx)
      expect(finalizedProposal.description).toEqual(spendProposal1.description)
      const completedProposalsMap = await smartVaults.getCompletedProposalsById(finalizedProposal.id);
      expect(completedProposalsMap.size).toBe(1);
      expect(completedProposalsMap.get(finalizedProposal.id)).toEqual(finalizedProposal);
    }
    );

    it('getCompletedProposalByTx works', async () => {
      const completedProposal = await smartVaults.getCompletedProposalByTx(expectedTrx.trx)
      const expectedCompletedProposal = await smartVaults.getCompletedProposalsById([finalizedProposal.id])
      expect(completedProposal).toEqual(expectedCompletedProposal.get(finalizedProposal.id))
    }
    );

    it('deleteApprovals works', async () => {
      await smartVaults.deleteApprovals([saveApprovedProposal1.approval_id, saveApprovedProposal4.approval_id])
      await sleep(200)
      const approvedProposals = await smartVaults.getApprovals([proposalApproved1]);
      expect(approvedProposals.size).toBe(0);
    }
    );

    it('deleteCompletedProposals works', async () => {
      const completedProposals = await smartVaults.getCompletedProposalsById([completedProposal2.id, completedProposal3.id]);
      expect(completedProposals.size).toBe(2);
      await smartVaults.deleteCompletedProposals([completedProposal2.id, completedProposal3.id])
      await sleep(200)
      const completedProposals2 = await smartVaults.getCompletedProposalsById([completedProposal2.id, completedProposal3.id]);
      expect(completedProposals2.size).toBe(0);
    }
    );

    it('getLabels work', async () => {
      const label = await smartVaults.saveLabel(spendProposal1.policy_id, { data: { 'address': 'address1' }, text: 'text' })
      const TrxLabel = await smartVaults.saveLabel(spendProposal1.policy_id, { data: { 'Spend': expectedTrx.txid }, text: spendProposal1.description })
      const fetchedLabels = await smartVaults.getLabels()
      expect(fetchedLabels.length).toBe(2)
      expect(new Set(fetchedLabels)).toEqual(new Set([TrxLabel, label]))
      const label2 = await smartVaults.saveLabel(spendProposal1.policy_id, { data: { 'address': 'address2' }, text: 'text2' })
      const labelsByPolicyId = await smartVaults.getLabelsByPolicyId([spendProposal1.policy_id])
      expect(labelsByPolicyId.size).toBe(1)
      expect(labelsByPolicyId.get(spendProposal1.policy_id)).toEqual([TrxLabel, label, label2])
      await sleep(300)
      const label3 = await smartVaults.saveLabel(spendProposal1.policy_id, { data: { 'address': 'address1' }, text: 'text3' })
      const fetchedLabels2 = await smartVaults.getLabels()
      expect(fetchedLabels2.length).toBe(3)
      expect(new Set(fetchedLabels2)).toEqual(new Set([TrxLabel, label3, label2]))
      const labelByLabelId = await smartVaults.getLabelById(label3.label_id)
      expect(labelByLabelId.get(label3.label_id)).toEqual(label3)
      const labelByLabelData = await smartVaults.getLabelByLabelData(spendProposal1.policy_id, label3.label.data.address)
      const labelByLabelData2 = await smartVaults.getLabelByLabelData(spendProposal1.policy_id, label2.label.data.address)
      expect(labelByLabelData).toEqual(label3)
      expect(labelByLabelData2).toEqual(label2)
    }
    )

  });

  describe('Key Agents', () => {
    let keyAgent1: KeyAgent
    let keyAgent2: KeyAgent
    let smartVaults2: SmartVaults
    let smartVaults3: SmartVaults
    let ownedSigner1: PublishedOwnedSigner
    let signerOffering1: PublishedSignerOffering
    let completedKeyAgentPaymentProposal1: PublishedCompletedKeyAgentPaymentProposal
    beforeAll(() => {
      smartVaults2 = newSmartVaults(altKeySet.mainKey())
      const keys = new KeySet(1)
      smartVaults3 = newSmartVaults(keys.mainKey())
    }
    );

    it('saveKeyAgent works', async () => {
      const keyAgentMetadata1: KeyAgentMetadata = { jurisdiction: "some jurisdiction", x: "https://twitter.com/smartvaults_1", facebook: "https://facebook.com/smartvaults_1" }
      const keyAgentMetadata2: KeyAgentMetadata = { jurisdiction: "some jurisdiction", x: "https://twitter.com/smartvaults_2", facebook: "https://facebook.com/smartvaults_2" }
      keyAgent1 = await smartVaults.saveKeyAgent(keyAgentMetadata1)
      keyAgent2 = await smartVaults2.saveKeyAgent(keyAgentMetadata2)
      const expected = [keyAgent1, keyAgent2]
      const keyAgents = await smartVaults.getUnverifiedKeyAgents()
      expect(keyAgents).toEqual(expect.arrayContaining(expected))
    });

    it('saveKeyAgent updates metadata if user is already a key agent', async () => {
      const keyAgentMetadata: KeyAgentMetadata = { jurisdiction: "other jurisdiction", x: "https://twitter.com/smartvaults", facebook: "https://facebook.com/smartvaults" }
      keyAgent1 = await smartVaults.saveKeyAgent(keyAgentMetadata)
      const updatedMetadata = await smartVaults.getProfile()
      expect(updatedMetadata.jurisdiction).toEqual(keyAgentMetadata.jurisdiction)
      expect(updatedMetadata.x).toEqual(keyAgentMetadata.x)
      expect(updatedMetadata.facebook).toEqual(keyAgentMetadata.facebook)
      expect(updatedMetadata).toEqual(keyAgent1.profile)
    });

    it('getUnverifiedKeyAgentsByPubKey works', async () => {
      const pubkey = keyAgent1.profile.publicKey
      const keyAgents = await smartVaults.getUnverifiedKeyAgentsByPubKeys([pubkey])
      expect(keyAgents.size).toBe(1)
      expect(keyAgents.get(pubkey)).toEqual(keyAgent1)
    });

    it('saveSignerOffering works', async () => {
      const signerOffering: SignerOffering = { temperature: 'cold', device_type: 'coldcard', response_time: 5, cost_per_signature: { amount: 100, currency: FiatCurrency.USD }, yearly_cost: { amount: 1000, currency: FiatCurrency.USD } }
      ownedSigner1 = (await smartVaults.getOwnedSigners())[0]
      signerOffering1 = await smartVaults.saveSignerOffering(ownedSigner1, signerOffering, async () => false)
      const offering = await smartVaults.getOwnedSignerOfferingsBySignerFingerprint([ownedSigner1.fingerprint])
      expect(offering.size).toBe(1)
      expect(offering.get(ownedSigner1.fingerprint)).toEqual(signerOffering1)
    });

    it('saveSignerOffering throws error if user is not a key agent', async () => {
      const signerOffering: SignerOffering = { temperature: 'cold', device_type: 'coldcard', response_time: 5 }
      const ownedSigner = {} as PublishedOwnedSigner
      await expect(smartVaults3.saveSignerOffering(ownedSigner, signerOffering, async () => false)).rejects.toThrowError('Only key agents can create signer offerings')
    });

    it('saveSignerOffering throws error if a signer offering already exists for the signer and user cancels', async () => {
      const signerOffering = {} as SignerOffering
      await expect(smartVaults.saveSignerOffering(ownedSigner1, signerOffering, async () => false)).rejects.toThrowError('Canceled by user.')
    });

    it('getContactsSignerOfferingsBySignerDescriptor works', async () => {
      const offering = await smartVaults.saveSignerOffering(ownedSigner1, { temperature: 'cold', device_type: 'coldcard', response_time: 5 }, async () => true)
      const signerOfferings = await smartVaults2.getContactsSignerOfferingsBySignerDescriptor([ownedSigner1.descriptor])
      expect(signerOfferings.size).toBe(0)
      await smartVaults2.upsertContacts(new Contact({ publicKey: keyAgent1.profile.publicKey }))
      await smartVaults.saveSharedSigner(ownedSigner1, smartVaults2.authenticator.getPublicKey())
      await sleep(100)
      const signerOfferings2 = await smartVaults2.getContactsSignerOfferingsBySignerDescriptor([ownedSigner1.descriptor])
      expect(signerOfferings2.size).toBe(1)
      expect(signerOfferings2.get(ownedSigner1.descriptor)).toEqual(offering)
    });

    it('getVerifiedKeyAgentsPubkeys returns empty array if no key agents are verified', async () => {
      const keyAgents = await smartVaults.getVerifiedKeyAgentsPubKeys()
      expect(keyAgents).toEqual([])
    });

    it('saveVerifiedKeyAgent works', async () => {
      const pubkey = smartVaults.authenticator.getPublicKey()
      const expected = await smartVaults.saveVerifiedKeyAgent(pubkey)
      const keyAgent = await smartVaults.getVerifiedKeyAgents()
      expect(keyAgent.length).toBe(1)
      expect(keyAgent[0]).toEqual(expected)
    });

    it('getVerifiedKeyAgentsPubkeys returns verified key agents pubkeys', async () => {
      const keyAgents = await smartVaults.getVerifiedKeyAgentsPubKeys()
      expect(keyAgents).toEqual([smartVaults.authenticator.getPublicKey()])
    });

    it('removeVerifiedKeyAgent works', async () => {
      const pubkey = smartVaults.authenticator.getPublicKey()
      await smartVaults.removeVerifiedKeyAgent(pubkey)
      const keyAgents = await smartVaults.getVerifiedKeyAgentsPubKeys()
      expect(keyAgents).toEqual([])
    });

    it('saveVerifiedKeyAgent throws error if user is not authority', async () => {
      const pubkey = smartVaults2.authenticator.getPublicKey()
      await expect(smartVaults2.saveVerifiedKeyAgent(pubkey)).rejects.toThrowError('Unauthorized')
    });

    it('getPaymenOptions works', async () => {
      const paymentOptions = smartVaults.getPaymentOptions(signerOffering1)
      expect(paymentOptions.length).toBe(2)
      expect(paymentOptions).toEqual([PaymentType.PerSignature, PaymentType.YearlyCost])
    });

    it('getSuggestedPaymentPeriod works with no previous key agent payment', async () => {
      const policy = (await smartVaults.getPoliciesById([keyAgentPaymentProposal1.policy_id])).get(keyAgentPaymentProposal1.policy_id)!
      const suggestedPaymentPeriod = await smartVaults.getSuggestedPaymentPeriod(policy, keyAgentPaymentProposal1.signer_descriptor)
      const oneYear = TimeUtil.fromYearsToSeconds(1)
      const start = TimeUtil.toSeconds(policy.createdAt.getTime())
      const expected = { start: start, end: start + oneYear }
      expect(suggestedPaymentPeriod).toEqual(expected)
    })

    it('hasActiveKeyAgentPaymentProposal works', async () => {
      const hasActiveKeyAgentPaymentProposal1 = await smartVaults.hasActiveKeyAgentPaymentProposal(keyAgentPaymentProposal1.policy_id, keyAgentPaymentProposal1.signer_descriptor)
      expect(hasActiveKeyAgentPaymentProposal1).toEqual(true)
      const hasActiveKeyAgentPaymentProposal2 = await smartVaults.hasActiveKeyAgentPaymentProposal(keyAgentPaymentProposal1.policy_id, 'other signer descriptor')
      expect(hasActiveKeyAgentPaymentProposal2).toEqual(false)
    });



    it('getLastCompletedKeyAgentPaymentProposal works', async () => {
      let approvalsMap: Map<string, PublishedApprovedProposal[]> = new Map()
      approvalsMap.set(keyAgentPaymentProposal1.proposal_id, [{} as PublishedApprovedProposal])
      jest.spyOn(smartVaults, 'getApprovals').mockResolvedValue(approvalsMap)
      completedKeyAgentPaymentProposal1 = await smartVaults.finalizeSpendingProposal(keyAgentPaymentProposal1.proposal_id) as PublishedCompletedKeyAgentPaymentProposal
      const lastCompletedKeyAgentPaymentProposal = await smartVaults.getLastCompletedKeyAgentPaymentProposal(keyAgentPaymentProposal1.policy_id, keyAgentPaymentProposal1.signer_descriptor)
      expect(lastCompletedKeyAgentPaymentProposal).toEqual(completedKeyAgentPaymentProposal1)
    });


    it('getSuggestedPaymentPeriod works if there is there is previuos key agent payment', async () => {
      const policy = (await smartVaults.getPoliciesById([keyAgentPaymentProposal1.policy_id])).get(keyAgentPaymentProposal1.policy_id)!
      const suggestedPaymentPeriod = await smartVaults.getSuggestedPaymentPeriod(policy, keyAgentPaymentProposal1.signer_descriptor)
      const oneYear = TimeUtil.fromYearsToSeconds(1)
      const oneDay = TimeUtil.fromDaysToSeconds(1)
      const start = TimeUtil.toSeconds(completedKeyAgentPaymentProposal1.completion_date.getTime()) + oneDay
      const expected = { start, end: start + oneYear }
      expect(suggestedPaymentPeriod).toEqual(expected)
    });

    it('getSuggestedPaymentAmount works', async () => {
      const policy = (await smartVaults.getPoliciesById([keyAgentPaymentProposal1.policy_id])).get(keyAgentPaymentProposal1.policy_id)!
      const suggestedPaymentAmount = await smartVaults.getSuggestedPaymentAmount(signerOffering1, PaymentType.YearlyCost, policy, keyAgentPaymentProposal1.signer_descriptor)
      expect(suggestedPaymentAmount).toEqual(signerOffering1.yearly_cost!.amount)
    });

  });

  function newSmartVaults(keys: Keys): SmartVaults {
    return new SmartVaults({
      authenticator: new DirectPrivateKeyAuthenticator(keys.privateKey),
      bitcoinUtil,
      nostrClient,
      network,
      authority
    })
  }

})

function assertPublishedPolicy(actual: PublishedPolicy, expected: PublishedPolicy) {
  expect(actual.id).toBe(expected.id)
  expect(actual.name).toBe(expected.name)
  expect(actual.description).toBe(expected.description)
  expect(actual.descriptor).toBe(expected.descriptor)
  expect(actual.createdAt).toEqual(expected.createdAt)
  expect(actual.nostrPublicKeys).toEqual(expected.nostrPublicKeys)
  expect(actual.sharedKeyAuth).toBeDefined()
  expect(expected.sharedKeyAuth).toBeDefined()
}

function assertSubscriptionPolicyPayload(kind: number, actual: any, savePayload: SavePolicyPayload) {
  expect(kind).toBe(SmartVaultsKind.Policy)
  expect(actual).toBeInstanceOf(PublishedPolicy)
  expect(actual.name).toBe(savePayload.name)
  expect(actual.description).toBe(savePayload.description)
  expect(actual.nostrPublicKeys).toEqual(savePayload.nostrPublicKeys)
  expect(actual.sharedKeyAuth).toBeDefined()

}

function assertSubscriptionSharedSignerPayload(kind: number, payload: any, expectedPayload: PublishedOwnedSigner) {
  expect(kind).toBe(SmartVaultsKind.SharedSigners)
  expect(payload.descriptor).toEqual(expectedPayload.descriptor)
  expect(payload.fingerprint).toEqual(expectedPayload.fingerprint)
  expect(payload.ownerPubKey).toEqual(expectedPayload.ownerPubKey)
}

function assertSubscriptionOwnedSignerPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(SmartVaultsKind.Signers)
  expect(payload.descriptor).toEqual(expectedPayload.descriptor)
  expect(payload.fingerprint).toEqual(expectedPayload.fingerprint)
  expect(payload.ownerPubKey).toEqual(expectedPayload.ownerPubKey)
  expect(payload.name).toEqual(expectedPayload.name)
  expect(payload.t).toEqual(expectedPayload.t)
  expect(payload.description).toEqual(expectedPayload.description)
}



function assertSubscriptionSpendProposalPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(SmartVaultsKind.Proposal)
  expect(payload).toEqual(expectedPayload)
}

function assertSubscriptionProofOfReserveProposalPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(SmartVaultsKind.Proposal)
  expect(payload).toEqual(expectedPayload)
}

function assertSubscriptionApprovedProposalPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(SmartVaultsKind.ApprovedProposal)
  expect(payload).toEqual(expectedPayload)
}

function assertSubscriptionCompletedProposalPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(SmartVaultsKind.CompletedProposal)
  expect(payload).toEqual(expectedPayload)
}

function assertSubscriptionMetadataPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(Kind.Metadata)
  expect(payload).toEqual(expectedPayload)
}

function assertSubscriptionContactPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(Kind.Contacts)
  expect(payload).toEqual(expectedPayload)
}

function assertProposalDirectMessage(directMessage: PublishedDirectMessage, proposal: PublishedSpendingProposal, pubkey: string) {
  expect(directMessage.publicKey).toBe(pubkey)
  expect(directMessage.message).toContain(`Amount: ${proposal.amount}`)
  expect(directMessage.message).toContain(`Description: ${proposal.description}`)
}

function getSavePolicyPayload(id: number, nostrPublicKeys: string[], secondsShift: number = 0): SavePolicyPayload {
  let createdAt = TimeUtil.addSeconds(secondsShift)
  return {
    name: `policy${id}`,
    description: `policy desc ${id}`,
    miniscript: `miniscript ${id}`,
    nostrPublicKeys,
    createdAt
  }
}

function getMetadata(id: number): Metadata {
  return {
    name: `name${id}`,
    display_name: `display_name${id}`,
    about: `about ${id}`,
    picture: `about ${id}`
  }
}

function getContact(id: number, publicKey: string): Contact {
  return new Contact({
    publicKey,
    relay: `relay ${id}`,
    petname: `petname ${id}`,
  })
}

async function setProfile(id: number, smartVaults: SmartVaults): Promise<Profile> {
  const metadata = getMetadata(id)
  const auth = new DirectPrivateKeyAuthenticator(new Keys().privateKey)
  smartVaults.setAuthenticator(auth)
  return await smartVaults.setProfile(metadata)
}

async function saveSharedSignerPayload(smartVaults: SmartVaults, id: number): Promise<PublishedOwnedSigner> {
  const ownedSigner = await smartVaults.saveOwnedSigner({
    description: `description${id}`,
    descriptor: `tr([xpubdescriptor${id}/*)#123`,
    fingerprint: `fingerprint${id}`,
    name: `name${id}`,
    t: `t${id}`,
  })
  return ownedSigner
}

function saveOwnedSignerPayload(id: number, ownerPubKey: string) {
  return {
    descriptor: `tr([xpubdescriptor${id}/*)#123`,
    fingerprint: `fingerprint${id}`,
    ownerPubKey,
    name: `name${id}`,
    t: `t${id}`,
    description: `description${id}`,
  }
}

function spendProposalPayload(id: number, policy: PublishedPolicy): SpendProposalPayload {
  return {
    policy,
    to_address: `to_address${id}`,
    description: `description${id}`,
    amountDescriptor: "1000",
    feeRatePriority: "low",
  }
}

function saveProofOfReserveProposalPayload(id: number) {
  return {
    "ProofOfReserve": {
      descriptor: `xpubdescriptor${id}`,
      message: `message${id}`,
      psbt: `psbt${id}`,
    }
  }
}

function keyAgentPaymentPayload(id: number, policy: PublishedPolicy): SpendProposalPayload {
  return {
    policy,
    to_address: `to_address${id}`,
    description: `description${id}`,
    amountDescriptor: "1000",
    feeRatePriority: "low",
    keyAgentPayment: { signer_descriptor: `xpubdescriptor${id}`, period: { start: 1 + id, end: 2 + id } }
  }
}

async function _deleteApprovals(ids: string[], smartVaults: SmartVaults): Promise<void> {
  const pubKey = smartVaults.authenticator.getPublicKey()
  const promises: Promise<any>[] = [];
  const proposalParticipants = ['p', pubKey];
  const eventTags = ids.map(id => ['e', id]);
  const deleteEvent = await buildEvent({
    kind: Kind.EventDeletion,
    content: '',
    tags: [...eventTags, proposalParticipants],
  }, smartVaults.authenticator);
  const pub = smartVaults.nostrClient.publish(deleteEvent);
  promises.push(pub.onFirstOkOrCompleteFailure());
  await Promise.all(promises);
}

async function _deleteProposals(ids: string[], smartVaults: SmartVaults): Promise<any> {
  const pubKey = smartVaults.authenticator.getPublicKey()
  const promises: Promise<any>[] = [];
  const proposalParticipants = ['p', pubKey];
  for (const id of ids) {
    const proposal = (await smartVaults.getProposalsById([id]))?.get(id);
    if (!proposal) continue
    const sharedKeyAuth = (await smartVaults.getSharedKeysById([proposal.policy_id])).get(proposal.policy_id)!.sharedKeyAuthenticator;
    const deleteEvent = await buildEvent({
      kind: Kind.EventDeletion,
      content: '',
      tags: [['e', id], proposalParticipants],
    }, sharedKeyAuth);
    const pub = smartVaults.nostrClient.publish(deleteEvent);
    promises.push(pub.onFirstOkOrCompleteFailure());
  }
  await Promise.all(promises);
}

async function _deletePolicies(ids: string[], smartVaults: SmartVaults): Promise<any> {
  const pubKey = smartVaults.authenticator.getPublicKey()
  const promises: Promise<any>[] = [];
  const proposalParticipants = ['p', pubKey];
  for (const id of ids) {
    const policy = (await smartVaults.getPoliciesById([id]))?.get(id);
    if (!policy) continue
    const sharedKeyAuth = policy.sharedKeyAuth;
    const deleteEvent = await buildEvent({
      kind: Kind.EventDeletion,
      content: '',
      tags: [['e', id], proposalParticipants],
    }, sharedKeyAuth);
    const pub = smartVaults.nostrClient.publish(deleteEvent);
    promises.push(pub.onFirstOkOrCompleteFailure());
  }
  await Promise.all(promises);
}





class KeySet {
  keys: Keys[]
  constructor(numPeerKeys: number, mainKey = new Keys()) {
    this.keys = [mainKey]
    for (let i = 0; i < numPeerKeys; i++) {
      this.keys.push(new Keys())
    }
  }

  getPublicKeys(): string[] {
    return this.keys.map(k => k.publicKey)
  }

  derive(numPeerKeys: number): KeySet {
    return new KeySet(numPeerKeys, this.keys[0])
  }

  mainKey(): Keys {
    return this.keys[0]
  }
}
