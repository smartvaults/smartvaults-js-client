import { FiatCurrency, ProposalType, DeviceType, Temperature, Magic } from './enum';
import { BasePolicy, PublishedPolicy, Utxo, BaseOwnedSigner, BaseSharedSigner } from './models'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import { type DoublyLinkedList } from './util'

export type Published = {
  id: string
  createdAt: Date
};

export type DirectMessage = {
  message: string
  author: string
}

export type PublishedDirectMessage = DirectMessage & Published & {
  conversationId: string
}

export type Conversation = {
  conversationId: string
  messages: DoublyLinkedList<PublishedDirectMessage>
  participants: string[]
  hasUnreadMessages: boolean
  isGroupChat: boolean
}

export type PublishedSharedSigner = BaseSharedSigner & Published & {
  ownerPubKey?: string;
  key: string;
}

export type PublishedOwnedSigner = BaseOwnedSigner & Published & {
  ownerPubKey?: string;
  key: string;
}


export type SavePolicyPayload = BasePolicy & {
  miniscript: string,
  nostrPublicKeys: string[],
  createdAt?: Date,
}

export type SpendProposalPayload = {
  policy: PublishedPolicy,
  to_address: string,
  description: string,
  amountDescriptor: string,
  feeRatePriority: string,
  createdAt?: Date,
  policyPath?: Map<string, Array<number>>
  utxos?: Array<string>
  useFrozenUtxos?: boolean
  keyAgentPayment?: BaseKeyAgentPaymentProposal
}

export type Metadata = KeyAgentMetadata & {
  /// Name
  name?: string,
  /// Display name
  display_name?: string,
  /// Description
  about?: string,
  /// Website url
  website?: string,
  /// Picture url
  picture?: string,
  /// Banner url
  banner?: string,
  /// NIP05 (ex. name@example.com)
  nip05?: string,
  /// LNURL
  lud06?: string,
  /// Lightning Address
  lud16?: string,
  /// Custom fields
  custom?: Map<String, string>,
}

export type KeyAgentMetadata = {
  jurisdiction?: string,
  x?: string,
  facebook?: string,
  linkedin?: string,
  smartvaults_nip05?: string,
}

export type Profile = Metadata & {
  publicKey: string
  isKeyAgent: boolean
  isVerified: boolean
}

export type ContactProfile = Profile & {
  publicKey: string
  relay?: string
  petname?: string
}
type BaseProposal = {
  descriptor: string
  psbt: string
}

type BaseSpendingProposal = {
  to_address: string
  amount: number
  description: string,
}

export type SpendingProposal = {
  [key: string]: BaseProposal & BaseSpendingProposal
}

export type ProofOfReserveProposal = {
  [key: string]: BaseProposal & {
    message: string
  }
}

type PublishedProposal = {
  policy_id: string
  proposal_id: string
  type: ProposalType
  createdAt: Date
  status: string
  signer: string
  fee: number
  feeFiat?: number
}

export type BaseApprovedProposal = {
  [key: string]: {
    psbt: string
  }
}

export type PublishedApprovedProposal = {
  type: ProposalType,
  psbt: string,
  proposal_id: string,
  policy_id: string,
  approval_id: string,
  approved_by: string,
  approval_date: Date,
  expiration_date: Date,
  status: string,
}

export type PublishedSpendingProposal = PublishedProposal & BaseProposal & BaseSpendingProposal & BaseFiat & {
  amountFiat?: number
  utxos: string[]
}
export type PublishedProofOfReserveProposal = PublishedProposal & BaseProposal & {
  message: string
  utxos?: string[]
}

type BaseFiat = {
  activeFiatCurrency?: string
  bitcoinExchangeRate?: number
}

type BaseCompletedProposal = {
  tx: string
  description: string
}

export type CompletedSpendingProposal = {
  [key: string]: BaseCompletedProposal
}


export type CompletedProofOfReserveProposal = ProofOfReserveProposal

type PublishedCompleted = {
  type: ProposalType
  proposal_id: string
  policy_id: string
  completed_by: string
  completion_date: Date
  id: string
}

export type PublishedCompletedSpendingProposal = PublishedCompleted & {
  tx: string
  txId: string
  description: string
}

export type PublishedCompletedProofOfReserveProposal = PublishedCompleted & BaseProposal & {
  message: string
}


export type SharedKeyAuthenticator = {
  id: string
  policyId: string
  creator: string
  sharedKeyAuthenticator: DirectPrivateKeyAuthenticator
  privateKey: string
}

export type MySharedSigner = {
  id: string
  signerId: string
  sharedWith: string
  sharedDate: Date
}

