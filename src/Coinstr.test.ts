import sleep from 'await-sleep'
import { MockProxy, mock } from 'jest-mock-extended'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Coinstr } from './Coinstr'
import { NostrClient, Keys, Store } from './service'
import { TimeUtil } from './util'
import { Contact, PublishedPolicy, BitcoinUtil, Wallet, type FinalizeTrxResponse } from './models'
import { Metadata, Profile, SavePolicyPayload, OwnedSigner, SharedSigner, SpendProposalPayload, PublishedDirectMessage, PublishedSpendingProposal, PublishedApprovedProposal, PublishedSharedSigner } from './types'
import { CoinstrKind } from './enum'
import { Kind } from 'nostr-tools'
jest.setTimeout(1000000);

describe('Coinstr', () => {
  let coinstr: Coinstr
  let nostrClient: NostrClient
  let authenticator: DirectPrivateKeyAuthenticator
  let bitcoinUtil: MockProxy<BitcoinUtil>
  let keySet1
  let keySet2
  let altKeySet

  beforeAll(async () => {
    keySet1 = new KeySet(3)
    keySet2 = keySet1.derive(2)
    altKeySet = new KeySet(2)
    nostrClient = new NostrClient([
      //'wss://relay.rip',
      'wss://test.relay.report'
      //'ws://localhost:7777'
    ])
    bitcoinUtil = mock<BitcoinUtil>()
    bitcoinUtil.toDescriptor.mockReturnValue("Descriptor")
    authenticator = new DirectPrivateKeyAuthenticator(keySet1.mainKey().privateKey)
    coinstr = new Coinstr({
      authenticator,
      bitcoinUtil,
      nostrClient
    })

  })

  afterEach(() => {
    coinstr.disconnect()
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
      profile1 = await setProfile(1, coinstr)
      profile2 = await setProfile(2, coinstr)
      profile3 = await setProfile(3, coinstr)
      coinstr.setAuthenticator(authenticator)
      profile4 = await coinstr.setProfile(getMetadata(420))

      contact1 = getContact(1, profile1.publicKey)
      contact2 = getContact(2, profile2.publicKey)
      contact3 = getContact(3, profile3.publicKey)
      await coinstr.upsertContacts([contact1, contact2, contact3])
    })

    it('getProfile', async () => {
      const profile = await coinstr.getProfile(profile1.publicKey)
      expect(profile).toEqual(profile1)
      const own_profile = await coinstr.getProfile(profile4.publicKey)
      expect(own_profile).toEqual(profile4)
      profile5 = await coinstr.setProfile(getMetadata(69))
      const own_profile2 = await coinstr.getProfile(profile5.publicKey)
      expect(own_profile2).toEqual(profile5)
    })

    it('getContacts', async () => {
      const contacts = await coinstr.getContacts()
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
      const profiles = await coinstr.getContactProfiles()
      expect(profiles.length).toBe(3)
      expect(profiles).toEqual(expect.arrayContaining(
        [
          { ...contact1, ...profile1 },
          { ...contact2, ...profile2 },
          { ...contact3, ...profile3 },
        ]
      ))
    })

  })

  describe('getPolicies', () => {
    let policy1: PublishedPolicy
    let policy2: PublishedPolicy
    let policy3: PublishedPolicy

    beforeAll(async () => {
      let savePayload = getSavePolicyPayload(1, keySet1.getPublicKeys(), -20)
      policy1 = await coinstr.savePolicy(savePayload)
      savePayload = getSavePolicyPayload(2, keySet1.getPublicKeys(), -10)
      policy2 = await coinstr.savePolicy(savePayload)
      savePayload = getSavePolicyPayload(3, keySet2.getPublicKeys())
      policy3 = await coinstr.savePolicy(savePayload)

    })

    // it('lee policies', async () => {
    //   coinstr.setAuthenticator(new DirectPrivateKeyAuthenticator("3fec18a9e196fd3a6417b45fad7005edb23d8529cb41d8ac738cfdd7d2b75677"))
    //   const policies = await coinstr.getPolicies()
    //   // expect(policies.length).toBe(3)
    //   // expect(policies[0]).toEqual(policy3)
    //   // expect(policies[1]).toEqual(policy2)
    //   // expect(policies[2]).toEqual(policy1)
    // })

    it('all policies works', async () => {
      const policies = await coinstr.getPolicies()
      expect(policies.length).toBe(3)
      assertPublishedPolicy(policies[0], policy3)
      assertPublishedPolicy(policies[1], policy2)
      assertPublishedPolicy(policies[2], policy1)
    })

    it('since works', async () => {
      let policies = await coinstr.getPolicies({ since: policy2.createdAt })
      expect(policies.length).toBe(2)
      assertPublishedPolicy(policies[0], policy3)
      assertPublishedPolicy(policies[1], policy2)

      policies = await coinstr.getPolicies({ since: policy3.createdAt })
      expect(policies.length).toBe(1)
      assertPublishedPolicy(policies[0], policy3)
    })

    it('until works', async () => {
      let policies = await coinstr.getPolicies({ until: policy2.createdAt })
      expect(policies.length).toBe(1)
      assertPublishedPolicy(policies[0], policy1)

      policies = await coinstr.getPolicies({ until: policy1.createdAt })
      expect(policies.length).toBe(0)
    })

    it('limit works', async () => {
      let policies = await coinstr.getPolicies({ limit: 2 })
      expect(policies.length).toBe(2)
      assertPublishedPolicy(policies[0], policy3)
      assertPublishedPolicy(policies[1], policy2)

      policies = await coinstr.getPolicies({ since: policy2.createdAt, limit: 1 })
      expect(policies.length).toBe(1)
      assertPublishedPolicy(policies[0], policy3)
    })

    it('ids filter works', async () => {
      let policies = await coinstr.getPoliciesById([policy1.id, policy3.id])
      expect(policies.size).toBe(2)
      assertPublishedPolicy(policies.get(policy3.id)!, policy3)
      assertPublishedPolicy(policies.get(policy1.id)!, policy1)

    })

    it('deletePolicies works', async () => {
      const policies = await coinstr.getPolicies()
      expect(policies.length).toBe(3)
      await coinstr.deletePolicies([policy1.id, policy2.id])
      const policies2 = await coinstr.getPolicies()
      expect(policies2.length).toBe(1)
      assertPublishedPolicy(policies2[0], policy3)
    })

  })

  describe('subscribe', () => {
    let coinstr: Coinstr
    let keySet: KeySet
    beforeEach(async () => {
      keySet = new KeySet(2)
      coinstr = new Coinstr({
        authenticator: new DirectPrivateKeyAuthenticator(keySet.mainKey().privateKey),
        bitcoinUtil,
        nostrClient
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
    })

    it('should receive policy events', async () => {
      expect.assertions(14)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      const sub = coinstr.subscribe(CoinstrKind.Policy, (kind: number, payload: any) => {
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

      await coinstr.savePolicy(savePolicyPayload1)
      await coinstr.savePolicy(savePolicyPayload2)
      await sleep(500)
      sub.unsub()

    })


    it('should receive OwnedSigner and SharedSigners events', async () => {
      expect.assertions(22)
      const pubKey = coinstr.authenticator.getPublicKey()
      let counter: number = 0
      let saveOwnedSignerPayload1 = saveOwnedSignerPayload(1, pubKey)
      let saveOwnedSignerPayload2 = saveOwnedSignerPayload(2, pubKey)
      let saveSharedSignerPayload1 = saveSharedSignerPayload(1, pubKey)
      let saveSharedSignerPayload2 = saveSharedSignerPayload(2, pubKey)
      const sub = coinstr.subscribe([CoinstrKind.Signers, CoinstrKind.SharedSigners], (kind: number, payload: any) => {
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

      await coinstr.saveOwnedSigner(saveOwnedSignerPayload1)
      await coinstr.saveOwnedSigner(saveOwnedSignerPayload2)
      await coinstr.saveSharedSigner(saveSharedSignerPayload1, pubKey)
      await coinstr.saveSharedSigner(saveSharedSignerPayload2, pubKey)
      await sleep(1000)
      sub.unsub()
    })

    it('should receive Proposal events', async () => {

      expect.assertions(8)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      let policy1 = await coinstr.savePolicy(savePolicyPayload1)
      let policy2 = await coinstr.savePolicy(savePolicyPayload2)
      let spendProposalPayload1 = spendProposalPayload(1, policy1)
      let spendProposalPayload2 = spendProposalPayload(2, policy2)
      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(1)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(2)

      const sub = coinstr.subscribe(CoinstrKind.Proposal, (kind: number, payload: any) => {
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

      let spendProposal1 = await coinstr.spend(spendProposalPayload1)
      let spendProposal2 = await coinstr.spend(spendProposalPayload2)
      let proofOfReserveProposal1 = await coinstr._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      let proofOfReserveProposal2 = await coinstr._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)

      await sleep(2000)
      sub.unsub()
    })


    it('should receive ApprovedProposal events', async () => {
      expect.assertions(8)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      let policy1 = await coinstr.savePolicy(savePolicyPayload1)
      let policy2 = await coinstr.savePolicy(savePolicyPayload2)
      let spendProposalPayload1 = spendProposalPayload(1, policy1)
      let spendProposalPayload2 = spendProposalPayload(2, policy2)
      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(1)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(2)

      const sub = coinstr.subscribe(CoinstrKind.ApprovedProposal, (kind: number, payload: any) => {
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

      let spendProposal1 = await coinstr.spend(spendProposalPayload1)
      let spendProposal2 = await coinstr.spend(spendProposalPayload2)
      let proofOfReserveProposal1 = await coinstr._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      let proofOfReserveProposal2 = await coinstr._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)
      let approvedProposal1 = await coinstr._saveApprovedProposal(spendProposal1.proposal_id)
      let approvedProposal2 = await coinstr._saveApprovedProposal(spendProposal2.proposal_id)
      let approvedProposal3 = await coinstr._saveApprovedProposal(proofOfReserveProposal1.proposal_id)
      let approvedProposal4 = await coinstr._saveApprovedProposal(proofOfReserveProposal2.proposal_id)

      await sleep(100)
      sub.unsub()
    }
    )


    it('should receive CompletedProposal events', async () => {
      expect.assertions(4)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      let policy1 = await coinstr.savePolicy(savePolicyPayload1)
      let policy2 = await coinstr.savePolicy(savePolicyPayload2)
      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(1)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(2)
      let proofOfReserveProposal1 = await coinstr._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      let proofOfReserveProposal2 = await coinstr._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)
      let completedProposal1;
      let completedProposal2;
      const sub = coinstr.subscribe(CoinstrKind.CompletedProposal, (kind: number, payload: any) => {
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


      completedProposal1 = await coinstr._saveCompletedProposal(proofOfReserveProposal1.proposal_id, saveProofOfReserveProposalPayload1)
      completedProposal2 = await coinstr._saveCompletedProposal(proofOfReserveProposal2.proposal_id, saveProofOfReserveProposalPayload2)

      await sleep(100)
      sub.unsub()
    }
    )

    it('should receive many events', async () => {
      let counter: number = 0
      expect.assertions(24)
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let pubkey = coinstr.authenticator.getPublicKey()
      let saveOwnedSignerPayload1 = saveOwnedSignerPayload(1, pubkey)
      let saveSharedSignerPayload1 = saveSharedSignerPayload(1, pubkey)

      const sub = coinstr.subscribe([CoinstrKind.Policy, CoinstrKind.Signers, CoinstrKind.SharedSigners, CoinstrKind.Proposal, CoinstrKind.ApprovedProposal, CoinstrKind.CompletedProposal],
        (kind: number, payload: any) => {
          sleep(2000)
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

      let policy1 = await coinstr.savePolicy(savePolicyPayload1)
      await coinstr.saveOwnedSigner(saveOwnedSignerPayload1)
      await coinstr.saveSharedSigner(saveSharedSignerPayload1, pubkey)
      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(1)
      let proofOfReserveProposal1 = await coinstr._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      let approvedProposal1 = await coinstr._saveApprovedProposal(proofOfReserveProposal1.proposal_id)
      let completedProposal1 = await coinstr._saveCompletedProposal(proofOfReserveProposal1.proposal_id, saveProofOfReserveProposalPayload1)

      await sleep(100)
      sub.unsub()
    }
    )

    it('should receive Metadata events', async () => {
      let counter: number = 0
      expect.assertions(2)
      const sub = coinstr.subscribe(Kind.Metadata, (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionMetadataPayload(kind, payload, metadata1)
            break
        }
        counter++
      })

      const metadata1 = await coinstr.setProfile(getMetadata(1));

      await sleep(200)
      sub.unsub()
    }
    )

    it('should receive Contacts events', async () => {
      let counter: number = 0
      expect.assertions(2)
      const profile1 = await setProfile(1, coinstr)
      const contact1 = getContact(1, profile1.publicKey);
      const sub = coinstr.subscribe(Kind.Contacts, (kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionContactPayload(kind, payload, contact1)
            break
        }
        counter++
      })

      await coinstr.upsertContacts(contact1);

      await sleep(200)
      sub.unsub()
    }
    )

    it('should receive delete events', async () => {
      let counter: number = 0
      expect.assertions(12)
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      let policy1 = await coinstr.savePolicy(savePolicyPayload1)
      let policy2 = await coinstr.savePolicy(savePolicyPayload2)
      let spendProposalPayload1 = spendProposalPayload(1, policy1)
      let spendProposalPayload2 = spendProposalPayload(2, policy2)
      let spendProposal1 = await coinstr.spend(spendProposalPayload1)
      let spendProposal2 = await coinstr.spend(spendProposalPayload2)
      let approval1 = await coinstr._saveApprovedProposal(spendProposal2.proposal_id)
      let approval2 = await coinstr._saveApprovedProposal(spendProposal2.proposal_id)
      let approval3 = await coinstr._saveApprovedProposal(spendProposal2.proposal_id)
      const expectedDeleteEvent1 = new Map([[CoinstrKind.Proposal, [spendProposal1.proposal_id]]])
      const expectedDeleteEvent2 = new Map([[CoinstrKind.Policy, [policy1.id]]])
      const expectedDeleteEvent3 = new Map([[CoinstrKind.ApprovedProposal, [approval1.approval_id, approval2.approval_id, approval3.approval_id]]])

      const sub = coinstr.subscribe(Kind.EventDeletion, (kind: number, payload: any) => {
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
            expect(new Set(payload.get(CoinstrKind.ApprovedProposal))).toEqual(new Set(expectedDeleteEvent3.get(CoinstrKind.ApprovedProposal)))
            break
        }
        counter++
      })

      const policies = await coinstr.getPolicies()
      const proposals = await coinstr.getProposals()
      const approvals = await coinstr.getApprovals()
      expect(policies.length).toBe(2)
      expect(proposals.length).toBe(2)
      expect(approvals.size).toBe(1)

      await coinstr.deleteProposals([spendProposal1.proposal_id], true)
      await sleep(100)
      const proposals2 = await coinstr.getProposals()
      expect(proposals2.length).toBe(1)
      await coinstr.deletePolicies([policy1.id], true)
      await sleep(100)
      const policies2 = await coinstr.getPolicies()
      expect(policies2.length).toBe(1)
      await coinstr.deleteApprovals([approval1.approval_id, approval2.approval_id, approval3.approval_id], true)
      await sleep(200)
      const approvals2 = await coinstr.getApprovals()
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
    let ownedSigner1: OwnedSigner
    let ownedSigner2: OwnedSigner
    let ownedSigner3: OwnedSigner
    beforeAll(async () => {
      const pubKey = coinstr.authenticator.getPublicKey()
      let saveOwnedSignerPayload1 = saveOwnedSignerPayload(1, pubKey)
      ownedSigner1 = await coinstr.saveOwnedSigner(saveOwnedSignerPayload1)
      let saveOwnedSignerPayload2 = saveOwnedSignerPayload(2, pubKey)
      ownedSigner2 = await coinstr.saveOwnedSigner(saveOwnedSignerPayload2)
      let saveOwnedSignerPayload3 = saveOwnedSignerPayload(3, pubKey)
      ownedSigner3 = await coinstr.saveOwnedSigner(saveOwnedSignerPayload3)
    })
    it('returns owned signers', async () => {
      const signers = await coinstr.getOwnedSigners();
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
      const signers = await coinstr.getOwnedSigners();
      expect(signers.length).toBe(3);
      await coinstr.deleteSigners([signers[0].id, signers[1].id])
      const signers2 = await coinstr.getOwnedSigners();
      expect(signers2.length).toBe(1);
      expect(signers2[0]).toEqual(ownedSigner1)
    }
    );
  });

  describe('getSharedSigners', () => {
    let sharedSigner1: PublishedSharedSigner;
    let sharedSigner2: PublishedSharedSigner;
    let sharedSigner3: PublishedSharedSigner;
    let sharedSigner4: PublishedSharedSigner;
    let sharedSigner5: PublishedSharedSigner;
    let coinstrWithAuthenticator2: Coinstr // New instance of Coinstr

    beforeAll(async () => {
      const authenticator2 = new DirectPrivateKeyAuthenticator(keySet1.keys[1].privateKey) // Second authenticator
      const authenticator3 = new DirectPrivateKeyAuthenticator(keySet1.keys[2].privateKey) // Third authenticator
      coinstrWithAuthenticator2 = new Coinstr({ // New instance of Coinstr with different authenticator
        authenticator: authenticator2,
        bitcoinUtil,
        nostrClient
      });

      let pubKey = keySet1.keys[1].publicKey
      let saveSharedSignerPayload1 = saveSharedSignerPayload(1, pubKey)
      let sharedSignerResult = await coinstr.saveSharedSigner(saveSharedSignerPayload1, pubKey)
      sharedSigner1 = sharedSignerResult[0]
      let saveSharedSignerPayload2 = saveSharedSignerPayload(2, pubKey)
      sharedSignerResult = await coinstr.saveSharedSigner(saveSharedSignerPayload2, pubKey)
      sharedSigner2 = sharedSignerResult[0]
      let saveSharedSignerPayload3 = saveSharedSignerPayload(3, pubKey)
      sharedSignerResult = await coinstr.saveSharedSigner(saveSharedSignerPayload3, pubKey)
      sharedSigner3 = sharedSignerResult[0]

      let coinstrWithAuthenticator3 = new Coinstr({ // New instance of Coinstr with different authenticator
        authenticator: authenticator3,
        bitcoinUtil,
        nostrClient
      });

      saveSharedSignerPayload1 = saveSharedSignerPayload(6, pubKey)
      sharedSignerResult = await coinstrWithAuthenticator3.saveSharedSigner(saveSharedSignerPayload1, pubKey)
      sharedSigner4 = sharedSignerResult[0]
      saveSharedSignerPayload1 = saveSharedSignerPayload(7, pubKey)
      sharedSignerResult = await coinstrWithAuthenticator3.saveSharedSigner(saveSharedSignerPayload1, pubKey)
      sharedSigner5 = sharedSignerResult[0]


    })

    it('returns shared all signers (default)', async () => {
      const signers = await coinstrWithAuthenticator2.getSharedSigners(); // Using the new instance of Coinstr
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
      const signers1 = await coinstrWithAuthenticator2.getSharedSigners(sharedSigner1.ownerPubKey);
      expect(signers1.length).toBe(3);
      expect(new Set(signers1)).toEqual(new Set([sharedSigner1, sharedSigner2, sharedSigner3]));


      const signers2 = await coinstrWithAuthenticator2.getSharedSigners(sharedSigner4.ownerPubKey);
      expect(signers2.length).toBe(2);
      expect(new Set(signers2)).toEqual(new Set([sharedSigner4, sharedSigner5]))
    });

    it('returns all signer for an array of owners', async () => {

      if (!sharedSigner1.ownerPubKey || !sharedSigner4.ownerPubKey) {
        throw new Error('SharedSigner1 ownerPubKey is undefined');
      }
      const signers = await coinstrWithAuthenticator2.getSharedSigners([sharedSigner1.ownerPubKey, sharedSigner4.ownerPubKey]);
      expect(signers.length).toBe(5);
      expect(new Set(signers)).toEqual(new Set([sharedSigner1, sharedSigner2, sharedSigner3, sharedSigner4, sharedSigner5]));
    }
    );

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
    let coinstr2: Coinstr

    beforeAll(async () => {


      coinstr2 = newCoinstr(altKeySet.mainKey())
      let wallet = mock<Wallet>()
      wallet.sync.mockResolvedValue()
      wallet.build_trx
        .mockResolvedValueOnce({ amount: 1000, psbt: "encoded psbt1" })
        .mockResolvedValueOnce({ amount: 2000, psbt: "encoded psbt2" })
        .mockResolvedValueOnce({ amount: 3000, psbt: "encoded psbt3" })
        .mockResolvedValueOnce({ amount: 4000, psbt: "encoded psbt4" })
      bitcoinUtil.createWallet.mockReturnValue(wallet)
      let mockTxid = Math.random().toString(36).substring(7)
      expectedTrx = { txid: mockTxid, psbt: "psbt1", trx: { inputs: ["input1"] } }
      wallet.finalize_trx.mockResolvedValue(expectedTrx)
      bitcoinUtil.getTrxId.mockReturnValue(mockTxid)
      bitcoinUtil.getFee.mockReturnValue(420)

      let savePolicyPayload1 = getSavePolicyPayload(11, keySet1.getPublicKeys(), -10)
      let policy1 = await coinstr.savePolicy(savePolicyPayload1) // Policy 1 is created by authenticator 1
      let savePolicyPayload2 = getSavePolicyPayload(12, altKeySet.getPublicKeys(), -12)
      let policy2 = await coinstr2.savePolicy(savePolicyPayload2) // Policy 2 is created by authenticator 2
      let payloadWithBothKeys = getSavePolicyPayload(13, [...keySet1.getPublicKeys(), ...altKeySet.getPublicKeys()], -13)
      let policy3 = await coinstr.savePolicy(payloadWithBothKeys) // Policy 3 is created by authenticator 1 but has both keys


      let spendProposalPayload1 = spendProposalPayload(11, policy1)
      let spendProposalPayload2 = spendProposalPayload(12, policy2)
      let spendProposalPayload3 = spendProposalPayload(13, policy3) // 'signed' needed since it will be approved

      spendProposal1 = await coinstr.spend(spendProposalPayload1)
      spendProposal2 = await coinstr2.spend(spendProposalPayload2)
      spendProposal3 = await coinstr.spend(spendProposalPayload3)

      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(11)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(12)
      let saveProofOfReserveProposalPayload3 = saveProofOfReserveProposalPayload(13)

      proofOfReserveProposal1 = await coinstr._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      proofOfReserveProposal2 = await coinstr2._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)
      proofOfReserveProposal3 = await coinstr._saveProofOfReserveProposal(policy3.id, saveProofOfReserveProposalPayload3)


      proposalApproved1 = proofOfReserveProposal3.proposal_id
      proposalApproved2 = spendProposal3.proposal_id

    }
    )
    it('save approvals', async () => {
      saveApprovedProposal1 = await coinstr._saveApprovedProposal(proposalApproved1)
      saveApprovedProposal2 = await coinstr._saveApprovedProposal(proposalApproved2)
      saveApprovedProposal3 = await coinstr._saveApprovedProposal(proposalApproved2)
      saveApprovedProposal4 = await coinstr._saveApprovedProposal(proposalApproved1)
    });

    const checkProposals = async (coinstr: Coinstr, expectedLength: number, expectedProposals: any) => {
      const proposals = await coinstr.getProposals();
      expect(proposals.length).toBe(expectedLength);
      expect(new Set(proposals)).toEqual(new Set(expectedProposals));
    };

    it('returns proposals', async () => {
      const start = Date.now();
      await checkProposals(coinstr, 4, [spendProposal1, proofOfReserveProposal1, proofOfReserveProposal3, spendProposal3]);
      firstCallTime1 = Date.now() - start;
      const start2 = Date.now();
      await checkProposals(coinstr2, 4, [spendProposal2, proofOfReserveProposal2, proofOfReserveProposal3, spendProposal3]);
      firstCallTime2 = Date.now() - start2;
    });

    it('return proposal should be faster because of cache', async () => {
      const start = Date.now();
      await checkProposals(coinstr, 4, [spendProposal1, proofOfReserveProposal1, proofOfReserveProposal3, spendProposal3]);
      secondCallTime1 = Date.now() - start;
      const start2 = Date.now();
      await checkProposals(coinstr2, 4, [spendProposal2, proofOfReserveProposal2, proofOfReserveProposal3, spendProposal3]);
      secondCallTime2 = Date.now() - start2;
      expect(secondCallTime1).toBeLessThan(firstCallTime1);
      expect(secondCallTime2).toBeLessThan(firstCallTime2);
    });

    it('getProposalsById', async () => {
      const proposals = await coinstr.getProposalsById([spendProposal1.proposal_id, spendProposal3.proposal_id]);
      expect(proposals.size).toBe(2);
      expect(new Set(Array.from(proposals.values()))).toEqual(new Set([spendProposal1, spendProposal3]));
    });

    it('getProposalsByPolicyId', async () => {
      const policyId1 = spendProposal1.policy_id;
      const policyId3 = spendProposal3.policy_id;
      const expectedMap = new Map([
        [policyId1, [proofOfReserveProposal1, spendProposal1]],
        [policyId3, [proofOfReserveProposal3, spendProposal3]]
      ]);
      const proposals = await coinstr.getProposalsByPolicyId([spendProposal1.policy_id, spendProposal3.policy_id]);
      expect(proposals.size).toBe(2);
      expect(new Set(proposals.values())).toEqual(new Set(expectedMap.values()));
    });

    it('returns proposals with limit works', async () => {
      const proposalsAuth1 = await coinstr.getProposals({ limit: 2 });
      const proposalsAuth2 = await coinstr2.getProposals({ limit: 3 });
      expect(proposalsAuth1.length).toBe(2);
      expect(proposalsAuth2.length).toBe(3);
    });

    it('sent proposal direct messages', async () => {

      // Each set of keys creates one SpendProposal (1 and 2), SpendProposal3 is created by auth 1 but has both keys in the policy
      // hence the message is sent to both Auth 1 and Auth 2.

      let coinstr = newCoinstr(keySet1.keys[1])
      let directMessages = await coinstr.getDirectMessages();
      expect(directMessages.length).toBe(2) // 2 proposals sent by key 1
      let publicKeyAuth1 = keySet1.mainKey().publicKey
      assertProposalDirectMessage(directMessages[0], spendProposal3, publicKeyAuth1)
      assertProposalDirectMessage(directMessages[1], spendProposal1, publicKeyAuth1)

      coinstr = newCoinstr(altKeySet.keys[1])
      directMessages = await coinstr.getDirectMessages();
      let publicKeyAuth2 = altKeySet.mainKey().publicKey
      expect(directMessages.length).toBe(2)
      assertProposalDirectMessage(directMessages[0], spendProposal3, publicKeyAuth1)
      assertProposalDirectMessage(directMessages[1], spendProposal2, publicKeyAuth2)
    });



    const checkApprovals = async (expectedSize: number, expectedProposals: Record<string, PublishedApprovedProposal[]>) => {
      const approvedProposals = await coinstr.getApprovals();
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
        const singleApprovedProposal = await coinstr.getApprovals([proposalId]);
        expect(singleApprovedProposal.size).toBe(1);
      }
    });

    it('save completed proposals', async () => {
      completedProposal2 = await coinstr._saveCompletedProposal(proposalApproved1, saveProofOfReserveProposalPayload(12))
      completedProposal3 = await coinstr2._saveCompletedProposal(proposalApproved2, saveProofOfReserveProposalPayload(13))
    });
    it('returns completed proposals', async () => {
      const completedProposals = await coinstr.getCompletedProposals();
      expect(completedProposals.length).toBe(2);
      expect(new Set(completedProposals)).toEqual(new Set([completedProposal2, completedProposal3]));
      let activeProposalsAuth1 = await coinstr.getProposals();
      expect(activeProposalsAuth1.length).toBe(2);
      let activeProposalsAuth2 = await coinstr2.getProposals();
      expect(activeProposalsAuth2.length).toBe(2);
    });

    it('getCompletedProposalsById', async () => {
      const proposals = await coinstr.getCompletedProposalsById([completedProposal2.id, completedProposal3.id]);
      expect(proposals.size).toBe(2);
      expect(proposals.get(completedProposal2.id)).toEqual(completedProposal2);
      expect(proposals.get(completedProposal3.id)).toEqual(completedProposal3);
    }
    );

    it('finalizeSpendingProposal works', async () => {
      bitcoinUtil.canFinalizePsbt.mockReturnValue(true)
      await coinstr._saveApprovedProposal(spendProposal1.proposal_id)
      const finalizedProposal = await coinstr.finalizeSpendingProposal(spendProposal1.proposal_id)
      expect(finalizedProposal.tx).toEqual(expectedTrx.trx)
      expect(finalizedProposal.description).toEqual(spendProposal1.description)
      await sleep(1000)
      const completedProposalsMap = await coinstr.getCompletedProposalsById(finalizedProposal.id);
      expect(completedProposalsMap.size).toBe(1);
      expect(completedProposalsMap.get(finalizedProposal.id)).toEqual(finalizedProposal);
    }
    );

    it('deleteProposals works', async () => {
      const spendProposal = await coinstr.getProposalsById([spendProposal1.proposal_id]);
      expect(spendProposal.size).toBe(1);
      await coinstr.deleteProposals(spendProposal1.proposal_id)
      await sleep(200)
      const proposals = await coinstr.getProposalsById([spendProposal1.proposal_id]);
      expect(proposals.size).toBe(0);
    }
    );

    it('deleteApprovals works', async () => {
      await coinstr.deleteApprovals([saveApprovedProposal1.approval_id, saveApprovedProposal4.approval_id])
      await sleep(200)
      const approvedProposals = await coinstr.getApprovals([proposalApproved1]);
      expect(approvedProposals.size).toBe(0);
    }
    );

    it('deleteCompletedProposals works', async () => {
      const completedProposals = await coinstr.getCompletedProposalsById([completedProposal2.id, completedProposal3.id]);
      expect(completedProposals.size).toBe(2);
      await coinstr.deleteCompletedProposals([completedProposal2.id, completedProposal3.id])
      await sleep(200)
      const completedProposals2 = await coinstr.getCompletedProposalsById([completedProposal2.id, completedProposal3.id]);
      expect(completedProposals2.size).toBe(0);
    }
    );

  });

  function newCoinstr(keys: Keys): Coinstr {
    return new Coinstr({
      authenticator: new DirectPrivateKeyAuthenticator(keys.privateKey),
      bitcoinUtil,
      nostrClient
    })
  }

})

function assertPublishedPolicy(actual: PublishedPolicy, expected: PublishedPolicy) {
  expect(actual.id).toBe(expected.id)
  expect(actual.name).toBe(expected.name)
  expect(actual.description).toBe(expected.description)
  expect(actual.descriptor).toBe(expected.descriptor)
  expect(actual.uiMetadata).toEqual(expected.uiMetadata)
  expect(actual.createdAt).toEqual(expected.createdAt)
  expect(actual.nostrPublicKeys).toEqual(expected.nostrPublicKeys)
  expect(actual.sharedKeyAuth).toBeDefined()
  expect(expected.sharedKeyAuth).toBeDefined()
}

function assertSubscriptionPolicyPayload(kind: number, actual: any, savePayload: SavePolicyPayload) {
  expect(kind).toBe(CoinstrKind.Policy)
  expect(actual).toBeInstanceOf(PublishedPolicy)
  expect(actual.name).toBe(savePayload.name)
  expect(actual.description).toBe(savePayload.description)
  expect(actual.uiMetadata).toEqual(savePayload.uiMetadata)
  expect(actual.nostrPublicKeys).toEqual(savePayload.nostrPublicKeys)
  expect(actual.sharedKeyAuth).toBeDefined()

}

function assertSubscriptionSharedSignerPayload(kind: number, payload: any, expectedPayload: SharedSigner) {
  expect(kind).toBe(CoinstrKind.SharedSigners)
  expect(payload.descriptor).toEqual(expectedPayload.descriptor)
  expect(payload.fingerprint).toEqual(expectedPayload.fingerprint)
  expect(payload.ownerPubKey).toEqual(expectedPayload.ownerPubKey)
}

function assertSubscriptionOwnedSignerPayload(kind: number, payload: any, expectedPayload: OwnedSigner) {
  expect(kind).toBe(CoinstrKind.Signers)
  expect(payload.descriptor).toEqual(expectedPayload.descriptor)
  expect(payload.fingerprint).toEqual(expectedPayload.fingerprint)
  expect(payload.ownerPubKey).toEqual(expectedPayload.ownerPubKey)
  expect(payload.name).toEqual(expectedPayload.name)
  expect(payload.t).toEqual(expectedPayload.t)
  expect(payload.description).toEqual(expectedPayload.description)
}



function assertSubscriptionSpendProposalPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(CoinstrKind.Proposal)
  expect(payload).toEqual(expectedPayload)
}

function assertSubscriptionProofOfReserveProposalPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(CoinstrKind.Proposal)
  expect(payload).toEqual(expectedPayload)
}

function assertSubscriptionApprovedProposalPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(CoinstrKind.ApprovedProposal)
  expect(payload).toEqual(expectedPayload)
}

function assertSubscriptionCompletedProposalPayload(kind: number, payload: any, expectedPayload: any) {
  expect(kind).toBe(CoinstrKind.CompletedProposal)
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
    uiMetadata: { p: `property${id}` },
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

async function setProfile(id: number, coinstr: Coinstr): Promise<Profile> {
  const metadata = getMetadata(id)
  const auth = new DirectPrivateKeyAuthenticator(new Keys().privateKey)
  coinstr.setAuthenticator(auth)
  return await coinstr.setProfile(metadata)
}

function saveSharedSignerPayload(id: number, ownerPubKey: string): SharedSigner {
  return {
    descriptor: `descriptor${id}`,
    fingerprint: `fingerprint${id}`,
    ownerPubKey,
  }
}
function saveOwnedSignerPayload(id: number, ownerPubKey: string): OwnedSigner {
  return {
    descriptor: `descriptor${id}`,
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
      descriptor: `descriptor${id}`,
      message: `message${id}`,
      psbt: `psbt${id}`,
    }
  }
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
