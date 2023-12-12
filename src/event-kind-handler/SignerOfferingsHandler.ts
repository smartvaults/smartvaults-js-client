import { Kind, type Event } from 'nostr-tools'
import { buildEvent, fromNostrDate, getTagValue } from '../util'
import { SmartVaultsKind, TagType } from '../enum'
import { EventKindHandler } from './EventKindHandler'
import { SignerOffering, PublishedSignerOffering, PublishedOwnedSigner, PublishedSharedSigner } from '../types'
import { type NostrClient, type Store } from '../service'
import { type Authenticator } from '@smontero/nostr-ual'
import { type Contact } from '../models'
export class SignerOfferingsHandler extends EventKindHandler {
    private readonly authenticator: Authenticator
    private readonly nostrClient: NostrClient
    private readonly store: Store
    private readonly eventsStore: Store
    private readonly getOwnedSignersByOfferingIdentifiers: () => Promise<Map<string, PublishedOwnedSigner>>
    private readonly getSharedSignersByOfferingIdentifiers: (pubkeys?: string | string[]) => Promise<Map<string, PublishedSharedSigner>>
    private readonly getContacs: () => Promise<Array<Contact>>
    constructor(authenticator: Authenticator, nostrClient: NostrClient, store: Store, eventsStore: Store, getOwnedSignersByOfferingIdentifiers: () => Promise<Map<string, PublishedOwnedSigner>>, getSharedSignersByOfferingIdentifiers: (pubkeys?: string | string[]) => Promise<Map<string, PublishedSharedSigner>>, getContacs: () => Promise<Array<Contact>>) {
        super()
        this.authenticator = authenticator
        this.nostrClient = nostrClient
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

    public async delete(signerOfferingIds: string[]): Promise<void> {
        const pubkey = this.authenticator.getPublicKey()
        const indexKey = "offeringId"
        const signerOfferings: PublishedSignerOffering[] = this.store.getManyAsArray(signerOfferingIds, indexKey)
        const signerOfferingsIds = signerOfferings.map(signerOffering => signerOffering.id)
        const rawSignerOfferings = this.eventsStore.getMany(signerOfferingsIds)
        const tags: Array<[TagType.Event, string]> = []
        const offeringsToDelete: PublishedSignerOffering[] = []
        const rawEventsToDelete: Array<Event<SmartVaultsKind.SignerOffering>> = []

        for (const signerOffering of signerOfferings) {
            const {
                id,
                keyAgentPubKey
            } = signerOffering
            if (keyAgentPubKey === pubkey) {
                offeringsToDelete.push(signerOffering)
                rawEventsToDelete.push(rawSignerOfferings.get(id))
                tags.push([TagType.Event, id])
            }
        }

        const deleteEvent = await buildEvent({
            kind: Kind.EventDeletion,
            content: '',
            tags,
        }, this.authenticator)


        const pub = this.nostrClient.publish(deleteEvent)
        await pub.onFirstOkOrCompleteFailure()
        this.store.delete(offeringsToDelete)
        this.eventsStore.delete(rawEventsToDelete)
    }

}