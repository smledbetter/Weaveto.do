/**
 * Mock Worker for vitest (Node.js environment).
 * Simulates the postMessage protocol used by the agent executor.
 * Responds to InstantiateRequest and CallRequest with success responses.
 */

import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../src/lib/agents/worker-protocol";
import { vi } from "vitest";

type MessageHandler = (event: MessageEvent<WorkerResponse>) => void;

export class MockWorker {
  private listeners: Map<string, Set<MessageHandler>> = new Map();
  terminated = false;
  postMessageCalls: WorkerRequest[] = [];

  /** Tracks the mock init/on_tick/on_task_event calls for assertions. */
  static callLog: Array<{ fn: string; moduleId?: string }> = [];

  constructor(_url: URL, _options?: WorkerOptions) {
    MockWorker.callLog = [];
  }

  addEventListener(type: string, handler: MessageHandler): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: MessageHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(request: WorkerRequest, _transfer?: Transferable[]): void {
    if (this.terminated) return;
    this.postMessageCalls.push(request);

    // Simulate async response
    queueMicrotask(() => {
      if (this.terminated) return;
      const response = this.buildResponse(request);
      if (response) {
        this.dispatchMessage(response);
      }
    });
  }

  terminate(): void {
    this.terminated = true;
    this.listeners.clear();
  }

  private buildResponse(request: WorkerRequest): WorkerResponse | null {
    switch (request.type) {
      case "instantiate":
        return {
          type: "instantiate_ok",
          id: request.id,
        };

      case "call":
        MockWorker.callLog.push({ fn: request.fn });
        return {
          type: "call_ok",
          id: request.id,
          stateCache: null,
          stateDirty: false,
          emittedEvents: [],
        };

      case "update_context":
        return null; // No response for context updates

      case "terminate":
        this.terminated = true;
        return null;

      default:
        return null;
    }
  }

  private dispatchMessage(response: WorkerResponse): void {
    const handlers = this.listeners.get("message");
    if (!handlers) return;
    const event = { data: response } as MessageEvent<WorkerResponse>;
    for (const handler of handlers) {
      handler(event);
    }
  }
}

/**
 * Install MockWorker as the global Worker.
 * Call in beforeEach() or at module level.
 */
export function installWorkerMock(): void {
  (globalThis as any).Worker = MockWorker;
}

/**
 * Remove the global Worker mock.
 */
export function removeWorkerMock(): void {
  delete (globalThis as any).Worker;
}
