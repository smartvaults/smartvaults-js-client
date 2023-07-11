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
  build_trx(address: string, amount: string, fee_rate: string): Promise<any>;
  /**
  * @returns {any}
  */
  get_balance(): any;
}


export interface BitcoinUtil {
  walletSyncTimeGap: number //minutes that have to pass after the last sync, to require another sync when performing an operation
  toDescriptor(miniscript: string): string
  createWallet(descriptor): Wallet
}

