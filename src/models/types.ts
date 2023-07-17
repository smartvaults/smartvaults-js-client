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

export type UndecoratedConfirmationTime = {
  height: number,
  timestamp: number,
}

export type ConfirmationTime = UndecoratedConfirmationTime & {
  confirmedAt: Date,
  confirmations: number
}

export type UndecoratedBasicTrxDetails = {
  txid: string
  received: number,
  sent: number,
  fee: number,
  confirmation_time?: ConfirmationTime
}

export type BasicTrxDetails = UndecoratedBasicTrxDetails & {
  net: number
}

export type TrxInput = {
  txid: string,
  amount: number
}

export type TrxOutput = {
  txid: string,
  amount: number
}

type AdditionalTrxDetails = {
  inputs: Array<TrxInput>,
  outputs: Array<TrxOutput>,
  lock_time: number
}

export type UndecoratedTrxDetails = UndecoratedBasicTrxDetails & AdditionalTrxDetails

export type TrxDetails = BasicTrxDetails & AdditionalTrxDetails


export type FinalizeTrxResponse = {
  txid: string
  trx: any
  psbt: string
}