import { BitcoinExchangeRate } from "../util"
export class Balance {
  confirmed: number
  immature: number
  trustedPending: number
  untrustedPending: number
  confirmedFiat?: number
  immatureFiat?: number
  trustedPendingFiat?: number
  untrustedPendingFiat?: number
  private readonly bitcoinExchangeRate: BitcoinExchangeRate = BitcoinExchangeRate.getInstance();
  constructor({
    confirmed,
    immature,
    trusted_pending,
    untrusted_pending,
  }: {
    confirmed: number
    immature: number
    trusted_pending: number
    untrusted_pending: number
  }
  ) {
    this.confirmed = confirmed
    this.immature = immature
    this.trustedPending = trusted_pending
    this.untrustedPending = untrusted_pending
    try {
      this.calculateFiatValues();
    } catch (e) {
      console.warn(`Failed to calculate fiat values: ${e}`);
    }
  }

  totalBalance() {
    return this.spendableBalance() + this.immature + this.untrustedPending
  }

  spendableBalance() {
    return this.confirmed + this.trustedPending
  }

  private async calculateFiatValues() {
    [this.confirmedFiat, this.immatureFiat, this.trustedPendingFiat, this.untrustedPendingFiat] = await this.bitcoinExchangeRate.convertToFiat([this.confirmed, this.immature, this.trustedPending, this.untrustedPending]);
  }


}