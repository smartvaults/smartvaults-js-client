import { CurrencyUtil } from "../util"
export class Balance {
  confirmed: number
  immature: number
  trustedPending: number
  untrustedPending: number
  confirmedFiat?: number
  immatureFiat?: number
  trustedPendingFiat?: number
  untrustedPendingFiat?: number
  private bitcoinExchangeRate?: number
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
  },
    bitcoinExchangeRate: number | undefined,
  ) {
    this.confirmed = confirmed
    this.immature = immature
    this.trustedPending = trusted_pending
    this.untrustedPending = untrusted_pending
    this.bitcoinExchangeRate = bitcoinExchangeRate
    if (this.bitcoinExchangeRate) {
      this.calculateFiatValues();
    } else {
      console.warn('bitcoinExchangeRate not available. Fiat values will not be calculated.');
    }
  }

  totalBalance() {
    return this.spendableBalance() + this.immature + this.untrustedPending
  }

  spendableBalance() {
    return this.confirmed + this.trustedPending
  }

  private calculateFiatValues() {
    this.confirmedFiat = this.convertToFiat(this.confirmed);
    this.immatureFiat = this.convertToFiat(this.immature);
    this.trustedPendingFiat = this.convertToFiat(this.trustedPending);
    this.untrustedPendingFiat = this.convertToFiat(this.untrustedPending);
  }


  private convertToFiat(amount: number, unit: string = 'SAT'): number {
    if (!this.bitcoinExchangeRate) {
      throw new Error("No exchange rate found");
    }
    if (amount === 0 || this.bitcoinExchangeRate === 0) return 0;
    let bitcoin: number;
    if (unit === 'SAT') {
      bitcoin = CurrencyUtil.fromSatsToBitcoin(amount);
    } else if (unit === 'BTC') {
      bitcoin = amount;
    } else {
      throw new Error(`Unit ${unit} not supported`);
    }
    const fiat = bitcoin * this.bitcoinExchangeRate;
    return CurrencyUtil.toRoundedFloat(fiat);
  }
}