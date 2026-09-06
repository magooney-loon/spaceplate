// Scene-wide unit constants — the SI ↔ world boundary every car in this scene
// shares. (Was gr86.ts's header; it is CITY scale, not car data, so it lives
// here now that there is more than one conceptual car.)

/**
 * World units per real metre in TestGame.
 *
 * The GLBs are authored in metres (the chassis collider args are a GR86 to the
 * centimetre), and the scene scales the car ×2.5 to sit right in the city. So
 * the city is built at 2.5 units/metre, and everything the player *perceives* —
 * speed, acceleration, gravity — is the world value divided by this.
 *
 * Consequences, all handled at the call site in the driving controller (sim/):
 * - force:    N_world = N_si * UNITS_PER_METER  (a_world = a_si * UPM, mass is unchanged)
 * - velocity: v_world = v_si * UNITS_PER_METER
 * - angular:  unchanged — rad/s is scale-free, which is why steering is a yaw RATE
 * - gravity:  the shared <World> runs at 9.8 units/s², i.e. 3.9 m/s² here, so the
 *             car's RigidBody carries gravityScale={UNITS_PER_METER} to feel 1 g.
 *             (Scene-local — the global gravity belongs to every other scene too.)
 *
 * If the city model ever gets rescaled, this and the cars' visual scale move together.
 */
export const UNITS_PER_METER = 2.5;

export const G = 9.81;
