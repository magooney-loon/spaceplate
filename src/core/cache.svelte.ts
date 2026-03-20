import * as THREE from 'three';
import { logCache, loggerState } from '$extensions/logger/logger.svelte';

/**
 * Centralized caching system for game assets.
 * Caching is enabled when the 'cache' logger channel is ON.
 * Debug output is also gated by the same channel.
 */
const CACHE_ENABLED = () => loggerState.cache;
const DEBUG_MODE = () => loggerState.cache;

// ============================================================================
// TYPES
// ============================================================================

interface CacheConfig {
	maxSize: number;
	name?: string;
	ttl?: number; // Time-to-live in milliseconds (optional)
}

/**
 * Interface for caches that support TTL (time-to-live) functionality
 */
interface TTLCache<T> {
	cleanupExpired(): number;
}

/**
 * Cache entry wrapper that stores value with creation timestamp
 */
interface CacheEntry<T> {
	value: T;
	timestamp: number;
}

// ============================================================================
// GENERIC CACHE CLASS
// ============================================================================

class LRUCache<T> implements TTLCache<T> {
	protected cache: Map<string, CacheEntry<T>>;
	private maxSize: number;
	private name: string;
	private hits: number = 0;
	private misses: number = 0;
	private ttl?: number; // Time-to-live in milliseconds
	private cleanupInterval?: ReturnType<typeof setInterval>;

