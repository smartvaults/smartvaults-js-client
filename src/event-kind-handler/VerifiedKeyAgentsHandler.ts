import { type Event } from 'nostr-tools'
import { EventKindHandler } from './EventKindHandler'
import { KeyAgent } from '../types'

export class VerifiedKeyAgentsHandler extends EventKindHandler {

    protected async _handle<K extends number>(verfiedKeyAgentsEvent: Array<Event<K>>): Promise<Array<KeyAgent>> {
        if (!verfiedKeyAgentsEvent.length) return []
        return JSON.parse(verfiedKeyAgentsEvent[0].content) // TODO 
    }
}