import { type Event } from 'nostr-tools'
import { getTagValues } from '../util'
import { TagType } from '../enum'
import { EventKindHandler } from './EventKindHandler'
import { Contact } from '../models'

export class ContactsHandler extends EventKindHandler {
    constructor() {
        super()
    }
    protected async _handle<K extends number>(contactsEvent: Array<Event<K>>): Promise<Contact[]> {
        return getTagValues(contactsEvent[0], TagType.PubKey, (params) => Contact.fromParams(params))
    }
}