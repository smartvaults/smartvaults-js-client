export class CurrencyUtil {

    static fromSatsToBitcoin(sats: number): number {
        return sats / 100_000_000;
    }

    static toRoundedFloat(num: number, precision: number = 2): number {
        return parseFloat(num.toFixed(precision));
    }

}