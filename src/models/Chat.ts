import { PublishedDirectMessage, Conversation } from "../types";
import { PubPool } from "../service";
import { DoublyLinkedList, PaginationOpts } from "../util";


type ChatHelpers = {
    sendMessage: (message: string, conversationId: string) => Promise<[PubPool, PublishedDirectMessage]>;
    getDirectMessagesByConversationId: (conversationId?: string, paginationOpts?: PaginationOpts) => Promise<Map<string, PublishedDirectMessage[]>>;
    getGroupsIds: () => Promise<Set<string>>;
    getPolicyMembers: (policyId: string) => Promise<string[]>;
    deleteDirectMessages: (messageIds: string | string[]) => Promise<void>;
    getConversations: (paginationOpts: PaginationOpts, contacsOnly: boolean) => Promise<Conversation[]>;
}


export class Chat {
    private conversations: Map<string, Conversation> = new Map<string, Conversation>();
    private activeConversationId: string | undefined = undefined;
    private readonly sendMsg: (message: string, conversationId: string) => Promise<[PubPool, PublishedDirectMessage]>;
    private readonly getDirectMessagesByConversationId: (conversationId?: string, paginationOpts?: PaginationOpts) => Promise<Map<string, PublishedDirectMessage[]>>;
    private readonly getGroupsIds: () => Promise<Set<string>>;
    private readonly getPolicyMembers: (policyId: string) => Promise<string[]>;
    private readonly deleteDirectMessages: (messageIds: string | string[]) => Promise<void>;
    private readonly getConversationsWithoutMessages: (paginationOpts: PaginationOpts, contactsOnly: boolean) => Promise<Conversation[]>;

    constructor(helpers: ChatHelpers) {
        this.sendMsg = helpers.sendMessage;
        this.getDirectMessagesByConversationId = helpers.getDirectMessagesByConversationId;
        this.getGroupsIds = helpers.getGroupsIds;
        this.getPolicyMembers = helpers.getPolicyMembers;
        this.deleteDirectMessages = helpers.deleteDirectMessages;
        this.getConversationsWithoutMessages = helpers.getConversations;
    }

    private async addMessagesToConversation(conversationId: string, messages: PublishedDirectMessage | PublishedDirectMessage[]): Promise<void> {
        const conversation = this.conversations.get(conversationId);
        if (conversation) {
            conversation.messages.insertSorted(messages);
            conversation.hasUnreadMessages = conversationId !== this.activeConversationId;
        } else {
            const groupIds = await this.getGroupsIds();
            const isGroupChat = groupIds.has(conversationId);
            const conversation: Conversation = {
                conversationId,
                messages: new DoublyLinkedList<PublishedDirectMessage>(messages),
                participants: isGroupChat ? await this.getPolicyMembers(conversationId) : [conversationId],
                hasUnreadMessages: conversationId !== this.activeConversationId,
                isGroupChat,
            }
            this.conversations.set(conversationId, conversation);
        }
    }

    private async updateConversationMessages(conversationId: string, paginationOpts?: PaginationOpts): Promise<void> {
        await this.getDirectMessagesByConversationId(conversationId, paginationOpts)
    }


    public async sendMessage(message: string, conversationId: string): Promise<PublishedDirectMessage> {
        const [pub, publishedDirectMessage] = await this.sendMsg(message, conversationId);
        await pub.onFirstOkOrCompleteFailure()
        await this.addMessagesToConversation(conversationId, publishedDirectMessage);
        return publishedDirectMessage;
    }

    public async deleteMessage(messageId: string, conversationId: string): Promise<void> {
        const conversation = this.conversations.get(conversationId);
        if (!conversation) throw new Error('Conversation not found');
        const message = conversation.messages.find(messageId);
        if (!message) throw new Error('Message not found');
        await this.deleteDirectMessages(messageId);
        conversation.messages.remove(messageId);
    }

    public setActiveConversation(conversationId: string): void {
        this.activeConversationId = conversationId;
    }

    public getActiveConversationId(): string | undefined {
        return this.activeConversationId;
    }

    public async getConversationMessages(conversationId: string, paginationOpts?: PaginationOpts): Promise<PublishedDirectMessage[]> {
        await this.updateConversationMessages(conversationId, paginationOpts);
        return this.conversations.get(conversationId)?.messages.toArray() || [];
    }

    public async getActiveConversationMessages(): Promise<PublishedDirectMessage[]> {
        if (!this.activeConversationId) throw new Error('No active conversation');
        return this.getConversationMessages(this.activeConversationId);
    }

    public async getConversations(paginationOpts?: PaginationOpts, contactsOnly: boolean = false): Promise<Conversation[]> {
        paginationOpts = paginationOpts || {}
        const conversations = await this.getConversationsWithoutMessages(paginationOpts, contactsOnly)
        return conversations
    }

    public async getConversation(conversationId: string, paginationOpts?: PaginationOpts): Promise<Conversation> {
        if (!this.conversations.has(conversationId)) throw new Error('Conversation not found');
        await this.updateConversationMessages(conversationId, paginationOpts);
        return this.conversations.get(conversationId)!;
    }

    public _getConversation(conversationId: string): Conversation {
        if (!this.conversations.has(conversationId)) throw new Error('Conversation not found');
        return this.conversations.get(conversationId)!;
    }

    public getConversationParticipants(conversationId: string): string[] {
        return this.conversations.get(conversationId)?.participants || [];
    }

    public getConversationHasUnreadMessages(conversationId: string): boolean {
        return this.conversations.get(conversationId)?.hasUnreadMessages || false;
    }

    public setConversationHasUnreadMessages(conversationId: string, hasUnreadMessages: boolean): void {
        const conversation = this.conversations.get(conversationId);
        if (conversation) {
            conversation.hasUnreadMessages = hasUnreadMessages;
        }
    }


}