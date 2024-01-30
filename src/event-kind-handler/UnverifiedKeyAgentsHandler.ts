import { type Event } from 'nostr-tools'
import { EventKindHandler } from './EventKindHandler'
import { KeyAgent, Profile } from '../types'
import { Contact } from '../models'
import { type Store } from '../service'

export class UnverifiedKeyAgentsHandler extends EventKindHandler {
    private readonly getContacts: () => Promise<Array<Contact>>
    private readonly getProfiles: (pubkeys: string[]) => Promise<Array<Profile>>
    private readonly getVerifiedKeyAgentsPubKeys: () => Promise<string[]>
    private readonly store: Store
    constructor(store: Store, getContacts: () => Promise<Array<Contact>>, getProfiles: (pubkeys: string[]) => Promise<Array<Profile>>, getVerifiedKeyAgentsPubKeys: () => Promise<string[]>) {
        super()
        this.store = store
        this.getContacts = getContacts
        this.getProfiles = getProfiles
        this.getVerifiedKeyAgentsPubKeys = getVerifiedKeyAgentsPubKeys
    }

    protected async _handle<K extends number>(keyAgentsEvents: Array<Event<K>>): Promise<Array<KeyAgent>> {
        if (!keyAgentsEvents.length) return [];

        const verifiedKeyAgentsPubKeys = new Set(await this.getVerifiedKeyAgentsPubKeys());

        const unverifiedKeyAgentsEvents = keyAgentsEvents.filter(event => !verifiedKeyAgentsPubKeys.has(event.pubkey));
        if (!unverifiedKeyAgentsEvents.length) return [];

        const unverifiedKeyAgentsPubKeys = unverifiedKeyAgentsEvents.map(event => event.pubkey);
        const missingKeyAgentsPubKeys = this.store.missing(unverifiedKeyAgentsPubKeys);
        const [contacts, profiles] = await Promise.all([
            this.getContacts(),
            this.getProfiles(missingKeyAgentsPubKeys)
        ]);

        const contactsSet = new Set(contacts.map(contact => contact.publicKey));
        const profilesMap = new Map(profiles.map(profile => [profile.publicKey, profile]));

        const keyAgents: Array<KeyAgent> = []

        for (const pubkey of unverifiedKeyAgentsPubKeys) {
            const isCached = this.store.has(pubkey);
            const isContact = contactsSet.has(pubkey);
            if (isCached) {
                this.store.get(pubkey).isContact = isContact;
                continue;
            }
            const profile = profilesMap.get(pubkey) || { publicKey: pubkey };

            keyAgents.push({ pubkey, profile, isContact, isVerified: false });
        };

        this.store.store(keyAgents);

        return this.store.getManyAsArray(unverifiedKeyAgentsPubKeys, 'pubkey');
    }
}