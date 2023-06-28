import { getEventHash, Event, Kind } from 'nostr-tools'
import { Authenticator } from '@smontero/nostr-ual'
import { TagType } from '../enum'

export async function buildEvent<K extends number = Kind>(e: {
  kind: K,
  tags: string[][],
  content: string,
}, authenticator: Authenticator): Promise<Event<K>> {

  let event = e as Event<K>
  event.created_at = Math.floor(Date.now() / 1000)
  event.pubkey = await authenticator.getPublicKey()
  event.id = getEventHash(event)
  event.sig = await authenticator.signEvent(event)
  return event

}

export function getTagValues(e: Event, tagType: TagType): string[] {
  const values: string[] = []
  for (const [tt, v] of e.tags) {
    if (tt === tagType) {
      values.push(v)
    }
  }
  return values
}

export function getTagValue(e: Event, tagType: TagType): string {
  const values = getTagValues(e, tagType)
  if (!values.length) {
    throw new Error(`No tag of type: ${tagType} found for event: ${JSON.stringify(e)}`)
  }
  if (values.length > 1) {
    throw new Error(`Found more than one tag of type: ${tagType} for event: ${JSON.stringify(e)}`)
  }
  return values[0]
}