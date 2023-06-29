import { nostrDate } from './NostrUtil'

describe('NostrUtil', () => {

  describe('nostrDate', () => {

    it('it should return current date when parameter is undefined', async () => {
      let lowerBoundry = nostrDate()

      expect(nostrDate(undefined)).toBeGreaterThanOrEqual(lowerBoundry)
    })
  })
})
