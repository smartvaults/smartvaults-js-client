import { TransactionMetadata } from "../types";

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
  unconfirmed_last_seen?: number,
  confirmation_time?: UndecoratedBasicConfirmationTime
}

export type BasicTrxDetails = UndecoratedBasicTrxDetails & {
  confirmation_time?: BasicConfirmationTime
  unconfirmedLastSeenAt?: Date,
  net: number
  netFiat?: number
  receivedFiat?: number
  sentFiat?: number
  feeFiat?: number
  netFiatAtConfirmation?: number
  feeFiatAtConfirmation?: number
  btcExchangeRateAtConfirmation?: number
}

export type AugmentedTransactionDetails = BasicTrxDetails & {
  label?: TransactionMetadata
  labelId?: string
  date?: Date
  costBasis?: number
  proceeds?: number
  type?: string
  capitalGainsLoses?: number
  associatedCostBasis?: string
}

export type TrxInput = {
  txid: string,
  amount: number
  amountFiat?: number
}

export type TrxOutput = {
  txid: string,
  amount: number
  amountFiat?: number
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

export type UtxoTxOut = {
  script_pubkey: string,
  value: number,
  valueFiat?: number
}

export type LocalUtxo = {
  outpoint: string,
  txout: UtxoTxOut,
  is_spent: boolean,
  keychain: string
}

export type Utxo = {
  address: string,
  utxo: LocalUtxo
}

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

export type PolicyPathSelector = {
  partial?: {
    selected_path: Map<String, Array<number>>,
    missing_to_select: Map<String, Array<String>>,
  },
  complete?: {
    path: Map<String, Array<number>>,
  }
}

export type PolicyPathsResult = {
  multiple?: Map<String, PolicyPathSelector | null>,
  single?: PolicyPathSelector,
  none?: boolean,
}

export type DatePeriod = {
  start: Date,
  end: Date,
}