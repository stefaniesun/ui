export class ProjectWriteCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  get pendingProjectCount(): number { return this.tails.size; }

  async run<T>(projectId: string, work: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(projectId, tail);
    await previous;
    try { return await work(); }
    finally {
      release();
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId);
    }
  }
}
