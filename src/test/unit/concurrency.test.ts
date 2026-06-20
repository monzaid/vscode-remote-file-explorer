/**
 * Unit tests for ConcurrencyController.
 * Tests the concurrency control queue that limits simultaneous remote operations.
 */

import { expect } from 'chai';
import { ConcurrencyController } from '../../core/ConcurrencyController';

/** Helper: create a delayed async function that resolves after `ms` milliseconds */
function delayedResolve<T>(value: T, ms: number): () => Promise<T> {
  return () => new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Helper: create a delayed async function that rejects after `ms` milliseconds */
function delayedReject(ms: number, error?: Error): () => Promise<never> {
  return () =>
    new Promise((_, reject) =>
      setTimeout(() => reject(error ?? new Error('test error')), ms),
    );
}

describe('ConcurrencyController', () => {
  let controller: ConcurrencyController;

  beforeEach(() => {
    controller = new ConcurrencyController(5);
  });

  describe('initial state', () => {
    it('should have activeCount 0 and pendingCount 0', () => {
      expect(controller.activeCount).to.equal(0);
      expect(controller.pendingCount).to.equal(0);
    });

    it('should not be full', () => {
      expect(controller.isFull).to.be.false;
    });
  });

  describe('max concurrent operations', () => {
    it('should enforce max 5 concurrent operations', async () => {
      // Enqueue 6 operations — first 5 execute immediately, 6th is queued
      const promises: Promise<number>[] = [];
      for (let i = 0; i < 6; i++) {
        promises.push(controller.enqueue(delayedResolve(i, 50), `op-${i}`));
      }

      // After a tick, 5 should be active and 1 pending
      await new Promise((r) => setTimeout(r, 5));
      expect(controller.activeCount).to.be.at.most(5);
      expect(controller.pendingCount).to.be.at.least(1);

      // Wait for all to complete
      const results = await Promise.all(promises);
      expect(results).to.deep.equal([0, 1, 2, 3, 4, 5]);
      expect(controller.activeCount).to.equal(0);
      expect(controller.pendingCount).to.equal(0);
    });

    it('should respect custom maxConcurrent value', async () => {
      const smallController = new ConcurrencyController(2);

      const promises: Promise<number>[] = [];
      for (let i = 0; i < 4; i++) {
        promises.push(smallController.enqueue(delayedResolve(i, 30), `op-${i}`));
      }

      await new Promise((r) => setTimeout(r, 5));
      expect(smallController.activeCount).to.equal(2);
      expect(smallController.pendingCount).to.equal(2);

      await Promise.all(promises);
      expect(smallController.activeCount).to.equal(0);
      expect(smallController.pendingCount).to.equal(0);
    });
  });

  describe('queued operations order', () => {
    it('should resolve queued operations in FIFO order', async () => {
      const results: number[] = [];
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 3; i++) {
        promises.push(
          controller.enqueue(async () => {
            await new Promise((r) => setTimeout(r, 10));
            results.push(i);
          }, `op-${i}`),
        );
      }

      await Promise.all(promises);
      expect(results).to.deep.equal([0, 1, 2]);
    });

    it('should dequeue and execute when slots free up', async () => {
      const controller2 = new ConcurrencyController(1);
      const executionOrder: number[] = [];

      const p1 = controller2.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 30));
        executionOrder.push(1);
      });
      const p2 = controller2.enqueue(async () => {
        executionOrder.push(2);
      });
      const p3 = controller2.enqueue(async () => {
        executionOrder.push(3);
      });

      // After first tick: 1 is active, 2 and 3 are queued
      await new Promise((r) => setTimeout(r, 5));
      expect(controller2.activeCount).to.equal(1);
      expect(controller2.pendingCount).to.equal(2);

      await Promise.all([p1, p2, p3]);
      expect(executionOrder).to.deep.equal([1, 2, 3]);
      expect(controller2.activeCount).to.equal(0);
      expect(controller2.pendingCount).to.equal(0);
    });
  });

  describe('error propagation', () => {
    it('should propagate errors from operations to the caller', async () => {
      try {
        await controller.enqueue(delayedReject(10, new Error('BOOM')));
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.equal('BOOM');
      }
    });

    it('should continue processing queued ops after an error', async () => {
      const controller1 = new ConcurrencyController(1);
      const results: string[] = [];

      // With maxConcurrent=1, operations execute sequentially.
      // First op rejects, then second op runs.
      const p1 = controller1
        .enqueue(delayedReject(10, new Error('fail')))
        .catch((err: Error) => {
          results.push(`error:${err.message}`);
        });
      const p2 = controller1.enqueue(async () => {
        results.push('ok');
      });

      await Promise.all([p1, p2]);
      // Both complete: error first (it was enqueued first), then ok
      expect(results).to.include('error:fail');
      expect(results).to.include('ok');
      expect(controller1.activeCount).to.equal(0);
      expect(controller1.pendingCount).to.equal(0);
    });
  });

  describe('activeCount and pendingCount', () => {
    it('should accurately report activeCount and pendingCount', async () => {
      const ctrl = new ConcurrencyController(2);

      // Start 2 slow operations
      const p1 = ctrl.enqueue(delayedResolve('a', 100));
      const p2 = ctrl.enqueue(delayedResolve('b', 100));

      await new Promise((r) => setTimeout(r, 10));
      expect(ctrl.activeCount).to.equal(2);
      expect(ctrl.pendingCount).to.equal(0);

      // Enqueue 2 more — should be pending
      const p3 = ctrl.enqueue(delayedResolve('c', 10));
      const p4 = ctrl.enqueue(delayedResolve('d', 10));

      await new Promise((r) => setTimeout(r, 10));
      expect(ctrl.pendingCount).to.equal(2);

      await Promise.all([p1, p2, p3, p4]);
      expect(ctrl.activeCount).to.equal(0);
      expect(ctrl.pendingCount).to.equal(0);
    });

    it('should show isFull when at capacity', async () => {
      const ctrl = new ConcurrencyController(1);

      const p1 = ctrl.enqueue(delayedResolve('x', 50));
      await new Promise((r) => setTimeout(r, 5));

      expect(ctrl.isFull).to.be.true;

      const p2 = ctrl.enqueue(delayedResolve('y', 10));
      expect(ctrl.pendingCount).to.equal(1);

      await Promise.all([p1, p2]);
      expect(ctrl.isFull).to.be.false;
    });
  });
});
