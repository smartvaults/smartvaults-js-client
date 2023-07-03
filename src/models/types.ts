export type BasePolicy = {
  name: string;
  description: string;
  uiMetadata?: any;
};

export type Policy = BasePolicy & {
  descriptor: string
};

export type BitcoinOpts = {
  endpoint: string,
  network: string,
  requestStopGap: number, //miliseconds between requests to the esplora explorer
  syncTimeGap: number //minutes that have to pass after the last sync, to require another sync when performing an operation
}


export type Trx = {
  amount: number,
  psbt: string
}
