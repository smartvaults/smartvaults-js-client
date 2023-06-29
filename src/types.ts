type BasePolicy = {
  name: string;
  description: string;
  uiMetadata: any;
};

export type Published = {
  id: string
  createdAt: Date
};

export type Policy = BasePolicy & {
  descriptor: string;
};

export type PublishedPolicy = Policy & Published;

export type SavePolicyPayload = BasePolicy & {
  miniscript: string,
  createdAt?: Date
}
