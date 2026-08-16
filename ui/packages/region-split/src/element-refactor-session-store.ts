import { randomUUID } from "node:crypto";
import type { RefactorCandidate, ElementSubtree } from "./element-refactor-types.js";
import type { ElementRefactorMessage } from "./element-refactor-model.js";
import type { Rect } from "./types.js";

export interface RefactorSession {
  id: string;
  projectId: string;
  region: Rect;
  rootId: string;
  treeVersion: string;
  candidateVersion: number;
  original: ElementSubtree;
  candidate: RefactorCandidate;
  history: ElementRefactorMessage[];
  expiresAt: number;
}

export class RefactorSessionNotFoundError extends Error {
  constructor(id: string) {
    super(`refactor session ${id} not found`);
    this.name = "RefactorSessionNotFoundError";
  }
}

function clone(session: RefactorSession): RefactorSession {
  return structuredClone(session);
}

export class RefactorSessionStore {
  readonly #sessions = new Map<string, RefactorSession>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.#now = options.now ?? Date.now;
  }

  create(input: Omit<RefactorSession, "id" | "expiresAt">): RefactorSession {
    const session: RefactorSession = {
      ...structuredClone(input), id: randomUUID(), expiresAt: this.#now() + this.#ttlMs,
    };
    this.#sessions.set(session.id, session);
    return clone(session);
  }

  get(id: string): RefactorSession | null {
    const session = this.#sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= this.#now()) {
      this.#sessions.delete(id);
      return null;
    }
    session.expiresAt = this.#now() + this.#ttlMs;
    return clone(session);
  }

  update(id: string, updater: (current: RefactorSession) => RefactorSession): RefactorSession {
    const current = this.get(id);
    if (!current) throw new RefactorSessionNotFoundError(id);
    const next = clone(updater(current));
    if (next.id !== id) throw new Error("refactor session id cannot change");
    next.expiresAt = this.#now() + this.#ttlMs;
    this.#sessions.set(id, next);
    return clone(next);
  }

  delete(id: string): void {
    this.#sessions.delete(id);
  }

  pruneExpired(): number {
    const now = this.#now();
    let count = 0;
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(id);
        count++;
      }
    }
    return count;
  }
}
