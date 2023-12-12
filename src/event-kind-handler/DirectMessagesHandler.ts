import { Kind, type Event } from 'nostr-tools'
import { PublishedDirectMessage, SharedKeyAuthenticator } from '../types'
import { type Store, type NostrClient } from '../service'
import { buildEvent, fromNostrDate, getTagValue, getTagValues } from '../util'
import { EventKindHandler } from './EventKindHandler'
import { type Authenticator } from '@smontero/nostr-ual'
import { TagType, AuthenticatorType } from '../enum'
import { type Chat } from '../models/Chat'
export class DirecMessagesHandler extends EventKindHandler {
    private readonly store: Store
    private readonly eventsStore: Store
    private readonly authenticator!: Authenticator
    private readonly nostrClient: NostrClient
    private readonly getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>
    private readonly isValidPolicyId: (id: string) => Promise<boolean>
    private readonly getChat: () => Chat
    constructor(authenticator: Authenticator, nostrClient: NostrClient, store: Store, eventsStore: Store, getSharedKeysById: (ids: string[]) => Promise<Map<string, SharedKeyAuthenticator>>, isValidPolicyId: (id: string) => Promise<boolean>, getChat: () => Chat) {
        super()
        this.store = store
        this.eventsStore = eventsStore
        this.authenticator = authenticator
        this.nostrClient = nostrClient
        this.getSharedKeysById = getSharedKeysById
        this.isValidPolicyId = isValidPolicyId
        this.getChat = getChat
    }

    protected async _handle<K extends number>(directMessageEvents: Array<Event<K>>): Promise<PublishedDirectMessage[]> {
        if (!directMessageEvents.length) return []
        if (this.authenticator.getName() === AuthenticatorType.WebExtension) {
            return this.getDirectMessagesSync(directMessageEvents)
        } else {
            return this.getDirectMessagesAsync(directMessageEvents)
        }
    }

    private async getDirectMessagesAsync<K extends number>(directMessageEvents: Array<Event<K>>): Promise<PublishedDirectMessage[]> {
        const currentAuthPubKey = this.authenticator.getPublicKey()
        const chat = this.getChat()
        const messagesPromises = directMessageEvents.map(async directMessageEvent => {
            const storeValue = this.store.get(directMessageEvent.id, 'id')
            if (storeValue) {
                return Promise.resolve({ publishedDirectMessage: storeValue, rawEvent: directMessageEvent })
            }

            const isOwnMessage = directMessageEvent.pubkey === currentAuthPubKey
            let maybePolicyId: string | undefined
            try {
                maybePolicyId = getTagValue(directMessageEvent, TagType.Event)
            } catch (e) { maybePolicyId = undefined }
            const isGroupMessage = maybePolicyId !== undefined && await this.isValidPolicyId(maybePolicyId)
            const isValidOneToOneMessage = !isGroupMessage && getTagValues(directMessageEvent, TagType.PubKey).length === 1
            if (isGroupMessage) {
                const sharedKey = await this.getSharedKeysById([maybePolicyId!])
                const sharedKeyAuthenticator = sharedKey.get(maybePolicyId!)?.sharedKeyAuthenticator
                if (!sharedKeyAuthenticator) {
                    return Promise.resolve(null)
                }
                const decryptPromise = sharedKeyAuthenticator.decrypt(directMessageEvent.content)
                const conversationId = maybePolicyId!
                const conversation = chat._getConversation(conversationId)!
                return decryptPromise
                    .then(decryptedDirectMessage => {
                        const conversationId = maybePolicyId!
                        const publishedDirectMessage: PublishedDirectMessage = {
                            message: decryptedDirectMessage,
                            conversationId,
                            author: directMessageEvent.pubkey,
                            id: directMessageEvent.id,
                            createdAt: fromNostrDate(directMessageEvent.created_at)
                        }
                        conversation.messages.insertSorted(publishedDirectMessage)
                        return { publishedDirectMessage, rawEvent: directMessageEvent };
                    })
                    .catch(
                        e => {
                            console.error(`Error decrypting message ${directMessageEvent.id}: ${e.message}`);
                            return Promise.resolve(null);
                        });
            } else if (isValidOneToOneMessage) {
                const decryptPromise = isOwnMessage ? this.authenticator.decrypt(directMessageEvent.content, getTagValue(directMessageEvent, TagType.PubKey)) : this.authenticator.decrypt(directMessageEvent.content, directMessageEvent.pubkey)
                const conversationId = this.getConversationId(directMessageEvent.pubkey, getTagValue(directMessageEvent, TagType.PubKey))
                const conversation = chat._getConversation(conversationId)!
                return decryptPromise
                    .then(decryptedDirectMessage => {
                        const publishedDirectMessage: PublishedDirectMessage = {
                            id: directMessageEvent.id,
                            message: decryptedDirectMessage,
                            author: directMessageEvent.pubkey,
                            createdAt: fromNostrDate(directMessageEvent.created_at),
                            conversationId
                        }
                        conversation.messages.insertSorted(publishedDirectMessage)
                        return { publishedDirectMessage, rawEvent: directMessageEvent };
                    })
                    .catch(
                        e => {
                            console.error(`Error decrypting message with id ${directMessageEvent.id}: ${e.message}`);
                            return Promise.resolve(null);
                        });

            } else {
                return Promise.resolve(null);
            }
        })

        const results = await Promise.allSettled(messagesPromises)

        const validResults = results.reduce((acc, result) => {
            if (result.status === "fulfilled" && result.value !== null) {
                acc.push(result.value);
            }
            return acc;
        }, [] as { publishedDirectMessage: PublishedDirectMessage, rawEvent: Event<K> }[]);

        const publishedDirectMessages = validResults.map(res => res.publishedDirectMessage);
        const rawSignersEvents = validResults.map(res => res.rawEvent);

        this.store.store(publishedDirectMessages);
        this.eventsStore.store(rawSignersEvents);

        return publishedDirectMessages;
    }


