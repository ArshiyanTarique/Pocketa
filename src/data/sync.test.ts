import { describe, it, expect, beforeEach } from 'vitest';
import { syncOnce, type RemoteOp, type SyncTransport } from './sync';
import { makeOp, mergeOps, compareOps, pendingOps, type Op } from './oplog';

/**
 * An in-memory stand-in for the `ops` table.
 *
 * It models the parts of the real schema that sync actually depends on:
 *
 *   - `id` is the primary key, so an upsert replaces rather than duplicates
 *   - `server_seq` is a bigserial: assigned on insert, and NOT reissued when a
 *     conflicting upsert updates an existing row
 *   - row-level security scopes every read to one account
 *
 * Convergence is the risky half of sync, and it is entirely decidable without a
 * network. What this cannot prove is the transport itself — that the real
 * Postgres upsert and RLS policies behave as modelled here.
 */
class FakeServer {
  rows = new Map<string, RemoteOp>();
  private seq = 0;
  /** Every push the server saw, including ones whose reply was lost. */
  pushLog: string[][] = [];

  upsert(incoming: Array<Omit<RemoteOp, 'server_seq'>>): Array<{ id: string; server_seq: number }> {
    this.pushLog.push(incoming.map((r) => r.id));
    return incoming.map((row) => {
      const existing = this.rows.get(row.id);
      // An updating upsert keeps the sequence it was first given.
      const server_seq = existing ? existing.server_seq : ++this.seq;
      this.rows.set(row.id, { ...row, server_seq });
      return { id: row.id, server_seq };
    });
  }

  select(userId: string, since: number, limit: number): RemoteOp[] {
    return [...this.rows.values()]
      .filter((r) => r.user_id === userId && r.server_seq > since)
      .sort((a, b) => a.server_seq - b.server_seq)
      .slice(0, limit);
  }
}

function transportFor(server: FakeServer, userId: string | null): SyncTransport {
  return {
    currentUserId: async () => userId,
    push: async (rows) => server.upsert(rows),
    pull: async (uid, since, limit) => server.select(uid, since, limit),
  };
}

/** A device: its own id, its own Lamport clock, its own copy of the log. */
class Device {
  ops: Op[] = [];
  private clock: { deviceId: string; lamport: number };

  name: string;
  private server: FakeServer;
  private userId: string | null;

  constructor(name: string, server: FakeServer, userId: string | null = 'user-1') {
    this.name = name;
    this.server = server;
    this.userId = userId;
    this.clock = { deviceId: name, lamport: 0 };
  }

  /** Record a change locally, as the store does. */
  write(summary: string, entityId = 'txn_1'): Op {
    const op = makeOp(this.clock, {
      type: 'txn.created',
      entity: 'transaction',
      entityId,
      summary,
      snapshot: { id: entityId, summary },
    });
    this.ops.push(op);
    return op;
  }

  async sync(options: { dropAck?: boolean } = {}) {
    const result = await syncOnce(this.ops, {
      transport: transportFor(this.server, this.userId),
      online: true,
    });
    if (!result.ok) return result;

    // Losing the acknowledgement is the interesting failure: the server has the
    // ops, the device does not know it.
    if (!options.dropAck) {
      this.ops = this.ops.map((op) =>
        result.seqByOpId[op.id] != null
          ? { ...op, synced: 1 as const, serverSeq: result.seqByOpId[op.id] }
          : op,
      );
    }
    this.ops = mergeOps(this.ops, result.pulled);
    return result;
  }

  /** What this device believes the history to be, in order. */
  view(): string[] {
    return [...this.ops].sort(compareOps).map((o) => o.summary);
  }
}

let server: FakeServer;
beforeEach(() => {
  server = new FakeServer();
});

// ===========================================================================
describe('a single device', () => {
  it('pushes what it has authored and records the assigned sequences', async () => {
    const a = new Device('device-a', server);
    a.write('Groceries');
    a.write('Fuel');

    const result = await a.sync();
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(2);
    expect(a.ops.every((o) => o.synced === 1)).toBe(true);
    expect(a.ops.every((o) => typeof o.serverSeq === 'number')).toBe(true);
  });

  it('has nothing left pending once synced', async () => {
    const a = new Device('device-a', server);
    a.write('Groceries');
    await a.sync();
    expect(pendingOps(a.ops)).toHaveLength(0);
  });

  it('does not re-push on a second round', async () => {
    const a = new Device('device-a', server);
    a.write('Groceries');
    await a.sync();
    const second = await a.sync();
    expect(second.pushed).toBe(0);
    expect(second.pulled).toHaveLength(0);
  });

  it('pulls nothing it already has', async () => {
    const a = new Device('device-a', server);
    a.write('Groceries');
    await a.sync();
    await a.sync();
    expect(a.ops).toHaveLength(1);
  });
});

