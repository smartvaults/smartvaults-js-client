import { ProposalType } from './enum';
import { BasePolicy, PublishedPolicy } from './models'
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'

export type BaseSharedSigner = {
  descriptor: string;
  fingerprint: string;
};

export type BaseOwnedSigner = {
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
  policyPath?: Map<string, Array<number>>
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

export type SpendingProposal = {
  [key: string]: BaseProposal & {
    to_address: string
    amount: number
    description: string,
  }
}

export type ProofOfReserveProposal = {
  [key: string]: BaseProposal & {
    message: string
  }
}

type PublishedProposal = {
  policy_id: string
  proposal_id: string
  type: string
  createdAt: Date
  status: string
  signer: string
  fee: number
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

export type PublishedSpendingProposal = PublishedProposal & BaseProposal & {
  to_address: string
  amount: number
  description: string,
}
export type PublishedProofOfReserveProposal = PublishedProposal & BaseProposal & {
  message: string
}

export type CompletedSpendingProposal = {
  [key: string]: {
    tx: string
    description: string
  }
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
  private: string
}

export type MySharedSigner = {
  id: string
  signerId: string
  sharedWith: string
  sharedDate: Date
}

export type Label = {
  data: string
  text: string
}

export type PublishedLabel = Published & {
  label: Label
  label_id: string
  policy_id: string
}