	constructor(config: CacheConfig) {
		this.cache = new Map();
		this.maxSize = config.maxSize;
		this.name = config.name || 'Cache';
		this.ttl = config.ttl;

		const ttlInfo = this.ttl ? `TTL: ${(this.ttl / 1000).toFixed(1)}s` : 'No TTL';
		if (DEBUG_MODE()) {
			logCache.info(`📦 Created cache: ${this.name} (max size: ${this.maxSize}, ${ttlInfo})`);
		}

		// Start automatic cleanup if TTL is set
		if (this.ttl) {
			this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000); // Check every minute
		}
	}

	/**
	 * Get value from cache, returns undefined if not found
	 * Updates LRU order and tracks hit/miss statistics
	 */
	/**
	 * Check if an entry has expired
	 */
	private isExpired(entry: CacheEntry<T>): boolean {
		if (!this.ttl) return false;
		return Date.now() - entry.timestamp > this.ttl;
	}

	get(key: string): T | undefined {
		// Skip cache if disabled
		if (!CACHE_ENABLED()) {
			this.misses++;
			if (DEBUG_MODE()) {
				logCache.info(`⏭️  ${this.name} SKIP (disabled): ${key}`);
			}
			return undefined;
		}

		if (this.cache.has(key)) {
			const entry = this.cache.get(key)!;

			// Check for expiration
			if (this.isExpired(entry)) {
				this.cache.delete(key);
				this.onEvict(entry.value);
				if (DEBUG_MODE()) {
					logCache.info(`⏰ ${this.name} EXPIRED: ${key}`);
				}
				this.misses++;
				return undefined;
			}

			// Move to end (most recently used)
			this.cache.delete(key);
			this.cache.set(key, entry);
			this.hits++;
			if (DEBUG_MODE()) {
				logCache.info(`✅ ${this.name} HIT: ${key} (${this.hits} total hits, ${this.misses} misses)`);
			}
			return entry.value;
		}
		this.misses++;
		if (DEBUG_MODE()) {
			logCache.info(`❌ ${this.name} MISS: ${key} (${this.hits} hits, ${this.misses} total misses)`);
		}
		return undefined;
	}

	/**
	 * Peek value from cache without updating LRU order
	 * Does not track hit/miss statistics
	 */
	peek(key: string): T | undefined {
		const entry = this.cache.get(key);
		return entry?.value;
	}

	/**
	 * Delete a specific key from cache
	 */
	delete(key: string): boolean {
		const result = this.cache.delete(key);
		if (result && DEBUG_MODE()) {
			logCache.info(`🗑️  ${this.name} DELETE: ${key}`);
		}
		return result;
	}

	/**
	 * Set value in cache, evicts oldest if full
	 */
	set(key: string, value: T): void {
		// Skip cache if disabled
		if (!CACHE_ENABLED()) {
			if (DEBUG_MODE()) {
				logCache.info(`⏭️  ${this.name} SKIP SET (disabled): ${key}`);
			}
			return;
		}

		const isUpdate = this.cache.has(key);
		const entry: CacheEntry<T> = { value, timestamp: Date.now() };

		// Remove if exists (to move to end)
		if (isUpdate) {
			this.cache.delete(key);
			if (DEBUG_MODE()) {
				logCache.info(`🔄 ${this.name} UPDATE: ${key}`);
			}
		} else if (this.cache.size >= this.maxSize) {
			// Remove oldest (first in Map) and call onEvict
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				const evictedEntry = this.cache.get(firstKey);
				if (evictedEntry) {
					this.onEvict(evictedEntry.value);
				}
				this.cache.delete(firstKey);
				if (DEBUG_MODE()) {
					logCache.info(`⚡ ${this.name} EVICT: ${firstKey} (cache full)`);
				}
			}
		}
		this.cache.set(key, entry);

		if (!isUpdate && DEBUG_MODE()) {
			logCache.info(`➕ ${this.name} SET: ${key} (${this.cache.size}/${this.maxSize})`);
		}
	}

	/**
	 * Remove all expired entries from cache
	 * Returns number of entries removed
	 */
	cleanupExpired(): number {
		if (!this.ttl) return 0;

		let removed = 0;
		const now = Date.now();

		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > this.ttl) {
				this.onEvict(entry.value);
				this.cache.delete(key);
				removed++;
			}
		}

		if (removed > 0 && DEBUG_MODE()) {
			logCache.info(`🧹 ${this.name} CLEANUP: ${removed} expired entries removed`);
		}

		return removed;
	}

	/**
	 * Dispose cache with optional cleanup callback
	 * Stops automatic cleanup interval if running
	 */
	dispose(callback?: (value: T) => void): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		if (callback) {
			this.cache.forEach((entry) => callback(entry.value));
		}
		this.clear();
	}

	/**
	 * Called when a value is evicted from the cache
	 * Override in subclasses to handle cleanup
	 */
	protected onEvict(_value: T | undefined): void {
		// Default: no-op
	}

	/**
	 * Check if key exists in cache
	 */
	has(key: string): boolean {
		return this.cache.has(key);
	}

	/**
	 * Clear all entries from cache
	 */
	clear(): void {
		const size = this.cache.size;
		this.cache.clear();
		if (DEBUG_MODE()) {
			logCache.info(`🧹 ${this.name} CLEAR: ${size} entries removed`);
		}
	}

	/**
	 * Get current cache size
	 */
	get size(): number {
		return this.cache.size;
	}

	/**
	 * Get cache name
	 */
	getName(): string {
		return this.name;
	}

	/**
	 * Get or set pattern - returns cached value or generates and caches new one
	 */
	getOrSet(key: string, generator: () => T): T {
		// If cache is disabled, just generate and return
		if (!CACHE_ENABLED()) {
			if (DEBUG_MODE()) {
				logCache.info(`⏭️  ${this.name} GET OR SET SKIP (disabled): ${key}`);
			}
			return generator();
		}

		const cached = this.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const value = generator();
		this.set(key, value);
		return value;
	}

	/**
	 * Dispose all cached values with optional cleanup callback
	 * Does not clear the cache, only disposes values
	 */
	disposeAll(callback?: (value: T) => void): void {
		if (callback) {
			this.cache.forEach((entry) => callback(entry.value));
		}
	}

	/**
	 * Reset hit/miss statistics
	 */
	resetStats(): void {
		this.hits = 0;
		this.misses = 0;
	}

	/**
	 * Get cache stats including hit rate
	 */
	getStats(): {
		name: string;
		size: number;
		maxSize: number;
		hits: number;
		misses: number;
		hitRate: number;
	} {
		const total = this.hits + this.misses;
		return {
			name: this.name,
			size: this.cache.size,
			maxSize: this.maxSize,
			hits: this.hits,
			misses: this.misses,
			hitRate: total > 0 ? this.hits / total : 0
		};
	}
}

// ============================================================================
// SPECIALIZED CACHES
// ============================================================================

/**
 * Three.js geometry cache - handles proper disposal
 */
class GeometryCache extends LRUCache<THREE.BufferGeometry> {
	constructor(config: CacheConfig) {
		super(config);
	}

	/**
	 * Delete and dispose a specific key from cache
	 */
	delete(key: string): boolean {
		const entry = this.cache.get(key);
		if (entry) {
			entry.value.dispose();
		}
		return super.delete(key);
	}

