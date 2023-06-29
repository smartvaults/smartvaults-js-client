import {
  type Filter,
  type Kind
} from 'nostr-tools'

import {
  TagType
} from '../enum/'

import {
  PaginationOpts
} from './types'

export class FilterBuilder {
  private filter: Filter

  constructor() {
    this.filter = {}
  }

  authors(authors: string | string[]): FilterBuilder {
    return this.addToArrayProperty('authors', authors)
  }

  ids(ids: string | string[]): FilterBuilder {
    return this.addToArrayProperty('ids', ids)
  }

  pubkeys(pubkeys: string | string[]): FilterBuilder {
    return this.addToArrayProperty(`#${TagType.PubKey}`, pubkeys)
  }

  events(events: string | string[]): FilterBuilder {
    return this.addToArrayProperty(`#${TagType.Event}`, events)
  }

  kinds<K extends number = Kind>(kinds: K | K[]): FilterBuilder {
    return this.addToArrayProperty('kinds', kinds)
  }

  since(since: number): FilterBuilder {
    this.filter.since = since
    return this
  }

  limit(limit: number): FilterBuilder {
    this.filter.limit = limit
    return this
  }

  search(search: string): FilterBuilder {
    this.filter.search = search
    return this
  }

  pagination(opts: PaginationOpts): FilterBuilder {
    this.filter = { ...this.filter, ...opts }
    return this
  }

  toFilter(): Filter {
    return this.filter
  }

  toFilters(filters?: Filter | Filter[]): Filter[] {
    filters = filters || []
    filters = Array.isArray(filters) ? filters : []
    filters.push(this.filter)
    return filters
  }

  private addToArrayProperty(property: string, values: any | any[]): FilterBuilder {
    values = Array.isArray(values) ? values : [values]
    if (!this.filter[property]) {
      this.filter[property] = []
    }
    this.filter[property] = this.filter[property].concat(values)
    return this
  }

}

export function filterBuilder(): FilterBuilder {
  return new FilterBuilder()
}