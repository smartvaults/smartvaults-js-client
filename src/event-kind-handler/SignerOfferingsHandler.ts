import { type Event } from 'nostr-tools'
import { fromNostrDate, getTagValue } from '../util'
import { TagType } from '../enum'
import { EventKindHandler } from './EventKindHandler'
import { SignerOffering, PublishedSignerOffering, PublishedOwnedSigner, PublishedSharedSigner } from '../types'
import { type Store } from '../service'
import { type Authenticator } from '@smontero/nostr-ual'
import { type Contact } from '../models'
export class SignerOfferingsHandler extends EventKindHandler {
    private readonly authenticator: Authenticator
    private readonly store: Store
    private readonly eventsStore: Store
    private readonly getOwnedSignersByOfferingIdentifiers: () => Promise<Map<string, PublishedOwnedSigner>>
    private readonly getSharedSignersByOfferingIdentifiers: (pubkeys?: string | string[]) => Promise<Map<string, PublishedSharedSigner>>
    private readonly getContacs: () => Promise<Array<Contact>>
    constructor(authenticator: Authenticator, store: Store, eventsStore: Store, getOwnedSignersByOfferingIdentifiers: () => Promise<Map<string, PublishedOwnedSigner>>, getSharedSignersByOfferingIdentifiers: (pubkeys?: string | string[]) => Promise<Map<string, PublishedSharedSigner>>, getContacs: () => Promise<Array<Contact>>) {
        super()
        this.authenticator = authenticator
        this.store = store
        this.eventsStore = eventsStore
        this.getOwnedSignersByOfferingIdentifiers = getOwnedSignersByOfferingIdentifiers
        this.getSharedSignersByOfferingIdentifiers = getSharedSignersByOfferingIdentifiers
        this.getContacs = getContacs
    }

    protected async _handle<K extends number>(signerOfferingEvents: Array<Event<K>>): Promise<PublishedSignerOffering[]> {
        const signerOfferingEventsIds = signerOfferingEvents.map(e => e.id)
        if (!signerOfferingEventsIds?.length) return []
        const indexKey = "id"
        const missingSignerOfferingEventsIds = this.store.missing(signerOfferingEventsIds, indexKey)

        const missingSignerOfferingEvents = signerOfferingEvents.filter(signerOfferingEvent => missingSignerOfferingEventsIds.includes(signerOfferingEvent.id))
        const ownPubkey = this.authenticator.getPublicKey()
        let ownedSignersByOfferingIdentifiers: Map<string, PublishedOwnedSigner> | undefined
        const includesOwned = missingSignerOfferingEvents.some(signerOfferingEvent => signerOfferingEvent.pubkey === ownPubkey)
        if (includesOwned) {
            ownedSignersByOfferingIdentifiers = await this.getOwnedSignersByOfferingIdentifiers()
        }
        const contactsPubkeys = await this.getContacs().then(contacts => contacts.map(contact => contact.publicKey))
        const includesContact = missingSignerOfferingEvents.some(signerOfferingEvent => contactsPubkeys.includes(signerOfferingEvent.pubkey))
        let sharedSignersByOfferingIdentifiers: Map<string, PublishedSharedSigner> | undefined
        if (includesContact) {
            sharedSignersByOfferingIdentifiers = await this.getSharedSignersByOfferingIdentifiers(contactsPubkeys)
        }
        const signerOfferings = missingSignerOfferingEvents.map(signerOfferingEvent => {
            const {
                id: signerOfferingEventId,
                pubkey: keyAgentPubKey
            } = signerOfferingEvent
            const signerOfferingId = getTagValue(signerOfferingEvent, TagType.Identifier)
            if (this.store.has(signerOfferingId, "offeringId")) {
                const replacedSignerOffering: PublishedSignerOffering | Array<PublishedSignerOffering> = this.store.get(signerOfferingId, "offeringId")
                if (Array.isArray(replacedSignerOffering)) {
                    const matchedSignerOffering = replacedSignerOffering.find(val => val.keyAgentPubKey === keyAgentPubKey)
                    if (matchedSignerOffering) {
                        this.store.delete(matchedSignerOffering)
                        const rawReplacedSignerOffering = this.eventsStore.get(matchedSignerOffering.id)
                        if (rawReplacedSignerOffering) this.eventsStore.delete(rawReplacedSignerOffering)
                    }
                } else {
                    this.store.delete(replacedSignerOffering)
                    const rawReplacedSignerOffering = this.eventsStore.get(replacedSignerOffering.id)
                    if (rawReplacedSignerOffering) this.eventsStore.delete(rawReplacedSignerOffering)
                }
            }
            const signerOffering: SignerOffering = JSON.parse(signerOfferingEvent.content)

            const publishedSignerOffering: PublishedSignerOffering = {
                ...signerOffering,
                id: signerOfferingEventId,
                offeringId: signerOfferingId,
                keyAgentPubKey,
                createdAt: fromNostrDate(signerOfferingEvent.created_at),
            }

            if (keyAgentPubKey === ownPubkey) {
                const ownedSigner = ownedSignersByOfferingIdentifiers?.get(signerOfferingId)
                if (ownedSigner) {
                    publishedSignerOffering.signerFingerprint = ownedSigner.fingerprint
                    publishedSignerOffering.signerDescriptor = ownedSigner.descriptor
                }
            } else if (contactsPubkeys.includes(keyAgentPubKey)) {
                const sharedSigner = sharedSignersByOfferingIdentifiers?.get(signerOfferingId)
                if (sharedSigner) {
                    publishedSignerOffering.signerFingerprint = sharedSigner.fingerprint
                    publishedSignerOffering.signerDescriptor = sharedSigner.descriptor
                }
            }

            return { signerOffering: publishedSignerOffering, rawEvent: signerOfferingEvent }
        })

        const offerings = signerOfferings.map(val => val.signerOffering)
        const rawOfferingEvents = signerOfferings.map(val => val.rawEvent)
        this.store.store(offerings)
        this.eventsStore.store(rawOfferingEvents)
        return this.store.getManyAsArray(signerOfferingEventsIds, indexKey)

    }
}