	/**
	 * Handle geometry disposal on eviction
	 */
	protected onEvict(geometry: THREE.BufferGeometry | undefined): void {
		if (geometry) {
			geometry.dispose();
		}
	}

	/**
	 * Clear all geometries from cache and dispose them
	 */
	clear(): void {
		this.cache.forEach((entry) => {
			entry.value.dispose();
		});
		super.clear();
	}
}

/**
 * Three.js material cache - handles proper disposal
 */
class MaterialCache extends LRUCache<THREE.Material> {
	constructor(config: CacheConfig) {
		super(config);
	}

	/**
	 * Delete and dispose a specific key from cache
	 */
	delete(key: string): boolean {
		const entry = this.cache.get(key);
		if (entry) {
			entry.value.dispose();
		}
		return super.delete(key);
	}

	/**
	 * Handle material disposal on eviction
	 */
	protected onEvict(material: THREE.Material | undefined): void {
		if (material) {
			material.dispose();
		}
	}

	/**
	 * Clear all materials from cache and dispose them
	 */
	clear(): void {
		this.cache.forEach((entry) => {
			entry.value.dispose();
		});
		super.clear();
	}
}

// ============================================================================
// CACHE INSTANCES
// ============================================================================

// Debris icon caching (50 unique debris fields) - 30 min TTL
export const debrisCache = new LRUCache<string>({
	maxSize: Number(import.meta.env.VITE_CACHE_SIZE_DEBRIS) || 50,
	name: 'DebrisCache',
	ttl: 1800000 // 30 minutes in milliseconds
});

// Planet icon SVG caching (30 unique planets) - 1 hour TTL
export const planetIconCache = new LRUCache<string>({
	maxSize: Number(import.meta.env.VITE_CACHE_SIZE_PLANET_ICON) || 30,
	name: 'PlanetIconCache',
	ttl: 3600000 // 1 hour in milliseconds
});

// Planet 3D geometry caching (15 unique planets) - 2 hour TTL
export const planetGeometryCache = new GeometryCache({
	maxSize: Number(import.meta.env.VITE_CACHE_SIZE_PLANET_3D) || 15,
	name: 'PlanetGeometryCache'
});
// Note: GeometryCache extends LRUCache but doesn't support TTL yet
// Add TTL support to GeometryCache if needed

// Planet 3D material caching (15 unique planets) - 2 hour TTL
export const planetMaterialCache = new MaterialCache({
	maxSize: Number(import.meta.env.VITE_CACHE_SIZE_PLANET_3D) || 15,
	name: 'PlanetMaterialCache'
});
// Note: MaterialCache extends LRUCache but doesn't support TTL yet
// Add TTL support to MaterialCache if needed

// Planet uniforms caching (15 unique planets) - 2 hour TTL
export const planetUniformsCache = new LRUCache<any>({
	maxSize: Number(import.meta.env.VITE_CACHE_SIZE_PLANET_3D) || 15,
	name: 'PlanetUniformsCache',
	ttl: 7200000 // 2 hours in milliseconds
});

// Planet smoke nebula colors caching (20 unique configurations) - 1 hour TTL

export const planetSmokeCache = new LRUCache<THREE.Color[]>({
	maxSize: Number(import.meta.env.VITE_CACHE_SIZE_PLANET_SMOKE) || 20,

	name: 'PlanetSmokeCache',

	ttl: 3600000 // 1 hour in milliseconds
});

// Orbital models geometry caching (20 unique models)

export const orbitalGeometryCache = new GeometryCache({
	maxSize: Number(import.meta.env.VITE_CACHE_SIZE_ORBITAL_GEOMETRY) || 20,

	name: 'OrbitalGeometryCache'
});

// Orbital models material caching (20 unique models)

export const orbitalMaterialCache = new MaterialCache({
	maxSize: Number(import.meta.env.VITE_CACHE_SIZE_ORBITAL_MATERIAL) || 20,

	name: 'OrbitalMaterialCache'
});

// ============================================================================

// CACHE MANAGER

// ============================================================================

/**

 * Central cache manager - unified interface for all game caches

 */

