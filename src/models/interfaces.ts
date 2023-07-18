import { Trx, FinalizeTrxResponse, UndecoratedBasicTrxDetails, UndecoratedTrxDetails } from "./types"


type BalancePayload = {
  confirmed: number
  immature: number
  trusted_pending: number
  untrusted_pending: number
}


export interface Wallet {

  /**
  * @returns {string}
  */
  get_new_address(): string;
  /**
  * @returns {Promise<void>}
  */
  sync(): Promise<void>;
  /**
  * @param {string} address
  * @param {string} amount
  * @param {string} fee_rate
  * @returns {Promise<any>}
  */
  build_trx(address: string, amount: string, fee_rate: string): Promise<Trx>;
  /**
  * @returns {any}
  */
  get_balance(): BalancePayload;

  finalize_trx(psbts: string[], broadcast: boolean): Promise<FinalizeTrxResponse>;

  get_trxs(): Array<UndecoratedBasicTrxDetails>;

  get_trx(txid: string): Promise<UndecoratedTrxDetails>;
}


export interface BitcoinUtil {
  walletSyncTimeGap: number //minutes that have to pass after the last sync, to require another sync when performing an operation
  toDescriptor(miniscript: string): string
  createWallet(descriptor): Wallet
  canFinalizePsbt(psbts: string[]): boolean
}

