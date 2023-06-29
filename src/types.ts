type BasePolicy = {
  name: string;
  description: string;
  uiMetadata: any;
};

export type Policy = BasePolicy & {
  descriptor: string;
};

export type PublishedPolicy = Policy & {
  id: string
};

export type SavePolicyPayload = BasePolicy & {
  miniscript: string,
}
