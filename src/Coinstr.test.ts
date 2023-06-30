import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Coinstr } from './Coinstr'
import { NostrClient, Keys } from './service'
import { PublishedPolicy, SavePolicyPayload, OwnedSigner, SharedSigner} from './types'
import { BitcoinUtil } from './interfaces'
jest.setTimeout(1000000);

describe('Coinstr', () => {
  let coinstr: Coinstr
  let bitcoinUtil: BtcUtil
  let authenticator: DirectPrivateKeyAuthenticator

  beforeAll(async () => {

    const nostrClient = new NostrClient([
      'wss://relay.rip',
    ])
    const keys = new Keys()
    authenticator = new DirectPrivateKeyAuthenticator(keys.privateKey)
    bitcoinUtil = new BtcUtil(keys, 2, "vault descriptor")
    coinstr = new Coinstr({
      authenticator,
      bitcoinUtil,
      nostrClient
    })

  })

  afterEach(() => {
    coinstr.disconnect()
  })

  describe('getPolicies', () => {
    let policy1: PublishedPolicy
    let policy2: PublishedPolicy
    let policy3: PublishedPolicy

    beforeAll(async () => {
      let savePayload = savePolicyPayload(1, 20)
      policy1 = await coinstr.savePolicy(savePayload)
      savePayload = savePolicyPayload(2, 10)
      policy2 = await coinstr.savePolicy(savePayload)
      savePayload = savePolicyPayload(3)
      policy3 = await coinstr.savePolicy(savePayload)

    })

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
      ownedSigner1 = await coinstr._saveOwnedSigner(saveOwnedSignerPayload1)
      let saveOwnedSignerPayload2 = saveOwnedSignerPayload(2)
      ownedSigner2 = await coinstr._saveOwnedSigner(saveOwnedSignerPayload2)
      let saveOwnedSignerPayload3 = saveOwnedSignerPayload(3)
      ownedSigner3 = await coinstr._saveOwnedSigner(saveOwnedSignerPayload3)
    } )
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
    beforeAll(async () => {
      let saveSharedSignerPayload1 = saveSharedSignerPayload(1)
      sharedSigner1 = await coinstr._saveSharedSigner(saveSharedSignerPayload1)
      let saveSharedSignerPayload2 = saveSharedSignerPayload(2)
      sharedSigner2 = await coinstr._saveSharedSigner(saveSharedSignerPayload2)
      let saveSharedSignerPayload3 = saveSharedSignerPayload(3)
      sharedSigner3 = await coinstr._saveSharedSigner(saveSharedSignerPayload3)
    } )
    it('returns shared signers', async () => {
      const signers = await coinstr.getSharedSigners();
      expect(signers.length).toBe(3);
      expect(signers[0]).toEqual(sharedSigner3)
      expect(signers[1]).toEqual(sharedSigner2)
      expect(signers[2]).toEqual(sharedSigner1)

      signers.forEach(signer => {
        expect(signer).toHaveProperty('ownerPubKey');
        expect(signer).toHaveProperty('descriptor');
        expect(signer).toHaveProperty('fingerprint');
      });
    });
  });
})


class BtcUtil implements BitcoinUtil {
  keys: Keys[]
  descriptor: string
  constructor(ownKey: Keys, numExtraKeys: number, descriptor: string) {
    this.descriptor = descriptor
    this.keys = [ownKey]
    for (let i = 0; i < numExtraKeys; i++) {
      this.keys.push(new Keys())
    }
  }
  getKeysFromMiniscript(_miniscript: string): string[] {
    return this.keys.map(k => k.publicKey)
  }
  toDescriptor(_miniscript: string): string {
    return this.descriptor
  }

}

function savePolicyPayload(id: number, secondsShift: number = 0): SavePolicyPayload {
  let createdAt = new Date()
  createdAt.setSeconds(createdAt.getSeconds() - secondsShift)
  return {
    name: `policy${id}`,
    description: `policy desc ${id}`,
    miniscript: `miniscript ${id}`,
    uiMetadata: { p: `property${id}` },
    createdAt
  }
}

function saveSharedSignerPayload(id: number): SharedSigner {
  let createdAt = Math.floor(Date.now() / 1000)
  return {
    descriptor: `descriptor${id}`,
    fingerprint: `fingerprint${id}`,
    ownerPubKey: `ownerPubKey${id}`,
    sharedDate: createdAt
  }
}
function saveOwnedSignerPayload(id: number): OwnedSigner {
  let createdAt = Math.floor(Date.now() / 1000)
  return {
    descriptor: `descriptor${id}`,
    fingerprint: `fingerprint${id}`,
    ownerPubKey: `ownerPubKey${id}`,
    name: `name${id}`,
    t: `t${id}`,
    description: `description${id}`,
    createdAt
  }
}