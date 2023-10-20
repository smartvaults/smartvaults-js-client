import { BitcoinExchangeRate } from './BitcoinExchangeRate';
import { FiatCurrency } from '../enum';

describe('BitcoinExchangeRate', () => {
    const bitcoinExchangeRate = BitcoinExchangeRate.getInstance();

    describe('getExchangeRate', () => {

        beforeAll(() => {
            global.fetch = jest.fn().mockReturnValue(Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ bitcoin: { usd: 28300 } }),
            }));
        });

        it('it should return exchange rate', async () => {
            const exchangeRate = await bitcoinExchangeRate.getExchangeRate();
            expect(exchangeRate).toBe(28300)
        })

    })

    describe('getActiveFiatCurrency', () => {
        it('it should return active fiat currency', () => {
            expect(bitcoinExchangeRate.getActiveFiatCurrency()).toBe(FiatCurrency.USD);
        })
    })

    describe('setActiveFiatCurrency', () => {
        it('it should set active fiat currency', () => {
            bitcoinExchangeRate.setActiveFiatCurrency(FiatCurrency.Euro);
            expect(bitcoinExchangeRate.getActiveFiatCurrency()).toBe(FiatCurrency.Euro);
        })
    })

    describe('setUpdateInterval', () => {
        it('it should set update interval', () => {
            bitcoinExchangeRate.setUpdateInterval(10);
            expect(bitcoinExchangeRate.getUpdateInterval()).toBe(10);
        })
    })

    describe('its singleton', () => {
        it('it should be singleton', () => {
            const bitcoinExchangeRate2 = BitcoinExchangeRate.getInstance(FiatCurrency.Euro, 20);
            expect(bitcoinExchangeRate).toBe(bitcoinExchangeRate2);
        })
    })
})

