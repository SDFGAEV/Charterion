export type CapabilityEffectClass = 'read-only' | 'reversible' | 'irreversible' | 'uncertain';
export type OperationOutcome = 'accepted' | 'completed' | 'failed' | 'uncertain';

export interface SchemaRef {
  name: string;
  version: number;
}

export interface CapabilityDescriptor {
  capabilityId: string;
  providerId: string;
  operations: readonly string[];
  inputSchema: SchemaRef;
  outputSchema: SchemaRef;
  effectClass: CapabilityEffectClass;
  authorityRequirements: readonly string[];
  recoverability: 'idempotent' | 'replay-safe' | 'compensatable' | 'non-replayable';
  observability: 'receipt' | 'receipt-and-evidence';
}

export interface OperationRequest<TPayload = unknown> {
  requestId: string;
  capabilityId: string;
  operationId: string;
  actorId: string;
  missionId?: string;
  taskId?: string;
  resourceRefs: readonly string[];
  idempotencyKey: string;
  effectClass: CapabilityEffectClass;
  authoritySnapshot: readonly string[];
  payload: TPayload;
  requestedAt: number;
}

export interface OperationReceipt<TOutput = unknown> {
  requestId: string;
  capabilityId: string;
  operationId: string;
  outcome: OperationOutcome;
  retryable: boolean;
  output?: TOutput;
  error?: string;
  evidenceRefs: readonly string[];
  artifactRefs: readonly string[];
  observedAt: number;
}

export interface CapabilityProvider {
  readonly descriptor: CapabilityDescriptor;
  invoke<TPayload, TOutput>(request: OperationRequest<TPayload>): Promise<OperationReceipt<TOutput>>;
}

export function validateCapabilityDescriptor(descriptor: CapabilityDescriptor): void {
  if (!descriptor.capabilityId.trim() || !descriptor.providerId.trim()) throw new Error('Capability identity is required');
  if (descriptor.operations.length === 0 || descriptor.operations.some((operation) => !operation.trim())) throw new Error('Capability operations must be non-empty');
  if (!descriptor.inputSchema.name.trim() || !descriptor.outputSchema.name.trim()) throw new Error('Capability schemas are required');
  if (!Number.isInteger(descriptor.inputSchema.version) || descriptor.inputSchema.version < 1) throw new Error('Input schema version must be positive');
  if (!Number.isInteger(descriptor.outputSchema.version) || descriptor.outputSchema.version < 1) throw new Error('Output schema version must be positive');
}

export function validateOperationRequest(request: OperationRequest): void {
  if (!request.requestId.trim() || !request.capabilityId.trim() || !request.operationId.trim() || !request.actorId.trim()) throw new Error('Operation identity is required');
  if (!request.idempotencyKey.trim()) throw new Error('Operation idempotency key is required');
  if (!Number.isFinite(request.requestedAt)) throw new Error('Operation requestedAt must be finite');
}
export class CapabilityRegistry {
  private readonly providers = new Map<string, CapabilityProvider>();

  register(provider: CapabilityProvider): void {
    validateCapabilityDescriptor(provider.descriptor);
    const { capabilityId } = provider.descriptor;
    if (this.providers.has(capabilityId)) throw new Error(`Capability already registered: ${capabilityId}`);
    this.providers.set(capabilityId, provider);
  }

  get(capabilityId: string): CapabilityProvider | undefined {
    return this.providers.get(capabilityId);
  }

  list(): readonly CapabilityDescriptor[] {
    return [...this.providers.values()].map((provider) => provider.descriptor);
  }
}

export function assertOperationAllowed(
  descriptor: CapabilityDescriptor,
  request: OperationRequest,
): void {
  validateOperationRequest(request);
  if (request.capabilityId !== descriptor.capabilityId) throw new Error('Operation capability does not match descriptor');
  if (!descriptor.operations.includes(request.operationId)) throw new Error('Operation is not declared by capability');
  if (request.effectClass !== descriptor.effectClass) throw new Error('Operation effect class does not match capability');
  for (const required of descriptor.authorityRequirements) {
    if (!request.authoritySnapshot.includes(required)) throw new Error(`Missing authority requirement: ${required}`);
  }
}
export async function invokeCapability<TPayload, TOutput>(
  provider: CapabilityProvider,
  request: OperationRequest<TPayload>,
): Promise<OperationReceipt<TOutput>> {
  assertOperationAllowed(provider.descriptor, request);
  const receipt = await provider.invoke<TPayload, TOutput>(request);
  if (receipt.requestId !== request.requestId) throw new Error('Capability receipt requestId mismatch');
  if (receipt.capabilityId !== request.capabilityId || receipt.operationId !== request.operationId) {
    throw new Error('Capability receipt identity mismatch');
  }
  if (!Number.isFinite(receipt.observedAt)) throw new Error('Capability receipt observedAt must be finite');
  if (receipt.outcome === 'failed' && !receipt.error?.trim()) throw new Error('Failed capability receipt requires an error');
  if (receipt.outcome === 'completed' && receipt.error) throw new Error('Completed capability receipt cannot contain an error');
  return receipt;
}

export interface ReceiptSink {
  persist(receipt: OperationReceipt): Promise<void>;
}

export interface CapabilityRuntimeMetrics {
  dispatched: number;
  persistenceQueued: number;
  persistenceFailures: number;
}

export class CapabilityRuntime {
  private readonly metricsState: CapabilityRuntimeMetrics = { dispatched: 0, persistenceQueued: 0, persistenceFailures: 0 };

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly receiptSink?: ReceiptSink,
  ) {}

  metrics(): CapabilityRuntimeMetrics {
    return { ...this.metricsState };
  }

  async invoke<TPayload, TOutput>(
    request: OperationRequest<TPayload>,
  ): Promise<OperationReceipt<TOutput>> {
    const provider = this.registry.get(request.capabilityId);
    if (!provider) throw new Error(`Capability is not registered: ${request.capabilityId}`);
    const receipt = await invokeCapability<TPayload, TOutput>(provider, request);
    this.metricsState.dispatched += 1;
    if (this.receiptSink) {
      this.metricsState.persistenceQueued += 1;
      queueMicrotask(() => {
        void this.receiptSink!.persist(receipt).catch(() => {
          this.metricsState.persistenceFailures += 1;
        });
      });
    }
    return receipt;
  }
}
