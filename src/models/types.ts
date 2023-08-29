export type BasePolicy = {
  name: string;
  description: string;
};

export type Policy = BasePolicy & {
  descriptor: string
};

export type Trx = {
  amount: number,
  psbt: string
}

export type UndecoratedBasicConfirmationTime = {
  height: number,
  timestamp: number,
}

export type UndecoratedConfirmationTime = UndecoratedBasicConfirmationTime & {
  confirmations: number
}

export type BasicConfirmationTime = UndecoratedBasicConfirmationTime & {
  confirmedAt: Date,
}

export type ConfirmationTime = UndecoratedConfirmationTime & {
  confirmedAt: Date,
}

export type UndecoratedBasicTrxDetails = {
  txid: string
  received: number,
  sent: number,
  fee: number,
  confirmation_time?: UndecoratedBasicConfirmationTime
}

export type BasicTrxDetails = UndecoratedBasicTrxDetails & {
  confirmation_time?: BasicConfirmationTime
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

export type UndecoratedTrxDetails = UndecoratedBasicTrxDetails & AdditionalTrxDetails & {
  confirmation_time?: UndecoratedConfirmationTime
}

export type TrxDetails = BasicTrxDetails & AdditionalTrxDetails & {
  confirmation_time?: ConfirmationTime
}


export type FinalizeTrxResponse = {
  txid: string
  trx: any
  psbt: string
}