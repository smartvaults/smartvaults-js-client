type BasePolicy = {
  name: string;
  description: string;
  uiMetadata: any;
};

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

export type Policy = BasePolicy & {
  descriptor: string;
};

export type SharedSigner = BaseSharedSigner & {
  ownerPubKey?: string;
  sharedDate?: number;
};

export type OwnedSigner = BaseOwnedSigner & {
  ownerPubKey?: string;
  createdAt?: number;
};

export type PublishedPolicy = Policy & Published;

export type SavePolicyPayload = BasePolicy & {
  miniscript: string,
  createdAt?: Date,
}
