import {Event} from 'nostr-tools'
import { mock} from 'jest-mock-extended'
import { BitcoinUtil } from './interfaces'
import { PublishedPolicy } from './PublishedPolicy'
import { Policy } from './types'
import { CoinstrKind } from '../enum'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { Keys } from '../service'
import { fromNostrDate } from '../util'

describe('PublishedPolicy', () => {

  describe('fromPolicyAndEvent', () => {

    it('it should properly initialize the published policy', async () => {
      const policyContent: Policy = {
        description: "desc",
        descriptor: "descriptor",
        name: "name1",
        uiMetadata: {p1: 'p1'}
      }

      const policyEvent: Event<CoinstrKind.Policy> = {
        id: 'id1',
        content: 'content',
        kind: CoinstrKind.Policy,
        pubkey: "pubkey1",
        sig: "sig",
        tags: [],
        created_at: Date.now()
      }
      const bitcoinUtil = mock<BitcoinUtil>()
      const nostrPublicKeys = ["pub1", "pub2"]
      const sharedKeyAuth = new DirectPrivateKeyAuthenticator(new Keys().privateKey)
      const policy = PublishedPolicy.fromPolicyAndEvent({
        policyContent,
        policyEvent,
        bitcoinUtil,
        nostrPublicKeys,
        sharedKeyAuth
      })
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
})