export type TransactionMetadata = {
  data: Data
  text?: string
  costBasis?: { [key: string]: number }
  proceeds?: { [key: string]: number }
  btcExchangeRate?: { [key: string]: number }
}

export type Data = {
  [key: string]: string
}

export type PublishedTransactionMetadata = Published & {
  transactionMetadata: TransactionMetadata
  transactionMetadataId: string
  policy_id: string
  txId: string
}

export type LabeledUtxo = Utxo & {
  label?: string
  labelId?: string
  frozen: boolean
}

type BitcoinCurrency = 'SAT' | 'BTC'
type Currency = Uppercase<FiatCurrency> | BitcoinCurrency

export type Price = {
  currency: Currency,
  amount: number,
}

type Other = string

export type SignerOffering = {
  temperature: Temperature | Other,
  device_type: DeviceType | Other,
  response_time: number,
  cost_per_signature?: Price,
  yearly_cost_basis_points?: number,
  yearly_cost?: Price,
  network?: Magic,
}

export type PublishedSignerOffering = Published & SignerOffering & {
  keyAgentPubKey: string,
  offeringId: string,
  signerFingerprint?: string,
  signerDescriptor?: string,
  latestContactEventId?: string,
}

export type KeyAgent = {
  pubkey: string,
  profile: Profile,
  isVerified: boolean,
  isContact: boolean,
  approvedAt?: Date,
  eventId?: string,
}

export type BaseVerifiedKeyAgentData = { approved_at: number }

export type BaseVerifiedKeyAgents = {
  [key: string]: BaseVerifiedKeyAgentData
}

export type Period = {
  from: number,
  to: number,
}

export type KeyAgentPaymentProposal = {
  [key: string]: BaseProposal & BaseKeyAgentPaymentProposal & {
    amount: number,
    description: string,
  }
}

export type CompletedKeyAgentPaymentProposal = {
  [key: string]: BaseKeyAgentPaymentProposal & BaseCompletedProposal
}

export type KeyAgentPaymentProposalPayload = SpendProposalPayload & {
  keyAgentPayment: BaseKeyAgentPaymentProposal
}

export type BaseKeyAgentPaymentProposal = {
  signer_descriptor: string,
  period: Period,
}

export type PublishedKeyAgentPaymentProposal = PublishedProposal & BaseProposal & BaseKeyAgentPaymentProposal & BaseSpendingProposal & BaseFiat & {
  amountFiat?: number
  utxos: string[]
}

export type CompletedProposal = CompletedSpendingProposal | CompletedProofOfReserveProposal | CompletedKeyAgentPaymentProposal

export type PublishedCompletedKeyAgentPaymentProposal = PublishedCompleted & BaseProposal & BaseKeyAgentPaymentProposal & BaseCompletedProposal

export type ActivePublishedProposal = PublishedSpendingProposal | PublishedProofOfReserveProposal | PublishedKeyAgentPaymentProposal

export type CompletedPublishedProposal = PublishedCompletedSpendingProposal | PublishedCompletedProofOfReserveProposal | PublishedCompletedKeyAgentPaymentProposal

export type Input = {
  non_witness_utxo?: any
  witness_utxo?: any
  partial_sigs: any
  sighash_type?: any
  redeem_script?: any
  witness_script?: any
  bip32_derivation: any[]
  final_script_sig?: any
  final_script_witness?: any
  ripemd160_preimages: any,
  sha256_preimages: any,
  hash160_preimages: any,
  hash256_preimages: any,
  tap_key_sig?: any,
  tap_script_sigs: any[],
  tap_scripts: any[],
  tap_key_origins: any[],
  tap_internal_key?: string,
  tap_merkle_root?: string,
  proprietary: any[],
  unknown: any[],
}

export type Output = {
  redeem_script?: any
  witness_script?: any
  bip32_derivation: any[]
  tap_internal_key?: string,
  tap_tree?: any[],
  tap_key_origins: any[],
  proprietary: any[],
  unknown: any[],
}

export type TxIn = {
  previuos_output: string
  script_sig: string
  sequence: number
  witness: any[]
}

export type TxOut = {
  value: number
  script_pubkey: string
}

export type Transaction = {
  version: number
  lock_time: number
  input: TxIn[]
  output: TxOut[]
}

export type PsbtObject = {
  inputs: Input[]
  outputs: Output[]
  proprietary: any[]
  unknown: any[]
  unsigned_tx: Transaction
  version: number
  xpub: any
}

export type DirectMessagesPayload = {
  messages: PublishedDirectMessage[]
  newConversationsIds: string[]
}