import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Coinstr } from './Coinstr'
import { NostrClient, Keys } from './service'
import { Metadata, Profile, Contact, PublishedPolicy, SavePolicyPayload } from './types'
import { BitcoinUtil } from './interfaces'
jest.setTimeout(100000);

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
      let savePayload = getSavePolicyPayload(1, 20)
      policy1 = await coinstr.savePolicy(savePayload)
      savePayload = getSavePolicyPayload(2, 10)
      policy2 = await coinstr.savePolicy(savePayload)
      savePayload = getSavePolicyPayload(3)
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

function getSavePolicyPayload(id: number, secondsShift: number = 0): SavePolicyPayload {
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