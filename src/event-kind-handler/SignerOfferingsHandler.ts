import { type Event } from 'nostr-tools'
import { fromNostrDate, getTagValues } from '../util'
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
                id: signerOfferingEventId
            } = signerOfferingEvent
            const signerOfferingId = getTagValues(signerOfferingEvent, TagType.Identifier)[0]
            if (this.store.has(signerOfferingId, "offeringId")) {
                const replacedSignerOffering = this.store.get(signerOfferingId, "offeringId")
                const rawReplacedSignerOffering = this.eventsStore.get(replacedSignerOffering.id)
                this.store.delete(replacedSignerOffering)
                this.eventsStore.delete(rawReplacedSignerOffering)
            }
            const signerOffering: SignerOffering = JSON.parse(signerOfferingEvent.content)
            const publishedSignerOffering: PublishedSignerOffering = {
                ...signerOffering,
                id: signerOfferingEventId,
                offeringId: signerOfferingId,
                keyAgentPubKey: signerOfferingEvent.pubkey,
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