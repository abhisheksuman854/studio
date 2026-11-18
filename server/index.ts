import { openDb } from './db.js';
import { createApp } from './app.js';
import { SQLitePersistenceAdapter } from './coordinator/persistence.js';
import { ResourceCoordinator } from './coordinator/coordinator.js';
import { ChildProcessSupervisor } from './coordinator/child_supervisor.js';

const db = openDb(process.env.DATABASE_PATH ?? './data/studio.db');
const port = Number(process.env.PORT ?? 4000);

// Initialize persistence and coordinator for durable resource management
const persistence = new SQLitePersistenceAdapter(db);
const coordinator = new ResourceCoordinator({ persistence });

// Reconcile unresolved worker reservations prior to accepting incoming workloads
try {
  const recoveryReport = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(
    coordinator,
    persistence
  );
  if (recoveryReport.failedClosedCount > 0) {
    console.warn(
      `[Startup] ${recoveryReport.failedClosedCount} orphaned worker reservation(s) failed closed: coordinator locked in RECOVERY_REQUIRED`
    );
  } else if (recoveryReport.reconciledCount > 0 || recoveryReport.terminatedCount > 0) {
    console.log(
      `[Startup] Reconciled ${recoveryReport.reconciledCount} dead and terminated ${recoveryReport.terminatedCount} orphan worker reservations`
    );
  }
} catch (err: any) {
  console.error('[Startup] Failed to reconcile orphaned worker reservations:', err?.message || err);
}

const app = createApp(db, { providers: { coordinator } });
app.listen(port, () => console.log(`Content Studio on http://localhost:${port}`));
