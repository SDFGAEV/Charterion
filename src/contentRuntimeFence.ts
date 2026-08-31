import type { ContentObservationIdentity } from './contracts';

type RuntimeCursor = {
  contentEpoch: string;
  revision: number;
  retiredEpochs: Set<string>;
};

export class ContentRuntimeFence {
  private readonly cursors = new Map<number, RuntimeCursor>();

  observe(tabId: number, observation: ContentObservationIdentity, allowEqual = false): boolean {
    if (!Number.isInteger(tabId) || tabId <= 0) return false;
    if (!observation.contentEpoch || !Number.isInteger(observation.revision) || observation.revision < 1) return false;
    if (!observation.semanticSignature || !Number.isInteger(observation.observedAt) || observation.observedAt <= 0) return false;

    const current = this.cursors.get(tabId);
    if (!current) {
      this.cursors.set(tabId, {
        contentEpoch: observation.contentEpoch,
        revision: observation.revision,
        retiredEpochs: new Set(),
      });
      return true;
    }

    if (current.contentEpoch === observation.contentEpoch) {
      if (observation.revision < current.revision) return false;
      if (!allowEqual && observation.revision === current.revision) return false;
      current.revision = Math.max(current.revision, observation.revision);
      return true;
    }

    if (current.retiredEpochs.has(observation.contentEpoch)) return false;
    current.retiredEpochs.add(current.contentEpoch);
    current.contentEpoch = observation.contentEpoch;
    current.revision = observation.revision;
    return true;
  }

  remove(tabId: number): void {
    this.cursors.delete(tabId);
  }

  currentEpoch(tabId: number): string | undefined {
    return this.cursors.get(tabId)?.contentEpoch;
  }
}