    private async getDirectMessagesSync<K extends number>(directMessageEvents: Array<Event<K>>): Promise<PublishedDirectMessage[]> {
        if (!directMessageEvents.length) return []
        const publishedDirectMessages: PublishedDirectMessage[] = []
        const rawDirectMessageEvents: Array<Event<K>> = []
        const chat = this.getChat()
        for (const directMessageEvent of directMessageEvents) {
            const storeValue = this.store.get(directMessageEvent.id)
            if (storeValue) {
                publishedDirectMessages.push(storeValue)
                rawDirectMessageEvents.push(directMessageEvent)
                continue
            }
            const isOwnMessage = directMessageEvent.pubkey === this.authenticator.getPublicKey()
            let maybePolicyId: string | undefined
            try {
                maybePolicyId = getTagValue(directMessageEvent, TagType.Event)
            } catch (e) { maybePolicyId = undefined }
            const isGroupMessage = maybePolicyId !== undefined && await this.isValidPolicyId(maybePolicyId)
            const isValidOneToOneMessage = !isGroupMessage && getTagValues(directMessageEvent, TagType.PubKey).length === 1
            if (isGroupMessage) {
                const sharedKey = await this.getSharedKeysById([maybePolicyId!])
                const sharedKeyAuthenticator = sharedKey.get(maybePolicyId!)?.sharedKeyAuthenticator
                if (!sharedKeyAuthenticator) {
                    continue
                }
                try {
                    const message = await sharedKeyAuthenticator.decrypt(directMessageEvent.content)
                    const conversationId = maybePolicyId!
                    const publishedDirectMessage: PublishedDirectMessage = { message, conversationId, id: directMessageEvent.id, author: directMessageEvent.pubkey, createdAt: fromNostrDate(directMessageEvent.created_at) }
                    publishedDirectMessages.push(publishedDirectMessage)
                    rawDirectMessageEvents.push(directMessageEvent)
                    const conversation = chat._getConversation(conversationId)!
                    conversation.messages.insertSorted(publishedDirectMessage)
                } catch (e) {
                    console.error(`Error decrypting message  with id ${directMessageEvent.id}: ${e}`)
                }
            } else if (isValidOneToOneMessage) {
                try {
                    const message: string = isOwnMessage ? await this.authenticator.decrypt(directMessageEvent.content, getTagValue(directMessageEvent, TagType.PubKey)) : await this.authenticator.decrypt(directMessageEvent.content, directMessageEvent.pubkey)
                    const conversationId = this.getConversationId(directMessageEvent.pubkey, getTagValue(directMessageEvent, TagType.PubKey))
                    const publishedDirectMessage: PublishedDirectMessage = { message, conversationId, id: directMessageEvent.id, author: directMessageEvent.pubkey, createdAt: fromNostrDate(directMessageEvent.created_at) }
                    publishedDirectMessages.push(publishedDirectMessage)
                    rawDirectMessageEvents.push(directMessageEvent)
                    const conversation = chat._getConversation(conversationId)!
                    conversation.messages.insertSorted(publishedDirectMessage)
                } catch (e) {
                    console.error(`Error decrypting message with id ${directMessageEvent.id}: ${e}`)
                }
            }
        }

        this.store.store(publishedDirectMessages)
        this.eventsStore.store(rawDirectMessageEvents)
        return publishedDirectMessages
    }

    private getConversationId(author: string, receiver: string): string {
        const pubKey = this.authenticator.getPublicKey()
        if (pubKey === author) {
            return receiver
        } else {
            return author
        }
    }

    protected async _delete<K extends number>(directMessagesIds: string[]): Promise<void> {
        const tags: [TagType, string][] = []
        const rawEventsToDelete: Array<Event<K>> = []
        const messages: Array<Event<K>> = []
        for (const id of directMessagesIds) {
            const directMessageEvent: Event<K> = this.eventsStore.get(id)
            if (!directMessageEvent || directMessageEvent.pubkey !== this.authenticator.getPublicKey()) continue
            const publishedDirectMessage = this.store.get(id)
            tags.push([TagType.Event, directMessageEvent.id])
            const recipients = getTagValues(directMessageEvent, TagType.PubKey)
            for (const recipient of recipients) {
                tags.push([TagType.PubKey, recipient])
            }
            messages.push(publishedDirectMessage)
            rawEventsToDelete.push(directMessageEvent)
        }
        const deleteEvent = await buildEvent({
            kind: Kind.EventDeletion,
            content: '',
            tags,
        }, this.authenticator)
        const pub = this.nostrClient.publish(deleteEvent);
        await pub.onFirstOkOrCompleteFailure();
        this.store.delete(messages)
        this.eventsStore.delete(rawEventsToDelete)
    }
}
