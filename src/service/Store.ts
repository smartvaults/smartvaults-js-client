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
    if(!objs.length){
      return;
    }
    objs.forEach(obj => {
      this.indexKeys.forEach(key => {
        if (!obj[key]) {
          throw new Error("Index property has no value")
        }
        const indexForKey = this.indexes.get(key);
        if(!indexForKey){
          throw new Error("Invalid index key")
        }
        const currentInnerMap = indexForKey.get(obj[key]) || new Map<string, any>();
        // Unique identifier from the object's indexKeys values e.g "proposalId-approvalId"
        const id = this.indexKeys.map(indexKey => obj[indexKey]).join("-");
        if (currentInnerMap.get(id)) {
          return;
        }
        currentInnerMap.set(id, obj);
        indexForKey.set(obj[key], currentInnerMap);
      })
    })
}

get(indexValue: string, indexKey?: string): any | undefined {
  const InnerMap = this.getIndex(indexKey).get(indexValue)
  if (InnerMap) {
    return InnerMap.size === 1 ? InnerMap.values().next().value  : Array.from(InnerMap.values());
  }
}

getMany(indexValues?: string[], indexKey?: string): Map<string, any | any[]> {
  const index = this.getIndex(indexKey);
  if(!index){
    throw new Error("Invalid index key")
  }
  const map: Map<string, any | any[]> = new Map();
  if (!indexValues?.length) {
    index.forEach((InnerMap, key) => {
      map.set(key, InnerMap.size === 1 ? InnerMap.values().next().value : Array.from(InnerMap.values()));
    });
    return map;
  }
  indexValues.forEach(indexValue => {
    const InnerMap = index.get(indexValue)
    if (InnerMap) {
      map.set(indexValue, InnerMap.size === 1 ? InnerMap.values().next().value : Array.from(InnerMap.values()));
    }
  });
  return map;
}

getManyAsArray(indexValues?: string[], indexKey?: string): any[] {
  const index = this.getIndex(indexKey);
  if(!index){
    throw new Error("Invalid index key")
  }
  const array: any[] = [];
  if (!indexValues?.length) {
    index.forEach(InnerMap => {
      array.push(InnerMap.size === 1 ? InnerMap.values().next().value : Array.from(InnerMap.values()));
    });
    return array;
  }
  indexValues.forEach(indexValue => {
    const InnerMap = index.get(indexValue)
    if (InnerMap) {
      array.push(InnerMap.size === 1 ? InnerMap.values().next().value  : Array.from(InnerMap.values()));
    }
  });
  return array;
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