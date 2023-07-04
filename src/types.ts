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

type BaseProposal = {
  to_address: string,
  description: string,
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

export type SpendProposalPayload = BaseProposal & {
  policy: PublishedPolicy,
  amountDescriptor: string,
  feeRatePriority: string,
  createdAt?: Date,
}

export type Proposal = BaseProposal & {
  descriptor: string,
  amount: number,
  psbt: string
}

export type PublishedProposal = Proposal & Published

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
