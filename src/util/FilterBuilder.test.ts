import { filterBuilder } from './FilterBuilder'

jest.setTimeout(100000);

describe('FilterBuilder', () => {

  describe('pagination', () => {

    it('it does not affect other existing properties', async () => {
      const builder = filterBuilder()
        .ids('id1')
        .events('event1')
        .pagination({})
      let expectedFilter: any = {
        ids: ['id1'],
        '#e': ['event1']
      }
      expect(builder.toFilter()).toEqual(expectedFilter)
      builder.pagination({
        since: 1,
        until: 2,
        limit: 3
      })
      expectedFilter = {
        ...expectedFilter,
        since: 1,
        until: 2,
        limit: 3
      }
      expect(builder.toFilter()).toEqual(expectedFilter)
    })

    it('it overrides pagination options', async () => {
      const builder = filterBuilder()
        .ids('id1')
        .since(2)
        .limit(5)
        .pagination({
          since: 1,
          until: 2,
          limit: 3
        })
      let expectedFilter: any = {
        ids: ['id1'],
        since: 1,
        until: 2,
        limit: 3
      }
      expect(builder.toFilter()).toEqual(expectedFilter)
    })
  })
})
