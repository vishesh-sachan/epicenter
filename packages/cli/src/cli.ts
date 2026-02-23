import { createLocalServer } from '@epicenter/server';
import yargs from 'yargs';
import { buildActionCommands } from './command-builder';
import { buildKvCommands } from './commands/kv-commands';
import { buildMetaCommands } from './commands/meta-commands';
import { buildTableCommands } from './commands/table-commands';
import type { AnyWorkspaceClient } from './discovery';

export function createCLI(client?: AnyWorkspaceClient) {
	let cli = yargs()
		.scriptName('epicenter')
		.usage('Usage: $0 <command> [options]')
		.help()
		.version()
		.strict()
		.command(
			'serve',
			'Start HTTP server with REST and WebSocket sync endpoints',
			(yargs) =>
				yargs.option('port', {
					type: 'number',
					description: 'Port to run the server on',
					default: 3913,
				}),
			async (argv) => {
				const server = createLocalServer({
					clients: client ? [client] : [],
					port: argv.port,
				});
				server.start();

				console.log(`\nEpicenter server on http://localhost:${argv.port}`);
				console.log(`API docs: http://localhost:${argv.port}/openapi\n`);

				const shutdown = async () => {
					await server.stop();
					process.exit(0);
				};
				process.on('SIGINT', shutdown);
				process.on('SIGTERM', shutdown);

				await new Promise(() => {});
			},
		);

	if (client) {
		const metaCommands = buildMetaCommands(client);
		for (const cmd of metaCommands) {
			cli = cli.command(cmd);
		}

		const tableCommands = buildTableCommands(client);
		for (const cmd of tableCommands) {
			cli = cli.command(cmd);
		}

		const kvCommands = buildKvCommands(client);
		for (const cmd of kvCommands) {
			cli = cli.command(cmd);
		}

		if (client.actions) {
			const commands = buildActionCommands(client.actions);
			for (const cmd of commands) {
				cli = cli.command(cmd);
			}
		}
	}

	return {
		async run(argv: string[]) {
			const cleanup = async () => {
				await client?.destroy();
				process.exit(0);
			};
			process.on('SIGINT', cleanup);
			process.on('SIGTERM', cleanup);

			try {
				await cli.parse(argv);
			} finally {
				process.off('SIGINT', cleanup);
				process.off('SIGTERM', cleanup);
				await client?.destroy();
			}
		},
	};
}
