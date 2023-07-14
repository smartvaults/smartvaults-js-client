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


export type FinalizeTrxResponse = {
  trx_id: string
  trx: any
  psbt: string
}