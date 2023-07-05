export type BasePolicy = {
  name: string;
  description: string;
  uiMetadata?: any;
};

export type Policy = BasePolicy & {
  descriptor: string
};

export type Trx = {
  amount: number,
  psbt: string
}