export const CacheManager = {
	// Get/Set operations

	get: (cacheName: string, key: string) => {
		const cache = CacheManager.getCacheByName(cacheName);

		return cache?.get(key);
	},

	set: (cacheName: string, key: string, value: unknown): void => {
		const cache = CacheManager.getCacheByName(cacheName);

		cache?.set(key, value as never);
	},

	getOrSet: (cacheName: string, key: string, generator: () => unknown) => {
		const cache = CacheManager.getCacheByName(cacheName);

		if (!cache) return generator();

		return cache.getOrSet(key, generator as never);
	},

	has: (cacheName: string, key: string): boolean => {
		const cache = CacheManager.getCacheByName(cacheName);

		return cache?.has(key) ?? false;
	},

	// Cache management - TTL cleanup

	/**

	 * Remove expired entries from a specific cache

	 * @param cacheName Name of the cache to clean up

	 * @returns Number of expired entries removed

	 */

	cleanupExpired: (cacheName: string): number => {
		const cache = CacheManager.getCacheByName(cacheName);

		if (!cache) return 0;

		// Check if cache supports TTL (implements TTLCache interface)

		const ttlCache = cache as TTLCache<unknown>;

		if (typeof ttlCache.cleanupExpired === 'function') {
			return ttlCache.cleanupExpired();
		}

		return 0;
	},

	/**

	 * Remove expired entries from all caches that support TTL

	 * @returns Total number of expired entries removed across all caches

	 */

	cleanupAllExpired: (): number => {
		let total = 0;

		const caches = CacheManager.getAllCaches();

		for (const cache of Object.values(caches)) {
			const ttlCache = cache as TTLCache<unknown>;

			if (typeof ttlCache.cleanupExpired === 'function') {
				total += ttlCache.cleanupExpired() || 0;
			}
		}

		return total;
	},

	clearCache: (cacheName: string): void => {
		const cache = CacheManager.getCacheByName(cacheName);

		cache?.clear();
	},

	clearAll: (): void => {
		Object.values(CacheManager.getAllCaches()).forEach((cache) => {
			cache.clear();
		});
	},

	// Get all cache stats

	getAllStats: () => {
		return Object.values(CacheManager.getAllCaches()).map((cache) => cache.getStats());
	},

	// Helper methods

	getCacheByName: (name: string) => {
		const caches = CacheManager.getAllCaches();

		const cacheKey = Object.keys(caches).find(
			(key) => caches[key as keyof typeof caches].getName() === name
		);

		return cacheKey ? caches[cacheKey as keyof typeof caches] : undefined;
	},

	getAllCaches: () => ({
		debris: debrisCache,

		planetIcon: planetIconCache,

		planetGeometry: planetGeometryCache,

		planetMaterial: planetMaterialCache,

		planetUniforms: planetUniformsCache,

		planetSmoke: planetSmokeCache,

		orbitalGeometry: orbitalGeometryCache,

		orbitalMaterial: orbitalMaterialCache
	})
};

// ============================================================================

// UTILITY FUNCTIONS

// ============================================================================

/**

 * Generate a cache key from arguments

 * Supports strings, numbers, objects, and arrays

 */

export const createCacheKey = (...args: unknown[]): string => {
	return args

		.map((arg) => {
			if (arg === null || arg === undefined) return 'null';

			if (typeof arg === 'object') {
				return JSON.stringify(arg);
			}

			return String(arg);
		})

		.join('_');
};

/**

 * Convenience function to create a planet cache key

 */

export const createPlanetCacheKey = (
	planetId: string,

	fieldsMax: number,

	temperatureMin: number,

	temperatureMax: number,

	quality: string
): string => {
	return createCacheKey(planetId, fieldsMax, temperatureMin, temperatureMax, quality);
};

/**

 * Convenience function to create a debris cache key

 */

export const createDebrisCacheKey = (
	debrisId: string,

	metal: number,

	crystal: number,

	size: number,

	quality?: string
): string => {
	return createCacheKey(debrisId, metal, crystal, size, quality);
};

/**

 * Convenience function to create a planet icon cache key

 */

export const createPlanetIconCacheKey = (
	planetId: string,

	temperature: number,

	size: number,

	quality?: string
): string => {
	return createCacheKey(planetId, temperature, size, quality);
};

/**

 * Convenience function to create a planet smoke cache key

 */

export const createPlanetSmokeCacheKey = (
	planetId: string,

	temperature: number,

	quality: string
): string => {
	return createCacheKey(planetId, temperature, quality);
};

