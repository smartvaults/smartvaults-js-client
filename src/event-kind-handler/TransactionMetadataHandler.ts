import {
    type Event,
} from 'nostr-tools'

import { TagType } from '../enum'
import { fromNostrDate, getTagValue } from '../util'
import { type Store } from '../service'
import { EventKindHandler } from './EventKindHandler'
import {
    type TransactionMetadata, type SharedKeyAuthenticator, PublishedTransactionMetadata
} from '../types'

export class TransactionMetadataHandler extends EventKindHandler {
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

    protected async _handle<K extends number>(transactionMetadataEvents: Array<Event<K>>): Promise<Array<PublishedTransactionMetadata>> {
        let transactionMetadataIds = transactionMetadataEvents.map(e => e.id)
        if (!transactionMetadataIds?.length) return []
        const indexKey = "id"
        const missingTransactionMetadataIds = this.store.missing(transactionMetadataIds, indexKey)

        const missingtransactionMetadataEvents = transactionMetadataEvents.filter(transactionMetadataEvent => missingTransactionMetadataIds.includes(transactionMetadataEvent.id))
        if (!missingtransactionMetadataEvents.length) {
            return this.store.getManyAsArray(transactionMetadataIds, indexKey)
        }
        const policyIds = missingtransactionMetadataEvents.map(e => getTagValue(e, TagType.Event))
        const policyIdSharedKeyAuthenticatorMap = await this.getSharedKeysById(policyIds)
        const transactionMetadataPromises = missingtransactionMetadataEvents.map(async transactionMetadataEvent => {
            const {
                id: transactionMetadataEventId
            } = transactionMetadataEvent
            const transactionMetadataId = getTagValue(transactionMetadataEvent, TagType.Identifier)
            if (this.store.has(transactionMetadataId, "transactionMetadataId")) {
                const replacedtransactionMetadata = this.store.get(transactionMetadataId, "transactionMetadataId")
                const rawReplacedtransactionMetadataEvent = this.eventsStore.get(replacedtransactionMetadata.id)
                this.store.delete(replacedtransactionMetadata)
                this.eventsStore.delete(rawReplacedtransactionMetadataEvent)
            }

            const policyId = getTagValue(transactionMetadataEvent, TagType.Event)
            const sharedKeyAuthenticator = policyIdSharedKeyAuthenticatorMap.get(policyId)?.sharedKeyAuthenticator
            if (!sharedKeyAuthenticator) return null
            const transactionMetadata: TransactionMetadata = await sharedKeyAuthenticator.decryptObj(transactionMetadataEvent.content)
            const txId = Object.values(transactionMetadata.data)[0]
            const publishedtransactionMetadata: PublishedTransactionMetadata = {
                id: transactionMetadataEventId,
                transactionMetadataId,
                policy_id: policyId,
                transactionMetadata,
                createdAt: fromNostrDate(transactionMetadataEvent.created_at),
                txId
            }

            return { transactionMetadata: publishedtransactionMetadata, rawEvent: transactionMetadataEvent }
        })

        const results = await Promise.allSettled(transactionMetadataPromises)

        const validResults = results.reduce((acc, result) => {
            if (result.status === "fulfilled" && result.value !== null) {
                acc.push(result.value);
            }
            return acc;
        }, [] as { transactionMetadata: PublishedTransactionMetadata, rawEvent: Event<K> }[]);

        const transactionMetadata = validResults.map(res => res!.transactionMetadata)
        const rawtransactionMetadataEvents = validResults.map(res => res!.rawEvent)
        this.store.store(transactionMetadata)
        this.eventsStore.store(rawtransactionMetadataEvents)
        return this.store.getManyAsArray(transactionMetadataIds, indexKey)

    }


}

