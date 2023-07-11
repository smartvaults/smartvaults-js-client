export class Balance {
  confirmed: number
  immature: number
  trustedPending: number
  untrustedPending: number

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
  }) {
    this.confirmed = confirmed
    this.immature = immature
    this.trustedPending = trusted_pending
    this.untrustedPending = untrusted_pending
  }

  totalBalance() {
    return this.spendableBalance() + this.immature + this.untrustedPending
  }

  spendableBalance() {
    return this.confirmed + this.trustedPending
  }
}