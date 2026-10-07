import { createCostStore } from '../lib/cost-store.js';
// Initializes a ledger in an EXISTING approved store; creates no resources.
if (process.env.CONFIRM_COST_STORE_INITIALIZATION !== 'true') {
    throw new Error('Only initialize an approved existing store: set CONFIRM_COST_STORE_INITIALIZATION=true. Never reinitialize a lost ledger on the same day.');
}
const created = await createCostStore().initialize();
console.log(created ? 'Cost ledger initialized.' : 'Ledger already exists; counters unchanged.');
