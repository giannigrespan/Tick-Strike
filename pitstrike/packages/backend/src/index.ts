/**
 * index.ts — PitStrike backend entry point.
 * Starts the event-bus SSE server (which internally boots the mock feed).
 */

// Side-effect import: starts the Express server + mock feed
import './event-bus/index.js';
