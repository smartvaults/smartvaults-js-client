import { generatePrivateKey, Kind, Event } from 'nostr-tools'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { NostrClient } from './NostrClient'
import { buildEvent } from '../util'

jest.setTimeout(100000);

describe('NostrClient', () => {
  let authenticator: DirectPrivateKeyAuthenticator
  let clientTwoRelays: NostrClient
  let clientOneOkRelay: NostrClient
  let clientOneFailRelay: NostrClient
  let event: Event

  beforeAll(async () => {
    authenticator = new DirectPrivateKeyAuthenticator(generatePrivateKey())
    clientTwoRelays = new NostrClient([
      'wss://relay.rip',
      'wss://relay.snort.social'
    ])

    clientOneOkRelay = new NostrClient([
      'wss://relay.rip',
    ])

    clientOneFailRelay = new NostrClient([
      'wss://relay.snort.social'
    ])
    event = await buildEvent({
      kind: Kind.Text,
      tags: [],
      content: 'hello world'
    },
      authenticator)

  })

  afterAll(() => {
    clientTwoRelays.disconnect()
    clientOneOkRelay.disconnect()
    clientOneFailRelay.disconnect()
  })

  describe('publish', () => {

    it('completePromise works', async () => {
      let pub = clientTwoRelays.publish(event)
      let result = await pub.completePromise()
      expect(result).toHaveProperty('ok')
      expect(result).toHaveProperty('failed')
      expect(result.ok).toEqual(['wss://relay.rip'])
      expect(result.failed).toEqual(['wss://relay.snort.social'])

      pub = clientOneOkRelay.publish(event)
      result = await pub.completePromise()
      expect(result).toHaveProperty('ok')
      expect(result).toHaveProperty('failed')
      expect(result.ok).toEqual(['wss://relay.rip'])
      expect(result.failed).toEqual([])

      pub = clientOneFailRelay.publish(event)
      result = await pub.completePromise()
      expect(result).toHaveProperty('ok')
      expect(result).toHaveProperty('failed')
      expect(result.ok).toEqual([])
      expect(result.failed).toEqual(['wss://relay.snort.social'])
    })

    it('onFirstOkOrCompleteFailure works', async () => {
      expect.assertions(1)
      let pub = clientTwoRelays.publish(event)
      await pub.onFirstOkOrCompleteFailure()

      pub = clientOneOkRelay.publish(event)
      await pub.onFirstOkOrCompleteFailure()
      try {
        pub = clientOneFailRelay.publish(event)
        await pub.onFirstOkOrCompleteFailure()
      } catch (e: any) {
        expect(e.message).toBe('Message could not published')
      }
    })
  })
})