import { PublishedDirectMessage, Conversation } from "../types";
import { PubPool } from "../service";
import { DoublyLinkedList, PaginationOpts } from "../util";


type ChatHelpers = {
    sendMessage: (message: string, conversationId: string) => Promise<[PubPool, PublishedDirectMessage]>;
    getDirectMessagesByConversationId: (conversationId?: string, paginationOpts?: PaginationOpts) => Promise<Map<string, PublishedDirectMessage[]>>;
    getGroupsIds: () => Promise<Set<string>>;
    getPolicyMembers: (policyId: string) => Promise<string[]>;
    deleteDirectMessages: (messageIds: string | string[]) => Promise<void>;
}


export class Chat {
    private conversations: Map<string, Conversation> = new Map<string, Conversation>();
    private activeConversationId: string | undefined = undefined;
    private readonly sendMsg: (message: string, conversationId: string) => Promise<[PubPool, PublishedDirectMessage]>;
    private readonly getDirectMessagesByConversationId: (conversationId?: string, paginationOpts?: PaginationOpts) => Promise<Map<string, PublishedDirectMessage[]>>;
    private readonly getGroupsIds: () => Promise<Set<string>>;
    private readonly getPolicyMembers: (policyId: string) => Promise<string[]>;
    private readonly deleteDirectMessages: (messageIds: string | string[]) => Promise<void>;

    constructor(helpers: ChatHelpers) {
        this.sendMsg = helpers.sendMessage;
        this.getDirectMessagesByConversationId = helpers.getDirectMessagesByConversationId;
        this.getGroupsIds = helpers.getGroupsIds;
        this.getPolicyMembers = helpers.getPolicyMembers;
        this.deleteDirectMessages = helpers.deleteDirectMessages;
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
                messages: new DoublyLinkedList<PublishedDirectMessage>(),
                members: isGroupChat ? await this.getPolicyMembers(conversationId) : [conversationId],
                hasUnreadMessages: conversationId !== this.activeConversationId,
                isGroupChat,
            }
            conversation.messages.insertSorted(messages);
            this.conversations.set(conversationId, conversation);
        }
    }

    private async updateConversationMessages(conversationId: string, paginationOpts?: PaginationOpts): Promise<void> {
        const conversationMessages = (await this.getDirectMessagesByConversationId(conversationId, paginationOpts)).get(conversationId)
        if (!conversationMessages) return;
        await this.addMessagesToConversation(conversationId, conversationMessages);
    }

    private async updateAllConversationsMessages(paginationOpts?: PaginationOpts): Promise<void> {
        const conversationMessages = await this.getDirectMessagesByConversationId(undefined, paginationOpts);
        for (const [conversationId, messages] of conversationMessages.entries()) {
            await this.addMessagesToConversation(conversationId, messages);
        };
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

    public async getConversationMessages(conversationId: string): Promise<PublishedDirectMessage[]> {
        await this.updateConversationMessages(conversationId);
        return this.conversations.get(conversationId)?.messages.toArray() || [];
    }

    public async getActiveConversationMessages(): Promise<PublishedDirectMessage[]> {
        if (!this.activeConversationId) throw new Error('No active conversation');
        return this.getConversationMessages(this.activeConversationId);
    }

    public async getConversations(paginationOpts?: PaginationOpts): Promise<Map<string, Conversation>> {
        await this.updateAllConversationsMessages(paginationOpts);
        return this.conversations;
    }

    public async getConversation(conversationId: string, paginationOpts?: PaginationOpts): Promise<Conversation> {
        if (!this.conversations.has(conversationId)) throw new Error('Conversation not found');
        await this.updateConversationMessages(conversationId, paginationOpts);
        return this.conversations.get(conversationId)!;
    }

    public getConversationMembers(conversationId: string): string[] {
        return this.conversations.get(conversationId)?.members || [];
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