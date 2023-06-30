import { getEventHash, Event, Kind } from 'nostr-tools'
import { Authenticator } from '@smontero/nostr-ual'
import { TagType } from '../enum'

export async function buildEvent<K extends number = Kind>(e: {
  kind: K,
  tags: string[][],
  content: string,
  createdAt?: Date
}, authenticator: Authenticator): Promise<Event<K>> {

  let event = e as Event<K>
  event.created_at = nostrDate(e.createdAt)
  event.pubkey = await authenticator.getPublicKey()
  event.id = getEventHash(event)
  event.sig = await authenticator.signEvent(event)
  return event

}

export function toPublished(obj: any, e: Event<any>): any {
  return {
    ...obj,
    id: e.id,
    createdAt: fromNostrDate(e.created_at)
  }
}

export function nostrDate(date?: Date | number): number {
  date = date || new Date()
  return date instanceof Date ? Math.floor(date.getTime() / 1000) : date
}

export function fromNostrDate(date: number): Date {
  let ms = new Date(date * 1000)
  return new Date(ms.setMilliseconds(0))
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