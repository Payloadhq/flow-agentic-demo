/**
 * One-time setup: create + activate the demo Revenue Graph on the Rail.
 * Prints the graph id to put in RAIL_GRAPH_ID.
 *
 * Usage: RAIL_API_KEY=<key> node dist/setup-graph.js [--graph-id g_agentic_demo]
 */
import { loadConfig } from './config.js';
import { RailClient, demoGraphSpec } from './rail.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.railApiKey) throw new Error('RAIL_API_KEY is required');
  const graphId = process.argv[2] === '--graph-id' ? String(process.argv[3] || 'g_agentic_demo') : 'g_agentic_demo';
  const rail = new RailClient({ baseUrl: cfg.railBaseUrl, apiKey: cfg.railApiKey });

  try {
    await rail.getGraph(graphId);
    console.log(`graph '${graphId}' already exists`);
  } catch {
    await rail.createGraph(demoGraphSpec(graphId));
    console.log(`graph '${graphId}' created`);
  }
  await rail.activateGraph(graphId);
  console.log(`graph '${graphId}' activated`);
  console.log('');
  console.log(`Set RAIL_GRAPH_ID=${graphId}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('setup failed:', (err as Error).message);
    process.exit(1);
  });
}
