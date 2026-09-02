<script lang="ts">
	import { createSpacetimeDBProvider } from 'spacetimedb/svelte';
	import type { Identity } from 'spacetimedb';
	import { DbConnection, type ErrorContext } from './module_bindings';
	import App from './App.svelte';
	import { logEngine } from '$extensions/logger';

	const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
	const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'svelte-ts';
	const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

	const onConnect = (_conn: DbConnection, identity: Identity, token: string) => {
		localStorage.setItem(TOKEN_KEY, token);
		logEngine.info('Connected to SpacetimeDB with identity:', identity.toHexString());
	};

	const onDisconnect = () => {
		logEngine.info('Disconnected from SpacetimeDB');
	};

	const onConnectError = (_ctx: ErrorContext, err: Error) => {
		logEngine.error('Error connecting to SpacetimeDB:', err);
	};

	const connectionBuilder = DbConnection.builder()
		.withUri(HOST)
		.withDatabaseName(DB_NAME)
		.withToken(localStorage.getItem(TOKEN_KEY) || undefined)
		.onConnect(onConnect)
		.onDisconnect(onDisconnect)
		.onConnectError(onConnectError);

	// 'false' skips the provider entirely — no websocket, no reconnect retries. Safe
	// to skip because nothing else consumes the connection yet; once game code starts
	// calling useTable/useReducer, those call sites must be gated on this flag too.
	const STDB_ENABLED = import.meta.env.VITE_STDB_ENABLE !== 'false';
	if (STDB_ENABLED) {
		createSpacetimeDBProvider(connectionBuilder);
	} else {
		logEngine.info('SpacetimeDB disabled (VITE_STDB_ENABLE=false)');
	}
</script>

<App />
