import { BasePolicy, PublishedPolicy } from './models'

type BaseSharedSigner = {
  descriptor: string;
  fingerprint: string;
};

type BaseOwnedSigner = {
  description: any,
  descriptor: string,
  fingerprint: string,
  name: string,
  t: string,
}


export type Published = {
  id: string
  createdAt: Date
};

export type DirectMessage = {
  message: string
  publicKey: string
}

export type PublishedDirectMessage = DirectMessage & Published

export type SharedSigner = BaseSharedSigner & {
  ownerPubKey?: string;
};

export type PublishedSharedSigner = SharedSigner & Published;

export type OwnedSigner = BaseOwnedSigner & {
  ownerPubKey?: string;
};

export type PublishedOwnedSigner = OwnedSigner & Published;


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
}

export type Metadata = {
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

export type Profile = Metadata & {
  publicKey: string
}

export type ContactProfile = Profile & {
  publicKey: string
  relay?: string
  petname?: string
}
type BaseProposal = {
  descriptor: string
  psbt: string // to be change to PSBT
}

export type SpendingProposal = BaseProposal & {
  to_address: string
  amount: number
  description: string
}

export type ProofOfReserveProposal = BaseProposal & {
  message: string
}
type PublishedProposal = {
  policy_id: string
  proposal_id: string
  type: string
  signer: string
  status: string
}

type BaseApprovedProposal = {
  psbt: string
}

export type PublishedApprovedProposal = BaseApprovedProposal & {
  proposal_id: string,
  policy_id: string,
  approved_by: string,
  approval_date : Date,
  expiration_date: Date,
  status: string,
}

export type PublishedSpendingProposal = SpendingProposal & PublishedProposal
export type PublishedProofOfReserveProposal = ProofOfReserveProposal & PublishedProposal

export type CompletedSpendingProposal = {
  tx: string
  description : string
}


export type CompletedProofOfReserveProposal = ProofOfReserveProposal

type PublishedCompleted = {
  proposal_id: string
  policy_id: string
  completed_by: string
  completion_date: Date
  status: string
}
export type PublishedCompletedSpendingProposal = CompletedSpendingProposal & PublishedCompleted

export type PublishedCompletedProofOfReserveProposal = CompletedProofOfReserveProposal & PublishedCompleted

