import { Kind, type Event } from 'nostr-tools'
import { EventKindHandler } from './EventKindHandler'
import { KeyAgent, Profile } from '../types'
import { Contact } from '../models'
import { NostrClient, type Store } from '../service'
import { type Authenticator } from '@smontero/nostr-ual'
import { buildEvent } from '../util'
import { TagType } from '../enum'
export class UnverifiedKeyAgentsHandler extends EventKindHandler {
    private readonly store: Store
    private readonly authenticator: Authenticator
    private readonly nostrClient: NostrClient
    private readonly getContacts: () => Promise<Array<Contact>>
    private readonly getProfiles: (pubkeys: string[]) => Promise<Array<Profile>>
    private readonly getVerifiedKeyAgentsPubKeys: () => Promise<string[]>
    constructor(store: Store, authenticator: Authenticator, nostrClient: NostrClient, getContacts: () => Promise<Array<Contact>>, getProfiles: (pubkeys: string[]) => Promise<Array<Profile>>, getVerifiedKeyAgentsPubKeys: () => Promise<string[]>) {
        super()
        this.store = store
        this.authenticator = authenticator
        this.nostrClient = nostrClient
        this.getContacts = getContacts
        this.getProfiles = getProfiles
        this.getVerifiedKeyAgentsPubKeys = getVerifiedKeyAgentsPubKeys
    }

    protected async _handle<K extends number>(keyAgentsEvents: Array<Event<K>>): Promise<Array<KeyAgent>> {
        if (!keyAgentsEvents.length) return [];

        const verifiedKeyAgentsPubKeys = new Set(await this.getVerifiedKeyAgentsPubKeys());

        const unverifiedKeyAgentsEvents = keyAgentsEvents.filter(event => !verifiedKeyAgentsPubKeys.has(event.pubkey));
        if (!unverifiedKeyAgentsEvents.length) return [];

        const indexKey = 'pubkey';
        const unverifiedKeyAgentsPubKeys = unverifiedKeyAgentsEvents.map(event => event.pubkey);
        const missingKeyAgentsPubKeys = this.store.missing(unverifiedKeyAgentsPubKeys, indexKey);
        const [contacts, profiles] = await Promise.all([
            this.getContacts(),
            this.getProfiles(missingKeyAgentsPubKeys)
        ]);

        const contactsSet = new Set(contacts.map(contact => contact.publicKey));
        const profilesMap = new Map(profiles.map(profile => [profile.publicKey, profile]));
        const keyAgents: Array<KeyAgent> = []

        for (const event of unverifiedKeyAgentsEvents) {
            const pubkey = event.pubkey;
            const isCached = this.store.has(pubkey, indexKey);
            const isContact = contactsSet.has(pubkey);
            if (isCached) {
                this.store.get(pubkey, indexKey).isContact = isContact;
                continue;
            }
            const profile = profilesMap.get(pubkey) || { publicKey: pubkey };

            keyAgents.push({ pubkey, profile, isContact, isVerified: false, eventId: event.id });
        };

        this.store.store(keyAgents);

        return this.store.getManyAsArray(unverifiedKeyAgentsPubKeys, indexKey);
    }

    protected async _delete(keyAgentIds: string[]): Promise<void> {
        const tags = keyAgentIds.map(id => [TagType.Event, id])
        const deleteEvent = await buildEvent({
            kind: Kind.EventDeletion,
            content: '',
            tags
        }, this.authenticator)
        await this.nostrClient.publish(deleteEvent).onFirstOkOrCompleteFailure();
        const keyAgents = this.store.getManyAsArray(keyAgentIds, 'eventId');
        if (keyAgents.length) this.store.delete(keyAgents);
    }
}