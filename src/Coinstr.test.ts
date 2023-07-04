jest.mock('@smontero/coinstr-wasm')
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Coinstr } from './Coinstr'
import { NostrClient, Keys } from './service'
import { TimeUtil } from './util'
import { BitcoinOpts, Contact, PublishedPolicy } from './models'
import { Metadata, Profile, SavePolicyPayload, OwnedSigner, SharedSigner } from './types'
jest.setTimeout(1000000);

describe('Coinstr', () => {
  let coinstr: Coinstr
  let authenticator: DirectPrivateKeyAuthenticator
  let bitcoinOpts: BitcoinOpts
  const keys1 = new Keys()
  const keys2 = new Keys()
  const keys3 = new Keys()
  beforeAll(async () => {

    const nostrClient = new NostrClient([
      // 'wss://relay.rip',
      'ws://localhost:7777'
    ])
    
    authenticator = new DirectPrivateKeyAuthenticator(keys1.privateKey)
    bitcoinOpts = {
      endpoint: 'https://blockstream.info/testnet/api/',
      network: 'testnet',
      requestStopGap: 30,
      syncTimeGap: 1
    }
    coinstr = new Coinstr({
      authenticator,
      bitcoinOpts,
      nostrClient
    })
    // await coinstr.init()
  })

  afterEach(() => {
    coinstr.disconnect()
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
      let savePayload = getSavePolicyPayload(1, [keys1.publicKey, keys2.publicKey, keys3.publicKey], 20)
      policy1 = await coinstr.savePolicy(savePayload)
      const pubKeys = [keys1.publicKey, keys2.publicKey]
      savePayload = getSavePolicyPayload(2, pubKeys, 10)
      policy2 = await coinstr.savePolicy(savePayload)
      savePayload = getSavePolicyPayload(3, pubKeys)
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
      expect(policies[0]).toEqual(policy3)
      expect(policies[1]).toEqual(policy2)
      expect(policies[2]).toEqual(policy1)
    })

    it('since works', async () => {
      let policies = await coinstr.getPolicies({ since: policy2.createdAt })
      expect(policies.length).toBe(2)
      expect(policies[0]).toEqual(policy3)
      expect(policies[1]).toEqual(policy2)

      policies = await coinstr.getPolicies({ since: policy3.createdAt })
      expect(policies.length).toBe(1)
      expect(policies[0]).toEqual(policy3)
    })

    it('until works', async () => {
      let policies = await coinstr.getPolicies({ until: policy2.createdAt })
      expect(policies.length).toBe(1)
      expect(policies[0]).toEqual(policy1)

      policies = await coinstr.getPolicies({ until: policy1.createdAt })
      expect(policies.length).toBe(0)
    })

    it('limit works', async () => {
      let policies = await coinstr.getPolicies({ limit: 2 })
      expect(policies.length).toBe(2)
      expect(policies[0]).toEqual(policy3)
      expect(policies[1]).toEqual(policy2)

      policies = await coinstr.getPolicies({ since: policy2.createdAt, limit: 1 })
      expect(policies.length).toBe(1)
      expect(policies[0]).toEqual(policy3)
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
      const keys2 = new Keys() // Second set of keys
      const keys3 = new Keys() // Third set of keys
      const authenticator2 = new DirectPrivateKeyAuthenticator(keys2.privateKey) // Second authenticator
      const authenticator3 = new DirectPrivateKeyAuthenticator(keys3.privateKey) // Third authenticator
      const nostrClient = new NostrClient([
        'wss://relay.rip',
      ])
      coinstrWithAuthenticator2 = new Coinstr({ // New instance of Coinstr with different authenticator
        authenticator: authenticator2,
        bitcoinOpts,
        nostrClient
      });

      let pubKey = keys2.publicKey
      let saveSharedSignerPayload1 = saveSharedSignerPayload(1)
      sharedSigner1 = await coinstr.saveSharedSigner(saveSharedSignerPayload1, pubKey)
      let saveSharedSignerPayload2 = saveSharedSignerPayload(2)
      sharedSigner2 = await coinstr.saveSharedSigner(saveSharedSignerPayload2, pubKey)
      let saveSharedSignerPayload3 = saveSharedSignerPayload(3)
      sharedSigner3 = await coinstr.saveSharedSigner(saveSharedSignerPayload3, pubKey)

      let coinstrWithAuthenticator3 = new Coinstr({ // New instance of Coinstr with different authenticator
        authenticator: authenticator3,
        bitcoinOpts,
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

})


function getSavePolicyPayload(id: number, nostrPublicKeys: string[], secondsShift: number = 0): SavePolicyPayload {
  let createdAt = TimeUtil.addSeconds(-1 * secondsShift)
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