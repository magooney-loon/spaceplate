<script lang="ts">
	import { createSpacetimeDBProvider } from 'spacetimedb/svelte';
	import type { Identity } from 'spacetimedb';
	import { DbConnection, type ErrorContext } from './module_bindings';
	import App from './App.svelte';
	import { log } from './settings.svelte.js';

	const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
	const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'svelte-ts';
	const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

	const onConnect = (_conn: DbConnection, identity: Identity, token: string) => {
		localStorage.setItem(TOKEN_KEY, token);
		log.info('Connected to SpacetimeDB with identity:', identity.toHexString());
	};

	const onDisconnect = () => {
		log.info('Disconnected from SpacetimeDB');
	};

	const onConnectError = (_ctx: ErrorContext, err: Error) => {
		log.error('Error connecting to SpacetimeDB:', err);
	};

	const connectionBuilder = DbConnection.builder()
		.withUri(HOST)
		.withDatabaseName(DB_NAME)
		.withToken(localStorage.getItem(TOKEN_KEY) || undefined)
		.onConnect(onConnect)
		.onDisconnect(onDisconnect)
		.onConnectError(onConnectError);

	createSpacetimeDBProvider(connectionBuilder);
</script>

<App />