// ============================================================================

// CACHE CONSTANTS

// ============================================================================

export const CACHE_NAMES = {
	DEBRIS: 'DebrisCache',

	PLANET_ICON: 'PlanetIconCache',

	PLANET_GEOMETRY: 'PlanetGeometryCache',

	PLANET_MATERIAL: 'PlanetMaterialCache',

	PLANET_UNIFORMS: 'PlanetUniformsCache',

	PLANET_SMOKE: 'PlanetSmokeCache',

	ORBITAL_GEOMETRY: 'OrbitalGeometryCache',

	ORBITAL_MATERIAL: 'OrbitalMaterialCache'
} as const;

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

/**
 * Log all cache statistics to console
 * Useful for monitoring cache performance during development
 */
export const logCacheStats = (): void => {
	if (!DEBUG_MODE()) return;

	console.group('📊 Cache Statistics');
	const stats = CacheManager.getAllStats();
	stats.forEach((stat) => {
		console.log(
			`${stat.name}: ${stat.size}/${stat.maxSize} entries, ` +
				`hit rate: ${(stat.hitRate * 100).toFixed(1)}% ` +
				`(${stat.hits} hits, ${stat.misses} misses)`
		);
	});
	console.groupEnd();
};

/**
 * Reset all cache statistics (hits, misses)
 * Useful for testing cache performance between scenarios
 */
export const resetAllCacheStats = (): void => {
	const caches = CacheManager.getAllCaches();
	Object.values(caches).forEach((cache) => {
		if ('resetStats' in cache) {
			(cache as any).resetStats();
		}
	});
	if (DEBUG_MODE()) {
		logCache.info('🔄 All cache statistics reset');
	}
};

/**
 * Get detailed information about a specific cache
 */
export const getCacheDetails = (cacheName: string) => {
	const cache = CacheManager.getCacheByName(cacheName);
	if (!cache) {
		console.warn(`Cache '${cacheName}' not found`);
		return null;
	}

	const stats = cache.getStats();
	const keys = (cache as LRUCache<any>)['cache'].keys();

	return {
		...stats,
		keys: Array.from(keys),
		usagePercent: (stats.size / stats.maxSize) * 100
	};
};

/**
 * Log detailed information about all caches
 */
export const logCacheDetails = (): void => {
	if (!DEBUG_MODE()) return;

	console.group('🔍 Cache Details');
	const caches = CacheManager.getAllCaches();
	Object.entries(caches).forEach(([key, cache]) => {
		const details = getCacheDetails(cache.getName());
		if (details) {
			console.group(`📦 ${details.name} (${details.usagePercent.toFixed(1)}% full)`);
			console.log(`Size: ${details.size}/${details.maxSize}`);
			console.log(`Hit rate: ${(details.hitRate * 100).toFixed(1)}%`);
			console.log(`Hits: ${details.hits}, Misses: ${details.misses}`);
			console.log(
				'Cached keys:',
				details.keys.slice(0, 10),
				details.keys.length > 10 ? `...and ${details.keys.length - 10} more` : ''
			);
			console.groupEnd();
		}
	});
	console.groupEnd();
};

/**
 * Utility to periodically log cache stats during development
 * Returns a cleanup function to stop logging
 */
export const startCacheMonitoring = (intervalMs: number = 5000): (() => void) => {
	if (!DEBUG_MODE()) return () => {};

	const intervalId = setInterval(() => {
		logCacheStats();
	}, intervalMs);

	console.log(`🚀 Cache monitoring started (interval: ${intervalMs}ms)`);

	return () => {
		clearInterval(intervalId);
		logCache.info('🛑 Cache monitoring stopped');
	};
};

// Expose debug utilities to window when cache channel is active
if (typeof window !== 'undefined') {
	(window as any).cacheDebug = {
		logStats: logCacheStats,
		logDetails: logCacheDetails,
		resetStats: resetAllCacheStats,
		getDetails: getCacheDetails,
		startMonitoring: startCacheMonitoring,
		getAllCaches: () => CacheManager.getAllCaches(),
		getCache: (name: string) => CacheManager.getCacheByName(name),
		clearCache: (name: string) => CacheManager.clearCache(name),
		clearAll: () => CacheManager.clearAll(),
		isEnabled: () => CACHE_ENABLED()
	};
}
