import sleep from 'await-sleep'
import { MockProxy, mock } from 'jest-mock-extended'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Coinstr } from './Coinstr'
import { NostrClient, Keys } from './service'
import { TimeUtil } from './util'
import { Contact, PublishedPolicy, BitcoinUtil, Wallet } from './models'
import { Metadata, Profile, SavePolicyPayload, OwnedSigner, SharedSigner, SpendProposalPayload, ProofOfReserveProposal, PublishedDirectMessage, PublishedSpendingProposal } from './types'
import { CoinstrKind } from './enum'
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
      // 'wss://relay.rip',
      'ws://localhost:7777'
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
    let contact1: Contact
    let contact2: Contact
    let contact3: Contact
    beforeAll(async () => {
      profile1 = await setProfile(1, coinstr)
      profile2 = await setProfile(2, coinstr)
      profile3 = await setProfile(3, coinstr)
      coinstr.setAuthenticator(authenticator)
      contact1 = getContact(1, profile1.publicKey)
      contact2 = getContact(2, profile2.publicKey)
      contact3 = getContact(3, profile3.publicKey)
      await coinstr.upsertContacts([contact1, contact2, contact3])
    })

    it('getProfile', async () => {
      const profile = await coinstr.getProfile(profile1.publicKey)
      expect(profile).toEqual(profile1)
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
  })

  describe('subscribe', () => {
    let coinstr: Coinstr
    let keySet: KeySet
    beforeEach(() => {
      keySet = new KeySet(2)
      coinstr = new Coinstr({
        authenticator: new DirectPrivateKeyAuthenticator(keySet.mainKey().privateKey),
        bitcoinUtil,
        nostrClient
      })
    })

    it('should receive new events', async () => {
      expect.assertions(14)
      let counter: number = 0
      let savePolicyPayload1 = getSavePolicyPayload(1, keySet.getPublicKeys(), 2)
      let savePolicyPayload2 = getSavePolicyPayload(2, keySet.getPublicKeys(), 3)
      const sub = coinstr.subscribe((kind: number, payload: any) => {
        switch (counter) {
          case 0:
            assertSubscriptionPolicyPayload(kind, payload, savePolicyPayload1)
            break
          case 1:
            assertSubscriptionPolicyPayload(kind, payload, savePolicyPayload2)
            break
        }
        counter++
      })

      await coinstr.savePolicy(savePolicyPayload1)
      await coinstr.savePolicy(savePolicyPayload2)
      await sleep(100)
      sub.unsub()

    })

  })

  describe('getOwnedSigners', () => {
    let ownedSigner1: OwnedSigner
    let ownedSigner2: OwnedSigner
    let ownedSigner3: OwnedSigner
    beforeAll(async () => {
      let saveOwnedSignerPayload1 = saveOwnedSignerPayload(1)
      ownedSigner1 = await coinstr.saveOwnedSigner(saveOwnedSignerPayload1)
      let saveOwnedSignerPayload2 = saveOwnedSignerPayload(2)
      ownedSigner2 = await coinstr.saveOwnedSigner(saveOwnedSignerPayload2)
      let saveOwnedSignerPayload3 = saveOwnedSignerPayload(3)
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
  });

  describe('getSharedSigners', () => {
    let sharedSigner1: SharedSigner
    let sharedSigner2: SharedSigner
    let sharedSigner3: SharedSigner
    let sharedSigner4: SharedSigner
    let sharedSigner5: SharedSigner
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
      let saveSharedSignerPayload1 = saveSharedSignerPayload(1)
      sharedSigner1 = await coinstr.saveSharedSigner(saveSharedSignerPayload1, pubKey)
      let saveSharedSignerPayload2 = saveSharedSignerPayload(2)
      sharedSigner2 = await coinstr.saveSharedSigner(saveSharedSignerPayload2, pubKey)
      let saveSharedSignerPayload3 = saveSharedSignerPayload(3)
      sharedSigner3 = await coinstr.saveSharedSigner(saveSharedSignerPayload3, pubKey)

      let coinstrWithAuthenticator3 = new Coinstr({ // New instance of Coinstr with different authenticator
        authenticator: authenticator3,
        bitcoinUtil,
        nostrClient
      });

      saveSharedSignerPayload1 = saveSharedSignerPayload(6)
      sharedSigner4 = await coinstrWithAuthenticator3.saveSharedSigner(saveSharedSignerPayload1, pubKey)
      saveSharedSignerPayload1 = saveSharedSignerPayload(7)
      sharedSigner5 = await coinstrWithAuthenticator3.saveSharedSigner(saveSharedSignerPayload1, pubKey)


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
    let spendProposal4;
    let proofOfReserveProposal1;
    let proofOfReserveProposal2;
    let proofOfReserveProposal3;
    let proofOfReserveProposal4;
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
      let savePolicyPayload1 = getSavePolicyPayload(11, keySet1.getPublicKeys(), -10)
      let policy1 = await coinstr.savePolicy(savePolicyPayload1)
      let savePolicyPayload2 = getSavePolicyPayload(12, keySet1.getPublicKeys(), -15)
      let policy2 = await coinstr.savePolicy(savePolicyPayload2)
      let savePolicyPayload3 = getSavePolicyPayload(13, keySet1.getPublicKeys(), -20)
      let policy3 = await coinstr.savePolicy(savePolicyPayload3)


      // Create policies with different public keys
      let savePolicyPayload4 = getSavePolicyPayload(14, altKeySet.getPublicKeys(), -10)
      let policy4 = await coinstr.savePolicy(savePolicyPayload4)
      let savePolicyPayload5 = getSavePolicyPayload(15, altKeySet.getPublicKeys(), -15)
      let policy5 = await coinstr.savePolicy(savePolicyPayload5)


      let spendProposalPayload1 = spendProposalPayload(11, policy1)
      let spendProposalPayload2 = spendProposalPayload(12, policy2)
      let spendProposalPayload3 = spendProposalPayload(13, policy3)

      spendProposal1 = await coinstr.spend(spendProposalPayload1)
      spendProposal2 = await coinstr.spend(spendProposalPayload2)
      spendProposal3 = await coinstr.spend(spendProposalPayload3)

      let spendProposalPayload4 = spendProposalPayload(14, policy4)
      // nly those whose pk are in the policy can see use it to create a proposal
      spendProposal4 = await coinstr2.spend(spendProposalPayload4)

      let saveProofOfReserveProposalPayload1 = saveProofOfReserveProposalPayload(11)
      let saveProofOfReserveProposalPayload2 = saveProofOfReserveProposalPayload(12)
      let saveProofOfReserveProposalPayload3 = saveProofOfReserveProposalPayload(13)

      proofOfReserveProposal1 = await coinstr._saveProofOfReserveProposal(policy1.id, saveProofOfReserveProposalPayload1)
      proofOfReserveProposal2 = await coinstr._saveProofOfReserveProposal(policy2.id, saveProofOfReserveProposalPayload2)
      proofOfReserveProposal3 = await coinstr._saveProofOfReserveProposal(policy3.id, saveProofOfReserveProposalPayload3)

      proofOfReserveProposal4 = await coinstr2._saveProofOfReserveProposal(policy5.id, saveProofOfReserveProposalPayload1)

    }
    )
    it('returns proposals', async () => {
      const proposals1 = await coinstr.getProposals();
      expect(proposals1.length).toBe(6);
      expect(new Set(proposals1)).toEqual(new Set([spendProposal1, spendProposal2, spendProposal3, proofOfReserveProposal1, proofOfReserveProposal2, proofOfReserveProposal3]));
      const proposals2 = await coinstr2.getProposals();
      expect(proposals2.length).toBe(2);
      expect(new Set(proposals2)).toEqual(new Set([spendProposal4, proofOfReserveProposal4]));
    });

    it('sent proposal direct messages', async () => {
      let coinstr = newCoinstr(keySet1.keys[1])
      let directMessages = await coinstr.getDirectMessages();
      expect(directMessages.length).toBe(3)
      let publicKey = keySet1.mainKey().publicKey
      assertProposalDirectMessage(directMessages[0], spendProposal3, publicKey)
      assertProposalDirectMessage(directMessages[1], spendProposal2, publicKey)
      assertProposalDirectMessage(directMessages[2], spendProposal1, publicKey)

      coinstr = newCoinstr(altKeySet.keys[1])
      directMessages = await coinstr.getDirectMessages();
      expect(directMessages.length).toBe(1)
      publicKey = altKeySet.mainKey().publicKey
      assertProposalDirectMessage(directMessages[0], spendProposal4, publicKey)
    });
  })

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
  return coinstr.setProfile(metadata)
}

function saveSharedSignerPayload(id: number): SharedSigner {
  return {
    descriptor: `descriptor${id}`,
    fingerprint: `fingerprint${id}`,
    ownerPubKey: `ownerPubKey${id}`,
  }
}
function saveOwnedSignerPayload(id: number): OwnedSigner {
  return {
    descriptor: `descriptor${id}`,
    fingerprint: `fingerprint${id}`,
    ownerPubKey: `ownerPubKey${id}`,
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
    feeRatePriority: "low"
  }
}

function saveProofOfReserveProposalPayload(id: number): ProofOfReserveProposal {
  return {
    descriptor: `descriptor${id}`,
    message: `message${id}`,
    psbt: `psdbt${id}`,
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