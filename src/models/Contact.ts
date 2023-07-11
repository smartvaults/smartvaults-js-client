import { StringUtil } from '../util'
import { TagType } from '../enum'

export class Contact {
  publicKey: string
  relay?: string
  petname?: string

  constructor({
    publicKey,
    relay,
    petname
  }:
    {
      publicKey: string
      relay?: string
      petname?: string
    }) {
    this.publicKey = publicKey
    this.relay = StringUtil.emptyToUndefined(relay)
    this.petname = StringUtil.emptyToUndefined(petname)
  }

  toTag(): string[] {
    return [TagType.PubKey, this.publicKey, this.relay || "", this.petname || ""]
  }

  static fromParams([publicKey, relay, petname]: string[]) {
    return new Contact({
      publicKey,
      relay,
      petname
    })
  }

  static toTags(contacts: Contact[]): string[][] {
    return contacts.map(c => c.toTag())
  }

  static find(publicKey, contacts: Contact[]): number {
    return contacts.findIndex(c => c.publicKey === publicKey)
  }

  static merge(contacts: Contact[], newContacts: Contact[]): Contact[] {
    let contactsMap = Contact.toMap(contacts)
    contactsMap = Contact.toMap(newContacts, contactsMap)
    return [...contactsMap.values()]
  }

  static toMap(contacts: Contact[], contactsMap: Map<string, Contact> = new Map()): Map<string, Contact> {
    contacts.forEach(c => contactsMap.set(c.publicKey, c))
    return contactsMap
  }
}
