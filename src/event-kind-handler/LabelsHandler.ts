import {
    type Event,
} from 'nostr-tools'

import { TagType } from '../enum'
import { getTagValues, fromNostrDate } from '../util'
import { type Store } from '../service'
import { EventKindHandler } from './EventKindHandler'
import {
    type TransactionMetadata, type SharedKeyAuthenticator, PublishedTransactionMetadata
} from '../types'

export class LabelsHandler extends EventKindHandler {
    private readonly store: Store
    private readonly eventsStore: Store
    private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
    constructor(store: Store, eventsStore: Store,
        getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>,
    ) {
        super()
        this.store = store
        this.eventsStore = eventsStore
        this.getSharedKeysById = getSharedKeysById
    }

    protected async _handle<K extends number>(labelEvents: Array<Event<K>>): Promise<Array<PublishedTransactionMetadata>> {
        let labelIds = labelEvents.map(e => e.id)
        if (!labelIds?.length) return []
        const indexKey = "id"
        const missingLabelIds = this.store.missing(labelIds, indexKey)

        const missingLabelEvents = labelEvents.filter(labelEvent => missingLabelIds.includes(labelEvent.id))
        const policyIds = missingLabelEvents.map(e => getTagValues(e, TagType.Event)[0])
        const policyIdSharedKeyAuthenticatorMap = await this.getSharedKeysById(policyIds)
        const labelPromises = missingLabelEvents.map(async labelEvent => {
            const {
                id: labelEventId
            } = labelEvent
            const labelId = getTagValues(labelEvent, TagType.Identifier)[0]
            if (this.store.has(labelId, "label_id")) {
                const replacedLabel = this.store.get(labelId, "label_id")
                const rawReplacedLabelEvent = this.eventsStore.get(replacedLabel.id)
                this.store.delete(replacedLabel)
                this.eventsStore.delete(rawReplacedLabelEvent)
            }

            const policyId = getTagValues(labelEvent, TagType.Event)[0]
            const sharedKeyAuthenticator = policyIdSharedKeyAuthenticatorMap.get(policyId)?.sharedKeyAuthenticator
            if (!sharedKeyAuthenticator) return null
            const label: TransactionMetadata = await sharedKeyAuthenticator.decryptObj(labelEvent.content)
            const labelData = Object.values(label.data)[0]
            const publishedLabel: PublishedTransactionMetadata = {
                id: labelEventId,
                label_id: labelId,
                policy_id: policyId,
                label,
                createdAt: fromNostrDate(labelEvent.created_at),
                labelData
            }

            return { label: publishedLabel, rawEvent: labelEvent }
        })

        const results = await Promise.allSettled(labelPromises)

        const validResults = results.reduce((acc, result) => {
            if (result.status === "fulfilled" && result.value !== null) {
                acc.push(result.value);
            }
            return acc;
        }, [] as { label: PublishedTransactionMetadata, rawEvent: Event<K> }[]);

        const labels = validResults.map(res => res!.label)
        const rawLabelEvents = validResults.map(res => res!.rawEvent)
        this.store.store(labels)
        this.eventsStore.store(rawLabelEvents)
        return this.store.getManyAsArray(labelIds, indexKey)

    }


}

