export class CurrencyUtil {

    static fromSatsToBitcoin(sats: number): number {
        return sats / 100_000_000;
    }

    static fromBitcoinToSats(bitcoin: number): number {
        return bitcoin * 100_000_000;
    }

    static toRoundedFloat(num: number, precision: number = 2): number {
        return parseFloat(num.toFixed(precision));
    }

    static fromBasisPointsToDecimal(basisPoints: number): number {
        return basisPoints / 10_000;
    }

}