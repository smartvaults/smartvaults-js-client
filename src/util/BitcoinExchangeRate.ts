import { FiatCurrency } from "../enum";
import { CurrencyUtil } from "./CurrencyUtil";
import { TimeUtil } from "./TimeUtil";
import { BitcoinUnit, DatedRate } from "./types";
import { Price } from "../types";

type CurrenciesValues = {
    [key in FiatCurrency]: number
}

type MarketData = {
    current_price: CurrenciesValues
    market_cap: CurrenciesValues
    total_volume: CurrenciesValues
}

type ExchangeRatesData = {
    id: string
    symbol: string
    name: string
    localization: any
    image: any
    market_data: MarketData
    community_data: any
    developer_data: any
    public_interest_stats: any
}

export class BitcoinExchangeRate {
    private static instance: BitcoinExchangeRate;
    private bitcoinExchangeRates: Map<FiatCurrency, DatedRate> = new Map<FiatCurrency, DatedRate>();
    private datedBitcoinExchangeRates: Map<FiatCurrency, Map<string, number>> = new Map<FiatCurrency, Map<string, number>>();
    private activeFiatCurrency: FiatCurrency;
    private updateInterval: number; // in minutes
    private latestFetch: Date | undefined;
    private maxFetchInterval: number = 12000; // Coingecko's public api limit is 5 requests per minute

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

        if (forcedUpdate || this.shouldUpdateExchangeRate(datedRate)) {
            try {
                await this.updateExchangeRate();
            } catch (error) {
                console.warn(`Failed to update BTC exchange rate: ${error}`); datedRate
            }
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
        return this.bitcoinExchangeRates.get(this.activeFiatCurrency)?.date;
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

    public async fromPriceToSats(price: Price): Promise<number> {
        const currency = price.currency.toLowerCase() as FiatCurrency;
        let exchangeRate: number
        if (this.bitcoinExchangeRates.has(currency)) {
            exchangeRate = this.bitcoinExchangeRates.get(currency)!.rate;
        } else {
            exchangeRate = await this.fetchBitcoinExchangeRate(currency);
        }
        
       const amount = Math.ceil( CurrencyUtil.fromBitcoinToSats(price.amount / exchangeRate)); 
       return amount;
    }

    private async updateExchangeRate(): Promise<void> {
        const now: Date = new Date();
        let exchangeRate: number
        try {
            exchangeRate = await this.fetchBitcoinExchangeRate(this.activeFiatCurrency);
        } catch (error) {
            throw new Error(`Failed to fetch BTC price: ${error}`);
        }
        const datedRate: DatedRate = { date: now, rate: exchangeRate };

        this.bitcoinExchangeRates.set(this.activeFiatCurrency, datedRate);
        const datedRates: Map<string, number> | undefined = this.datedBitcoinExchangeRates.get(this.activeFiatCurrency);
        const dateString = TimeUtil.toDashedDayFirstDateString(now);

        if (datedRates) {
            datedRates.set(dateString, exchangeRate);
        } else {
            this.datedBitcoinExchangeRates.set(this.activeFiatCurrency, new Map<string, number>([[dateString, exchangeRate]]));
        }
    }

    private shouldUpdateExchangeRate(datedRate?: DatedRate): boolean {
        const now = new Date();
        return !datedRate || datedRate.date.getTime() + this.updateInterval < now.getTime();
    }

    private isValidInterval(interval: number): boolean {
        return interval >= 5 && interval <= 60;
    }

    private async fetchBitcoinExchangeRate(currency: FiatCurrency): Promise<number> {

        const now: Date = new Date();

        if (this.latestFetch && this.latestFetch.getTime() + this.maxFetchInterval > now.getTime()) {
            const sleepTime = this.latestFetch.getTime() + this.maxFetchInterval - now.getTime();
            await new Promise(resolve => setTimeout(resolve, sleepTime));
        }

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
            this.latestFetch = now

            const dateString = TimeUtil.toDashedDayFirstDateString(now);
            const datedRates: Map<string, number> | undefined = this.datedBitcoinExchangeRates.get(currency);
            if (datedRates) {
                datedRates.set(dateString, rate);
            } else {
                this.datedBitcoinExchangeRates.set(currency, new Map<string, number>([[dateString, rate]]));
            }

            return rate;

        } catch (error) {
            throw new Error(`An error occurred while fetching BTC price: ${error}`);
        }
    }

    public async getDatedBitcoinExchangeRate(date: Date, currency?: FiatCurrency): Promise<DatedRate> {

        if (!currency) {
            currency = this.activeFiatCurrency;
        }

        const datedRates = this.datedBitcoinExchangeRates.get(currency);
        const dateString: string = TimeUtil.toDashedDayFirstDateString(date);

        if (datedRates && datedRates.has(dateString)) {
            const rate: number = datedRates.get(dateString) as number;
            return { date, rate };
        }

        const now: Date = new Date();

        if (this.latestFetch && this.latestFetch.getTime() + this.maxFetchInterval > now.getTime()) {
            const sleepTime = this.latestFetch.getTime() + this.maxFetchInterval - now.getTime();
            await new Promise(resolve => setTimeout(resolve, sleepTime));
        }

        try {
            const response = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${dateString}`);

            if (!response.ok) {
                throw new Error(`Failed to BTC price data: ${response.status}`);
            }

            const data: ExchangeRatesData = await response.json();
            const marketData: MarketData = data.market_data;

            if (!marketData || !marketData.current_price[currency.toLowerCase()]) {
                throw new Error("Invalid or unsupported currency.");
            }

            const rate: number = marketData.current_price[currency.toLowerCase()];
            const datedRate: DatedRate = { date, rate };

            if (datedRates) {
                datedRates.set(dateString, rate);
            } else {
                this.datedBitcoinExchangeRates.set(currency, new Map<string, number>([[dateString, rate]]));
            }
            this.latestFetch = now
            return datedRate;

        } catch (error) {
            throw new Error(`An error occurred while fetching BTC price: ${error}`);
        }
    }

    public async convertToFiat(amounts: number[], rate?: number, unit: BitcoinUnit = 'SAT'): Promise<number[]> {
        const exchangeRate = rate || await this.getExchangeRate();
        if (!exchangeRate) throw new Error("Exchange rate not available");

        const fiatAmounts: number[] = [];

        for (const amount of amounts) {
            if (!amount) {
                fiatAmounts.push(0);
                continue;
            }
            let bitcoin: number;
            if (unit === 'SAT') {
                bitcoin = CurrencyUtil.fromSatsToBitcoin(amount);
            } else if (unit === 'BTC') {
                bitcoin = amount;
            } else {
                throw new Error(`Unit ${unit} not supported`);
            }

            const fiat = bitcoin * exchangeRate;
            fiatAmounts.push(CurrencyUtil.toRoundedFloat(fiat));
        }

        return fiatAmounts;
    }


}