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
  return new Date(date * 1000)
}

export function getTagValues<K extends number>(
  e: Event<K>,
  tagType: TagType,
  transformerFn: (params: string[]) => any = (params) => params[0]
): any[] {
  const values: string[] = []
  for (const [tt, ...params] of e.tags) {
    if (tt === tagType) {
      values.push(transformerFn(params))
    }
  }
  return values
}

export function getTagValue(
  e: Event,
  tagType: TagType,
  transformerFn?: (params: string[]) => any
): any {
  const values = getTagValues(e, tagType, transformerFn)
  if (!values.length) {
    throw new Error(`No tag of type: ${tagType} found for event: ${JSON.stringify(e)}`)
  }
  if (values.length > 1) {
    throw new Error(`Found more than one tag of type: ${tagType} for event: ${JSON.stringify(e)}`)
  }
  return values[0]
}

/**
 * Asynchronously tries to verify NIP05.
 *
 * @async
 * @param {string} nip05 - The nip05 string.
 * @param {string} publicKey - The public key string to verify against.
 * @param {number} timeout - The fetch timeout in milliseconds (Optional).
 * @returns {Promise<boolean>} - 
 * A promise that resolves to a boolean that indicates if the nip05 has been verified.
 *
 * @example
 * const isNip05Verified = await isNip05Verified(alice@smartvaults.app, aliciesPublicKey);
 */
export async function isNip05Verified(nip05: string, publicKey: string, timeout = 2000): Promise<boolean> {

  const HTTP_OK = 200;
  const nip05Array = nip05.split('@');
  const isNip05Valid = nip05Array.length === 2 && nip05Array[1].includes('.');

  if (!isNip05Valid) {
    console.error(`Invalid NIP05 string for ${publicKey}`);
    return false;
  }

  const [name, url] = nip05Array;
  const URL_ENDPOINT = `https://${url}/.well-known/nostr.json?name=${name}`;

  try {
    const urlResponse = await fetchWithTimeout(URL_ENDPOINT, timeout);
    if (urlResponse.ok && urlResponse.status === HTTP_OK) {
      const urlResponseJson = await urlResponse.json();
      return urlResponseJson.names[name] === publicKey;
    }
  } catch (fetchError) {
    console.error(`Error fetching the URL ${URL_ENDPOINT} to validate NIP05:`, fetchError);
  }

  return false;
}


async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(id);

  return response;
}
