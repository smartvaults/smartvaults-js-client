import { type Event } from 'nostr-tools'
import { EventKindHandler } from './EventKindHandler'
import { KeyAgent, Profile, BaseVerifiedKeyAgents } from '../types'
import { Contact } from '../models'
import { fromNostrDate } from '../util'
import { type Store } from '../service'

export class VerifiedKeyAgentsHandler extends EventKindHandler {
    private readonly getContacts: () => Promise<Array<Contact>>
    private readonly getProfiles: (pubkeys: string[]) => Promise<Array<Profile>>
    private readonly store: Store

    constructor(store: Store, getContacts: () => Promise<Array<Contact>>, getProfiles: (pubkeys: string[]) => Promise<Array<Profile>>) {
        super()
        this.store = store
        this.getContacts = getContacts
        this.getProfiles = getProfiles
    }

    protected async _handle<K extends number>(verifiedKeyAgentsEvents: Array<Event<K>>): Promise<Array<KeyAgent>> {
        if (!verifiedKeyAgentsEvents.length) return []
        if (verifiedKeyAgentsEvents.length > 1) throw new Error('More than one verified key agents event found')
        const verifiedKeyAgentsEvent = verifiedKeyAgentsEvents[0]
        const keyAgents: BaseVerifiedKeyAgents = JSON.parse(verifiedKeyAgentsEvent.content)
        const keyAgentsPubkeys = Object.keys(keyAgents)
        if (this.store.has(verifiedKeyAgentsEvent.id, 'eventId')) {
            const cachedKeyAgents = this.store.get(verifiedKeyAgentsEvent.id, 'eventId')
            return cachedKeyAgents
        }
        const [contacts, profiles] = await Promise.all([this.getContacts(), this.getProfiles(keyAgentsPubkeys)])
        const contactsSet = new Set(contacts.map(contact => contact.publicKey))
        const profilesMap = new Map(profiles.map(profile => [profile.publicKey, profile]))
        const verifiedKeyAgents: Array<KeyAgent> = []

        for (const [pubkey, data] of Object.entries(keyAgents)) {
            const isContact = contactsSet.has(pubkey);
            const profile = profilesMap.get(pubkey) || { publicKey: pubkey };
            const approvedAt = fromNostrDate(data.approved_at);
            verifiedKeyAgents.push({
                pubkey,
                profile,
                isContact,
                isVerified: true,
                approvedAt,
                eventId: verifiedKeyAgentsEvent.id
            });
        }

        this.store.store(verifiedKeyAgents)
        return verifiedKeyAgents;

    }
}