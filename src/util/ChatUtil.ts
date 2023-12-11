
class ListNode<T> {
  value: T;
  next: ListNode<T> | null;
  prev: ListNode<T> | null;

  constructor(value: T) {
    this.value = value;
    this.next = null;
    this.prev = null;
  }
}

export class DoublyLinkedList<T extends { createdAt: Date, id: string }> {
  head: ListNode<T> | null;
  tail: ListNode<T> | null;
  private idSet: Set<string>;

  constructor(messages?: T[] | T) {
    this.head = null;
    this.tail = null;
    this.idSet = new Set([]);
    if (messages) {
      this.insertSorted(messages);
    }
  }

  insertSorted(value: T | T[]): void {
    if (Array.isArray(value)) {
      value.forEach(msg =>
        this.insertSingleSorted(msg)
      )
    } else {
      this.insertSingleSorted(value);
    }
  }

  private insertSingleSorted(value: T): void {

    if (this.idSet.has(value.id)) {
      return;
    }

    const newNode = new ListNode(value);
    this.idSet.add(value.id);
    if (!this.head || value.createdAt >= this.head.value.createdAt) {
      newNode.next = this.head;
      if (this.head) {
        this.head.prev = newNode;
      }
      this.head = newNode;
      if (!this.tail) {
        this.tail = newNode;
      }
      return;
    }

    let current = this.head;
    while (current.next && current.next.value.createdAt > value.createdAt) {
      current = current.next;
    }

    newNode.next = current.next;
    newNode.prev = current;

    if (current.next) {
      current.next.prev = newNode;
    } else {
      this.tail = newNode;
    }

    current.next = newNode;
  }

  remove(id: string): void {
    if (!this.head) {
      return;
    }

    if (this.head.value.id === id) {
      this.head = this.head.next;
      if (this.head) {
        this.head.prev = null;
      } else {
        this.tail = null;
      }
      this.idSet.delete(id);
      return;
    }

    let current = this.head;
    while (current.next && current.next.value.id !== id) {
      current = current.next;
    }

    if (current.next) {
      current.next = current.next.next;
      if (current.next) {
        current.next.prev = current;
      } else {
        this.tail = current;
      }
      this.idSet.delete(id);
    }
  }


  find(id: string): T | null {
    let current = this.head;
    while (current) {
      if (current.value.id === id) {
        return current.value;
      }
      current = current.next;
    }
    return null;
  }

  toArray(): T[] {
    const array: T[] = [];
    let current = this.head;
    while (current) {
      array.push(current.value);
      current = current.next;
    }
    return array;
  }

  has(id: string): boolean {
    return this.idSet.has(id);
  }

}