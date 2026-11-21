export class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];

    while (this.parent[index] !== root) {
      const next = this.parent[index];
      this.parent[index] = root;
      index = next;
    }
    return root;
  }

  union(left: number, right: number): void {
    this.parent[this.find(left)] = this.find(right);
  }

  /** Returns connected index groups in first-member order. */
  groups(): number[][] {
    const groupsByRoot = new Map<number, number[]>();
    for (let index = 0; index < this.parent.length; index++) {
      const root = this.find(index);
      let group = groupsByRoot.get(root);
      if (!group) {
        group = [];
        groupsByRoot.set(root, group);
      }
      group.push(index);
    }
    return [...groupsByRoot.values()];
  }
}
