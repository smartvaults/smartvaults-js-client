export class Store {
  private readonly indexes: Map<string, Map<string, any>>

  constructor(private readonly indexMap: Record<string, string[]>) {
    this.indexes = new Map()
    for (const indexName in indexMap) {
      this.indexes.set(indexName, new Map())
    }
  }

  store(objs: any | any[]): void {
    objs = Array.isArray(objs) ? objs : [objs]
    if (!objs.length) {
      return
    }
    objs.forEach(obj => {
      for (const indexName in this.indexMap) {
        const keyValues = this.indexMap[indexName].map(indexKey => obj[indexKey])
        const key = keyValues.join('-')
        const map = this.indexes.get(indexName)
        if (!map) throw new Error('Invalid index key')

        let innerMap = map.get(obj[indexName])
        if (!innerMap) {
          innerMap = new Map()
          map.set(obj[indexName], innerMap)
        }
        if (!innerMap.get(key)) {
          innerMap.set(key, obj)
        }
      }
    })
  }

  delete(objs: any | any[]): void {
    objs = Array.isArray(objs) ? objs : [objs]
    if (!objs.length) {
      return
    }
    objs.forEach(obj => {
      for (const indexName in this.indexMap) {
        const keyValues = this.indexMap[indexName].map(indexKey => obj[indexKey])
        const key = keyValues.join('-')
        const map = this.indexes.get(indexName)
        if (!map) throw new Error('Invalid index key')

        let innerMap = map.get(obj[indexName])
        if (!innerMap) {
          continue
        }
        if (innerMap.get(key)) {
          innerMap.delete(key)
        }

        if (innerMap.size === 0) {
          map.delete(obj[indexName]);
        }
      }
    })
  }


  get(indexValue: string, indexKey?: string): any | undefined {
    const InnerMap = this.getIndex(indexKey).get(indexValue)
    if (InnerMap) {
      return InnerMap.size === 1 ? InnerMap.values().next().value : Array.from(InnerMap.values())
    }
  }

  getMany(indexValues?: string[], indexKey?: string): Map<string, any | any[]> {
    const index = this.getIndex(indexKey)
    if (!index) {
      throw new Error('Invalid index key')
    }
    const map = new Map<string, any | any[]>()
    if (!indexValues?.length) {
      index.forEach((InnerMap, key) => {
        map.set(key, InnerMap.size === 1 ? InnerMap.values().next().value : Array.from(InnerMap.values()))
      })
      return map
    }
    indexValues.forEach(indexValue => {
      const InnerMap = index.get(indexValue)
      if (InnerMap) {
        map.set(indexValue, InnerMap.size === 1 ? InnerMap.values().next().value : Array.from(InnerMap.values()))
      }
    })
    return map
  }

  getManyAsArray(indexValues?: string[], indexKey?: string): any[] {
    const index = this.getIndex(indexKey)
    if (!index) {
      throw new Error('Invalid index key')
    }
    const array: any[] = []
    if (!indexValues?.length) {
      index.forEach(InnerMap => {
        array.push(...(InnerMap.size === 1 ? [InnerMap.values().next().value] : Array.from(InnerMap.values())))
      })
      return array
    }
    indexValues.forEach(indexValue => {
      const InnerMap = index.get(indexValue)
      if (InnerMap) {
        array.push(...(InnerMap.size === 1 ? [InnerMap.values().next().value] : Array.from(InnerMap.values())))
      }
    })
    return array
  }

  has(indexValue: string, indexKey?: string): boolean {
    return !!this.get(indexValue, indexKey)
  }

  missing(indexValues: string[], indexKey?: string): string[] {
    const index = this.getIndex(indexKey)
    return indexValues.filter(v => !index.has(v))
  }

  private getIndex(indexKey?: string): Map<string, any> {
    indexKey = indexKey ?? this.indexes.keys().next().value
    if (!indexKey) {
      throw new Error('Invalid index key')
    }
    if (!this.indexes.has(indexKey)) {
      throw new Error('Invalid index key')
    }
    return this.indexes.get(indexKey)!
  }

  static createSingleIndexStore(indexKey: string): Store {
    return new Store({ [indexKey]: [indexKey] })
  }
}