// ===========================================================================
describe('two devices, one account', () => {
  it('carries a change from one device to the other', async () => {
    const phone = new Device('phone', server);
    const laptop = new Device('laptop', server);

    phone.write('Dinner at OPTP');
    await phone.sync();

    const result = await laptop.sync();
    expect(result.pulled).toHaveLength(1);
    expect(laptop.view()).toEqual(['Dinner at OPTP']);
  });

  it('converges when both edited offline', async () => {
    const phone = new Device('phone', server);
    const laptop = new Device('laptop', server);

    // Neither can see the other yet.
    phone.write('Groceries', 'txn_a');
    phone.write('Fuel', 'txn_b');
    laptop.write('Rent', 'txn_c');
    laptop.write('Salary', 'txn_d');

    // Both come back online, in some order.
    await phone.sync();
    await laptop.sync();
    await phone.sync();

    expect(phone.ops).toHaveLength(4);
    expect(laptop.ops).toHaveLength(4);
    // The order is the same on both, because the server assigned it.
    expect(phone.view()).toEqual(laptop.view());
  });

  it('converges regardless of which device syncs first', async () => {
    const run = async (laptopFirst: boolean) => {
      const s = new FakeServer();
      const phone = new Device('phone', s);
      const laptop = new Device('laptop', s);
      phone.write('Phone edit', 'txn_p');
      laptop.write('Laptop edit', 'txn_l');

      if (laptopFirst) {
        await laptop.sync();
        await phone.sync();
        await laptop.sync();
      } else {
        await phone.sync();
        await laptop.sync();
        await phone.sync();
      }
      return { phone: phone.view(), laptop: laptop.view() };
    };

    const first = await run(true);
    const second = await run(false);
    expect(first.phone).toEqual(first.laptop);
    expect(second.phone).toEqual(second.laptop);
  });

  it('keeps both sides of a concurrent edit, rather than losing one', async () => {
    const phone = new Device('phone', server);
    const laptop = new Device('laptop', server);

    // The same transaction amended on two devices while both were offline.
    phone.write('Amount 4,000 to 3,500', 'txn_shared');
    laptop.write('Amount 4,000 to 3,200', 'txn_shared');

    await phone.sync();
    await laptop.sync();
    await phone.sync();

    // Neither amendment is discarded: the audit history holds both, and the
    // server sequence decides which one the entity ends on.
    expect(phone.ops).toHaveLength(2);
    expect(phone.view()).toEqual(laptop.view());
    expect(phone.view()).toContain('Amount 4,000 to 3,500');
    expect(phone.view()).toContain('Amount 4,000 to 3,200');
  });

  it('propagates a long history without duplication', async () => {
    const phone = new Device('phone', server);
    const laptop = new Device('laptop', server);

    for (let i = 0; i < 50; i++) phone.write(`Entry ${i}`, `txn_${i}`);
    await phone.sync();
    await laptop.sync();

    expect(laptop.ops).toHaveLength(50);
    expect(new Set(laptop.ops.map((o) => o.id)).size).toBe(50);
    expect(laptop.view()).toEqual(phone.view());
  });
});

// ===========================================================================
describe('interrupted and repeated pushes', () => {
  it('is safe to repeat a push whose acknowledgement was lost', async () => {
    const phone = new Device('phone', server);
    phone.write('Groceries');

    // The server received it; the reply never arrived.
    await phone.sync({ dropAck: true });
    expect(server.rows.size).toBe(1);
    expect(pendingOps(phone.ops)).toHaveLength(1);

    // Retrying must not create a second row.
    await phone.sync();
    expect(server.rows.size).toBe(1);
    expect(phone.ops).toHaveLength(1);
    expect(pendingOps(phone.ops)).toHaveLength(0);
  });

  it('keeps the original sequence when an op is re-pushed', async () => {
    const phone = new Device('phone', server);
    const op = phone.write('Groceries');
    await phone.sync({ dropAck: true });
    const firstSeq = server.rows.get(op.id)!.server_seq;

    await phone.sync();
    expect(server.rows.get(op.id)!.server_seq).toBe(firstSeq);
  });

  it('does not let a repeated push reorder history on the other device', async () => {
    const phone = new Device('phone', server);
    const laptop = new Device('laptop', server);

    phone.write('First', 'txn_1');
    await phone.sync({ dropAck: true });
    laptop.write('Second', 'txn_2');
    await laptop.sync();

    await phone.sync();
    await laptop.sync();

    expect(phone.view()).toEqual(laptop.view());
    expect(phone.view()[0]).toBe('First');
  });
});

