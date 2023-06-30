import { StringUtil } from './util'
import { TagType } from './enum'

type BasePolicy = {
  name: string;
  description: string;
  uiMetadata: any;
};

type BaseSharedSigner = {
  descriptor: string;
  fingerprint: string;
};

type BaseOwnedSigner = {
  description: any,
  descriptor: string,
  fingerprint: string,
  name: string,
  t: string,
}
  

export type Published = {
  id: string
  createdAt: Date
};

export type Policy = BasePolicy & {
  descriptor: string
};

export type SharedSigner = BaseSharedSigner & {
  ownerPubKey?: string;
};

export type PublishedSharedSigner = SharedSigner & Published;

export type OwnedSigner = BaseOwnedSigner & {
  ownerPubKey?: string;
};

export type PublishedOwnedSigner = OwnedSigner & Published;

export type PublishedPolicy = Policy & Published;

export type SavePolicyPayload = BasePolicy & {
  miniscript: string,
  createdAt?: Date,
}

export type Metadata = {
  /// Name
  name?: string,
  /// Display name
  display_name?: string,
  /// Description
  about?: string,
  /// Website url
  website?: string,
  /// Picture url
  picture?: string,
  /// Banner url
  banner?: string,
  /// NIP05 (ex. name@example.com)
  nip05?: string,
  /// LNURL
  lud06?: string,
  /// Lightning Address
  lud16?: string,
  /// Custom fields
  custom?: Map<String, string>,
}

export type Profile = Metadata & {
  publicKey: string
}

export type ContactProfile = Profile & {
  publicKey: string
  relay?: string
  petname?: string
}

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
