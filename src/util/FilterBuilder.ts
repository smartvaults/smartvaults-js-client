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

import {
  nostrDate
} from './NostrUtil'

export class FilterBuilder<K extends number> {
  private filter: Filter<K>

  constructor() {
    this.filter = {}
  }

  authors(authors: string | string[]): FilterBuilder<K> {
    return this.addToArrayProperty('authors', authors)
  }

  ids(ids: string | string[]): FilterBuilder<K> {
    return this.addToArrayProperty('ids', ids)
  }

  pubkeys(pubkeys: string | string[]): FilterBuilder<K> {
    return this.addToArrayProperty(`#${TagType.PubKey}`, pubkeys)
  }

  events(events: string | string[]): FilterBuilder<K> {
    return this.addToArrayProperty(`#${TagType.Event}`, events)
  }

  kinds(kinds: K | K[]): FilterBuilder<K> {
    return this.addToArrayProperty('kinds', kinds)
  }

  since(since: number | Date): FilterBuilder<K> {
    this.filter.since = nostrDate(since)
    return this
  }

  until(until: number | Date): FilterBuilder<K> {
    this.filter.until = nostrDate(until)
    return this
  }

  limit(limit: number): FilterBuilder<K> {
    this.filter.limit = limit
    return this
  }

  search(search: string): FilterBuilder<K> {
    this.filter.search = search
    return this
  }

  pagination(opts: PaginationOpts): FilterBuilder<K> {
    opts.limit && this.limit(opts.limit)
    opts.since && this.since(opts.since)
    opts.until && this.until(opts.until)
    return this
  }

  toFilter(): Filter<K> {
    return this.filter
  }

  toFilters(filters?: Filter<K> | Filter<K>[]): Filter<K>[] {
    filters = filters || []
    filters = Array.isArray(filters) ? filters : []
    filters.push(this.filter)
    return filters
  }

  private addToArrayProperty(property: string, values: any | any[]): FilterBuilder<K> {
    values = Array.isArray(values) ? values : [values]
    if (!this.filter[property]) {
      this.filter[property] = []
    }
    this.filter[property] = this.filter[property].concat(values)
    return this
  }

}

export function filterBuilder<K extends number>(): FilterBuilder<K> {
  return new FilterBuilder<K>()
}