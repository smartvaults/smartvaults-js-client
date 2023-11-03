import { type Event } from 'nostr-tools'
import { fromNostrDate, getTagValue } from '../util'
import { TagType } from '../enum'
import { EventKindHandler } from './EventKindHandler'
import { SignerOffering, PublishedSignerOffering } from '../types'
import { type Store } from '../service'

export class SignerOfferingsHandler extends EventKindHandler {
    private readonly store: Store
    private readonly eventsStore: Store
    constructor(store: Store, eventsStore: Store) {
        super()
        this.store = store
        this.eventsStore = eventsStore
    }
    protected async _handle<K extends number>(signerOfferingEvents: Array<Event<K>>): Promise<PublishedSignerOffering[]> {
        const signerOfferingEventsIds = signerOfferingEvents.map(e => e.id)
        if (!signerOfferingEventsIds?.length) return []
        const indexKey = "id"
        const missingSignerOfferingEventsIds = this.store.missing(signerOfferingEventsIds, indexKey)

        const missingSignerOfferingEvents = signerOfferingEvents.filter(signerOfferingEvent => missingSignerOfferingEventsIds.includes(signerOfferingEvent.id))
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
            return { signerOffering: publishedSignerOffering, rawEvent: signerOfferingEvent }
        })

        const offerings = signerOfferings.map(val => val.signerOffering)
        const rawOfferingEvents = signerOfferings.map(val => val.rawEvent)
        this.store.store(offerings)
        this.eventsStore.store(rawOfferingEvents)
        return this.store.getManyAsArray(signerOfferingEventsIds, indexKey)

    }
}