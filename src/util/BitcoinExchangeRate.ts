import { FiatCurrency } from "../enum";
import { TimeUtil } from "./TimeUtil";
type DatedRate = {
    date: Date,
    rate: number
}

export class BitcoinExchangeRate {
    private static instance: BitcoinExchangeRate;
    private bitcoinExchangeRates: Map<FiatCurrency, DatedRate> = new Map<FiatCurrency, DatedRate>();
    private activeFiatCurrency: FiatCurrency;
    private latestUpdates: Map<FiatCurrency, Date> = new Map<FiatCurrency, Date>();
    private updateInterval: number; // in minutes

    private constructor(defaultFiatCurrency: FiatCurrency, updateInterval: number) {
        this.activeFiatCurrency = defaultFiatCurrency;
        this.updateInterval = TimeUtil.toMilliSeconds(updateInterval);
    }

    public static getInstance(defaultFiatCurrency: FiatCurrency = FiatCurrency.USD, updateInterval: number = 5): BitcoinExchangeRate {
        if (!BitcoinExchangeRate.instance) {
            BitcoinExchangeRate.instance = new BitcoinExchangeRate(defaultFiatCurrency, updateInterval);
        }
        return BitcoinExchangeRate.instance;
    }


    public async getExchangeRate(forcedUpdate?: boolean): Promise<number | undefined> {
        const datedRate: DatedRate | undefined = this.bitcoinExchangeRates.get(this.activeFiatCurrency);
        const latestUpdate: Date | undefined = this.latestUpdates.get(this.activeFiatCurrency);
        if (forcedUpdate || this.shouldUpdateExchangeRate(datedRate, latestUpdate)) {
            await this.updateExchangeRate();
        }
        return this.bitcoinExchangeRates.get(this.activeFiatCurrency)?.rate;
    }

    public setActiveFiatCurrency(currency: FiatCurrency): void {
        this.activeFiatCurrency = currency;
    }

    public getActiveFiatCurrency(): FiatCurrency {
        return this.activeFiatCurrency;
    }

    public getLatestUpdate(): Date | undefined {
        return this.latestUpdates.get(this.activeFiatCurrency);
    }

    public getUpdateInterval(): number {
        return TimeUtil.toMinutes(this.updateInterval);
    }

    public setUpdateInterval(interval: number): void {
        if (!this.isValidInterval(interval)) {
            throw new Error("Invalid update interval provided.");
        }
        this.updateInterval = TimeUtil.toMilliSeconds(interval);
    }


    private async updateExchangeRate(): Promise<void> {
        const now: Date = new Date();
        let exchangeRate: number
        try {
            exchangeRate = await this.fetchBitcoinExchangeRate(this.activeFiatCurrency);
        } catch (error) {
            console.warn(`Failed to fetch BTC price: ${error}`);
            return;
        }
        const datedRate: DatedRate = { date: now, rate: exchangeRate };
        this.bitcoinExchangeRates.set(this.activeFiatCurrency, datedRate);
        this.latestUpdates.set(this.activeFiatCurrency, now);
    }


    private shouldUpdateExchangeRate(datedRate?: DatedRate, latestUpdate?: Date): boolean {
        return !datedRate || !latestUpdate || datedRate.date.getTime() - latestUpdate.getTime() > this.updateInterval;
    }

    private isValidInterval(interval: number): boolean {
        return interval >= 5 && interval <= 60;
    }

    private async fetchBitcoinExchangeRate(currency: FiatCurrency): Promise<number> {

        if (typeof currency !== "string" || currency.trim() === "") {
            throw new Error("Invalid currency provided.")
        }
        try {
            const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${currency.toLowerCase()}`);

            if (!response.ok) {
                throw new Error(`Failed to BTC price data: ${response.status}`);
            }

            const data = await response.json();

            if (!data.bitcoin || !data.bitcoin[currency.toLowerCase()]) {
                throw new Error("Invalid or unsupported currency.");
            }

            const rate: number = data.bitcoin[currency.toLowerCase()];

            return rate;

        } catch (error) {
            throw new Error(`An error occurred while fetching BTC price: ${error}`);
        }
    }


}