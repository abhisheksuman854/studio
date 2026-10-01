import { openDb } from './db.js';
import { createApp } from './app.js';
const db = openDb(process.env.DATABASE_PATH ?? './data/studio.db');
const port = Number(process.env.PORT ?? 4000);
createApp(db).listen(port, () => console.log(`Content Studio on http://localhost:${port}`));
