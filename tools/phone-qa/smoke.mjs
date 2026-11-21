import { run } from './lib.mjs';
await run('smoke', async (t) => { await t.seed(); await t.nav('Today'); t.rec('metrics-today', true, JSON.stringify(await t.metrics())); });
