import { BaseOwnedSigner, Trx, FinalizeTrxResponse, UndecoratedBasicTrxDetails, UndecoratedTrxDetails, Utxo, PolicyPathSelector } from "./types"


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
  * @param {Map<string,Array<number>>} policy_path
  * @returns {Promise<any>}
  */
  build_trx(address: string, amount: string, fee_rate: string, policy_path?: Map<string, Array<number>>, utxos?: Array<string>, frozen_utxos?: Array<string>): Promise<Trx>;

  /**
  * @returns {Map<string, any>}
  */
  get_policy(): Map<string, any>;
  /**
  * @returns {any}
  */
  get_balance(): BalancePayload;

  finalize_trx(psbts: string[], broadcast: boolean): Promise<FinalizeTrxResponse>;

  get_trxs(): Promise<Array<UndecoratedBasicTrxDetails>>;

  get_trx(txid: string): Promise<UndecoratedTrxDetails>;

  get_utxos(): Array<Utxo>;

  network(): string;

  get_policy_path_from_signer(signer: BaseOwnedSigner): PolicyPathSelector | null

  get_policy_paths_from_signers(signers: Array<BaseOwnedSigner>): Map<string, PolicyPathSelector>

  search_used_signers(signers: Array<BaseOwnedSigner>): Array<BaseOwnedSigner>

}


export interface BitcoinUtil {
  walletSyncTimeGap: number //minutes that have to pass after the last sync, to require another sync when performing an operation
  toDescriptor(miniscript: string): string
  toMiniscript(descriptor: string): string
  createWallet(descriptor): Wallet
  canFinalizePsbt(psbts: string[]): boolean
  getTrxId(trx: any): string
  getFee(psbt: string): number
  getPsbtUtxos(psbt: string): Array<string>
}

