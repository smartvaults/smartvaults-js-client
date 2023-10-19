import { fetchBitcoinExchangeRate } from './BitcoinRate';
import { FiatCurrency } from '../enum';

describe('GetBitcoinPrice', () => {

    describe('converToFiat', () => {

        beforeAll(() => {
            global.fetch = jest.fn().mockReturnValue(Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ bitcoin: { usd: 28300 } }),
            }));
        });

        it('it should return exchange rate', async () => {
            let amount = await fetchBitcoinExchangeRate(FiatCurrency.USD)
            expect(amount).toBe(28300)
        })

    })
})
