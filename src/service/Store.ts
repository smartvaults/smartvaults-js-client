export class Store {
  private indexKeys: string[]
  private indexes: Map<string, Map<string, any>>;
  constructor(indexKeys: string | string[]) {
    this.indexKeys = Array.isArray(indexKeys) ? indexKeys : [indexKeys]
    if (!this.indexKeys.length) {
      throw new Error('At least one key must be specified')
    }
    this.indexes = new Map()
    this.indexKeys.forEach(key => this.indexes.set(key, new Map()))
  }

  store(objs: any | any[]) {
    objs = Array.isArray(objs) ? objs : [objs]
    objs.forEach(obj => {
      this.indexKeys.forEach(key => {
        if (!obj[key]) {
          throw new Error("Index property has no value")
        }
        this.indexes.get(key)!.set(obj[key], obj)
      })
    })
  }

  get(indexValue: string, indexKey?: string): any | undefined {
    return this.getIndex(indexKey).get(indexValue)
  }

  getMany(indexValues: string[], indexKey?: string): Map<string, any> {
    const index = this.getIndex(indexKey)
    const map: Map<string, any> = new Map()
    indexValues.forEach(indexValue => {
      if (index.has(indexValue)) {
        map.set(indexValue, index.get(indexValue))
      }
    })
    return map
  }

  has(indexValue: string, indexKey?: string): boolean {
    return !!this.get(indexValue, indexKey)
  }

  missing(indexValues: string[], indexKey?: string): string[] {
    const index = this.getIndex(indexKey)
    return indexValues.filter(v => !index.has(v))
  }

  private getIndex(indexKey?: string): Map<string, any> {
    indexKey = indexKey || this.indexKeys[0]
    if (!this.indexes.has(indexKey)) {
      throw new Error("Invalid index key")
    }
    return this.indexes.get(indexKey)!
  }
}