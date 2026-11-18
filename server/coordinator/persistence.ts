/**
 * Phase 2.3.1: SQLite Persistence Adapter for Durable Resource Reservations
 * 
 * Provides atomicity, durable tracking, and startup recovery querying
 * through the existing SQLite schema.
 */

import type { DB } from '../db.js';
import {
  ResourceCoordinatorError,
  type ReservationRecord,
  type ReservationStatus,
  type ResourceType,
} from './types.js';
import { sanitizeDiagnostic } from './worker_protocol.js';

export interface IPersistenceAdapter {
  createReservation(record: ReservationRecord): void;
  updateStatus(
    id: string,
    status: ReservationStatus,
    failureReason?: string,
    releasedAt?: number
  ): void;
  updateHeartbeat(id: string, timestamp: number): void;
  getReservation(id: string): ReservationRecord | null;
  getActiveOrUnresolved(): ReservationRecord[];
  updateReservation(
    id: string,
    update: {
      status?: ReservationStatus;
      pid?: number | null;
      failureReason?: string;
      releasedAt?: number;
      metadata?: Record<string, unknown>;
    }
  ): void;
}

export class SQLitePersistenceAdapter implements IPersistenceAdapter {
  constructor(private readonly db: DB) {}

  public createReservation(record: ReservationRecord): void {
    try {
      this.db
        .prepare(
          `INSERT INTO resource_reservations (
            id, resourceType, ownerId, status, pid, acquiredAt, lastHeartbeatAt, releasedAt, failureReason, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.id,
          record.resourceType,
          record.ownerId,
          record.status,
          record.pid ?? null,
          record.acquiredAt,
          record.lastHeartbeatAt,
          record.releasedAt ?? null,
          record.failureReason ? sanitizeDiagnostic(record.failureReason) : null,
          record.metadata ? JSON.stringify(record.metadata) : '{}'
        );
    } catch (err: any) {
      throw new ResourceCoordinatorError(
        'PERSISTENCE_ERROR',
        `Failed to create reservation record: ${err?.message || err}`
      );
    }
  }

  public updateStatus(
    id: string,
    status: ReservationStatus,
    failureReason?: string,
    releasedAt?: number
  ): void {
    try {
      const sanitizedReason = failureReason ? sanitizeDiagnostic(failureReason) : null;
      this.db
        .prepare(
          `UPDATE resource_reservations
           SET status = ?, failureReason = ?, releasedAt = ?, updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(status, sanitizedReason, releasedAt ?? null, id);
    } catch (err: any) {
      throw new ResourceCoordinatorError(
        'PERSISTENCE_ERROR',
        `Failed to update reservation status: ${err?.message || err}`
      );
    }
  }

  public updateHeartbeat(id: string, timestamp: number): void {
    try {
      this.db
        .prepare(
          `UPDATE resource_reservations
           SET lastHeartbeatAt = ?, updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(timestamp, id);
    } catch (err: any) {
      throw new ResourceCoordinatorError(
        'PERSISTENCE_ERROR',
        `Failed to update heartbeat: ${err?.message || err}`
      );
    }
  }

  public updateReservation(
    id: string,
    update: {
      status?: ReservationStatus;
      pid?: number | null;
      failureReason?: string;
      releasedAt?: number;
      metadata?: Record<string, unknown>;
    }
  ): void {
    try {
      const sets: string[] = ['updatedAt = CURRENT_TIMESTAMP'];
      const params: any[] = [];

      if (update.status !== undefined) {
        sets.push('status = ?');
        params.push(update.status);
      }
      if (update.pid !== undefined) {
        sets.push('pid = ?');
        params.push(update.pid);
      }
      if (update.failureReason !== undefined) {
        sets.push('failureReason = ?');
        params.push(update.failureReason ? sanitizeDiagnostic(update.failureReason) : null);
      }
      if (update.releasedAt !== undefined) {
        sets.push('releasedAt = ?');
        params.push(update.releasedAt);
      }
      if (update.metadata !== undefined) {
        sets.push('metadata = ?');
        params.push(JSON.stringify(update.metadata));
      }

      params.push(id);
      this.db
        .prepare(`UPDATE resource_reservations SET ${sets.join(', ')} WHERE id = ?`)
        .run(...params);
    } catch (err: any) {
      throw new ResourceCoordinatorError(
        'PERSISTENCE_ERROR',
        `Failed to update reservation: ${err?.message || err}`
      );
    }
  }

  public getReservation(id: string): ReservationRecord | null {
    try {
      const row = this.db
        .prepare('SELECT * FROM resource_reservations WHERE id = ?')
        .get(id) as any;
      if (!row) return null;
      return this.mapRow(row);
    } catch (err: any) {
      throw new ResourceCoordinatorError(
        'PERSISTENCE_ERROR',
        `Failed to get reservation: ${err?.message || err}`
      );
    }
  }

  public getActiveOrUnresolved(): ReservationRecord[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM resource_reservations
           WHERE status IN ('REQUESTED', 'LOADING', 'ACTIVE', 'DRAINING', 'UNLOADING', 'VERIFYING_RELEASE', 'RECOVERY_REQUIRED')
           ORDER BY acquiredAt ASC`
        )
        .all() as any[];
      return rows.map((r) => this.mapRow(r));
    } catch (err: any) {
      throw new ResourceCoordinatorError(
        'PERSISTENCE_ERROR',
        `Failed to query unresolved reservations: ${err?.message || err}`
      );
    }
  }

  private mapRow(row: any): ReservationRecord {
    let metadata: Record<string, unknown> = {};
    if (typeof row.metadata === 'string') {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = {};
      }
    }
    return {
      id: row.id,
      resourceType: row.resourceType as ResourceType,
      ownerId: row.ownerId,
      status: row.status as ReservationStatus,
      pid: row.pid ?? undefined,
      acquiredAt: Number(row.acquiredAt),
      lastHeartbeatAt: Number(row.lastHeartbeatAt),
      releasedAt: row.releasedAt ? Number(row.releasedAt) : undefined,
      failureReason: row.failureReason ?? undefined,
      metadata,
    };
  }
}
