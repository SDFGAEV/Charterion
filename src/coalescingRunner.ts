export class CoalescingRunner {
  private running: Promise<void> | undefined;
  private pending = false;

  constructor(
    private readonly runOnce: () => Promise<void>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  kick(): void {
    this.pending = true;
    if (this.running) return;
    this.running = this.drain()
      .catch((error) => this.onError(error))
      .finally(() => {
        this.running = undefined;
        if (this.pending) this.kick();
      });
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      this.pending = false;
      await this.runOnce();
    }
  }
}