// ===========================================================================
describe('account isolation', () => {
  it('never shows one account another account\'s ops', async () => {
    const mine = new Device('mine', server, 'user-1');
    const theirs = new Device('theirs', server, 'user-2');

    mine.write('My rent', 'txn_mine');
    theirs.write('Their rent', 'txn_theirs');
    await mine.sync();
    await theirs.sync();
    await mine.sync();

    expect(mine.view()).toEqual(['My rent']);
    expect(theirs.view()).toEqual(['Their rent']);
  });

  it('refuses to sync when signed out', async () => {
    const device = new Device('device', server, null);
    device.write('Groceries');
    const result = await device.sync();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sign in/i);
    expect(server.rows.size).toBe(0);
  });
});

// ===========================================================================
describe('refusing to proceed', () => {
  it('says so plainly when sync is not configured', async () => {
    const result = await syncOnce([], { transport: null, online: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  it('does not attempt a push while offline', async () => {
    const phone = new Device('phone', server);
    phone.write('Groceries');
    const result = await syncOnce(phone.ops, {
      transport: transportFor(server, 'user-1'),
      online: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/offline/i);
    expect(server.rows.size).toBe(0);
  });

  it('reports a server failure without losing local ops', async () => {
    const failing: SyncTransport = {
      currentUserId: async () => 'user-1',
      push: async () => {
        throw new Error('duplicate key value violates unique constraint');
      },
      pull: async () => [],
    };
    const phone = new Device('phone', server);
    phone.write('Groceries');

    const result = await syncOnce(phone.ops, { transport: failing, online: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/duplicate key/);
    // The op is still here, still pending, ready for the next attempt.
    expect(pendingOps(phone.ops)).toHaveLength(1);
  });

  it('survives a pull failure the same way', async () => {
    const failing: SyncTransport = {
      currentUserId: async () => 'user-1',
      push: async (rows) => rows.map((r, i) => ({ id: r.id, server_seq: i + 1 })),
      pull: async () => {
        throw new Error('network timeout');
      },
    };
    const phone = new Device('phone', server);
    phone.write('Groceries');
    const result = await syncOnce(phone.ops, { transport: failing, online: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timeout/);
  });
});

// ===========================================================================
describe('what travels', () => {
  it('carries the entity snapshot, so a peer can apply it without replaying', async () => {
    const phone = new Device('phone', server);
    const laptop = new Device('laptop', server);
    phone.write('Groceries', 'txn_snap');
    await phone.sync();
    await laptop.sync();

    const arrived = laptop.ops[0];
    expect(arrived.snapshot).toEqual({ id: 'txn_snap', summary: 'Groceries' });
    expect(arrived.entity).toBe('transaction');
    expect(arrived.entityId).toBe('txn_snap');
    expect(arrived.synced).toBe(1);
  });

  it('preserves the authoring device, so history stays attributable', async () => {
    const phone = new Device('phone', server);
    const laptop = new Device('laptop', server);
    phone.write('Groceries');
    await phone.sync();
    await laptop.sync();
    expect(laptop.ops[0].deviceId).toBe('phone');
  });

  it('pages rather than pulling an unbounded history at once', async () => {
    const phone = new Device('phone', server);
    for (let i = 0; i < 30; i++) phone.write(`Entry ${i}`, `txn_${i}`);
    await phone.sync();

    const laptop = new Device('laptop', server);
    const first = await syncOnce(laptop.ops, {
      transport: transportFor(server, 'user-1'),
      online: true,
      limit: 10,
    });
    expect(first.pulled).toHaveLength(10);

    // The next round resumes after the highest sequence already held.
    laptop.ops = mergeOps(laptop.ops, first.pulled);
    const second = await syncOnce(laptop.ops, {
      transport: transportFor(server, 'user-1'),
      online: true,
      limit: 10,
    });
    expect(second.pulled).toHaveLength(10);
    expect(new Set([...first.pulled, ...second.pulled].map((o) => o.id)).size).toBe(20);
  });
});
