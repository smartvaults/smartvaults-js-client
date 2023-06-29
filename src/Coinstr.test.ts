import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Coinstr } from './Coinstr'
import { NostrClient, Keys } from './service'
import { SavePolicyPayload } from './types'
import { BitcoinUtil } from './interfaces'
jest.setTimeout(100000);

describe('Coinstr', () => {
  let coinstr: Coinstr
  let bitcoinUtil: BtcUtil
  let authenticator: DirectPrivateKeyAuthenticator

  beforeEach(async () => {

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

    it('one policy works', async () => {
      let savePayload = savePolicyPayload(1)
      const policy = await coinstr.savePolicy(savePayload)
      const policies = await coinstr.getPolicies()
      expect(policies[0]).toEqual(policy)
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

function savePolicyPayload(id: number): SavePolicyPayload {
  return {
    name: `policy${id}`,
    description: `policy desc ${id}`,
    miniscript: `miniscript ${id}`,
    uiMetadata: { p: `property${id}` }
  }
}