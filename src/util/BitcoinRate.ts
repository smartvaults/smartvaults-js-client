import { FiatCurrency } from "../enum";

export async function fetchBitcoinExchangeRate(currency: FiatCurrency): Promise<number> {

    if (typeof currency !== "string" || currency.trim() === "") {
        throw new Error("Invalid currency provided.");
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

