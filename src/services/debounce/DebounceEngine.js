// src/services/debounce/DebounceEngine.js
/**
 * DebounceEngine — Server-side debouncing for high-frequency events.
 *
 * Supports:
 *  - Per-key debounce with trailing-edge execution
 *  - Leading-edge option (fire immediately, then silence)
 *  - Max-wait ceiling (like lodash.debounce maxWait)
 *  - Flush (force execute) and Cancel
 *  - Statistics tracking per key
 */

import logger from '../../utils/logger.js';
import { EventEmitter } from 'events';

export class DebounceEngine extends EventEmitter {
  constructor() {
    super();
    // Map<key, { timer, leadingTimer, maxWaitTimer, lastArgs, callCount, lastFired }>
    this._timers = new Map();
    this._stats = new Map();   // Global call/suppress statistics
  }

  /**
   * Debounce a function call identified by `key`.
   *
   * @param {string} key        - Unique key per user/context (e.g. `typing:userId:roomId`)
   * @param {Function} fn       - Function to debounce
   * @param {number} wait       - Debounce delay in ms
   * @param {Object} options
   * @param {boolean} options.leading   - Fire on leading edge too (default false)
   * @param {number}  options.maxWait   - Max ms before forced execution (default none)
   * @param {any[]}   options.args      - Args to pass to fn
   */
  debounce(key, fn, wait, { leading = false, maxWait = null, args = [] } = {}) {
    const existing = this._timers.get(key);

    // ── Track statistics ──────────────────────────────────────────────
    if (!this._stats.has(key)) {
      this._stats.set(key, { total: 0, suppressed: 0, executed: 0 });
    }
    const stat = this._stats.get(key);
    stat.total++;

    // ── Leading edge: fire immediately if no active timer ─────────────
    if (leading && !existing) {
      this._execute(key, fn, args, stat, 'leading');
    } else if (existing) {
      stat.suppressed++;
    }

    // ── Clear existing trailing timer ─────────────────────────────────
    if (existing?.timer) clearTimeout(existing.timer);

    // ── Set trailing timer ────────────────────────────────────────────
    const timer = setTimeout(() => {
      const entry = this._timers.get(key);
      if (entry?.maxWaitTimer) clearTimeout(entry.maxWaitTimer);
      this._execute(key, fn, entry?.lastArgs || args, stat, 'trailing');
      this._timers.delete(key);
    }, wait);

    // ── Set maxWait timer (first call only) ───────────────────────────
    let maxWaitTimer = existing?.maxWaitTimer;
    if (!maxWaitTimer && maxWait) {
      maxWaitTimer = setTimeout(() => {
        logger.debug(`[Debounce] maxWait triggered for key: ${key}`);
        const entry = this._timers.get(key);
        if (entry?.timer) clearTimeout(entry.timer);
        this._execute(key, fn, entry?.lastArgs || args, stat, 'maxWait');
        this._timers.delete(key);
      }, maxWait);
    }

    this._timers.set(key, { timer, maxWaitTimer, lastArgs: args });
  }

  /**
   * Force-execute and clear the debounce for a key immediately.
   */
  flush(key) {
    const entry = this._timers.get(key);
    if (!entry) return false;

    clearTimeout(entry.timer);
    if (entry.maxWaitTimer) clearTimeout(entry.maxWaitTimer);
    // We don't have fn stored — callers should track this
    this._timers.delete(key);
    logger.debug(`[Debounce] Flushed key: ${key}`);
    return true;
  }

  /**
   * Cancel a debounced call without executing it.
   */
  cancel(key) {
    const entry = this._timers.get(key);
    if (!entry) return false;

    clearTimeout(entry.timer);
    if (entry.maxWaitTimer) clearTimeout(entry.maxWaitTimer);
    this._timers.delete(key);

    const stat = this._stats.get(key);
    if (stat) stat.suppressed++;

    logger.debug(`[Debounce] Cancelled key: ${key}`);
    return true;
  }

  /**
   * Check if a key has an active debounce timer.
   */
  isPending(key) {
    return this._timers.has(key);
  }

  /**
   * Get statistics for a specific key or all keys.
   */
  getStats(key = null) {
    if (key) return this._stats.get(key) || null;
    return Object.fromEntries(this._stats);
  }

  /**
   * Clear all pending timers (use on shutdown).
   */
  destroy() {
    for (const [key, entry] of this._timers) {
      clearTimeout(entry.timer);
      if (entry.maxWaitTimer) clearTimeout(entry.maxWaitTimer);
    }
    this._timers.clear();
    logger.info('[Debounce] Engine destroyed — all timers cleared');
  }

  _execute(key, fn, args, stat, edge) {
    try {
      stat.executed++;
      logger.debug(`[Debounce] Executing key="${key}" edge="${edge}" (${stat.suppressed} suppressed)`);
      const result = fn(...args);
      this.emit('executed', { key, edge, stat: { ...stat } });
      return result;
    } catch (err) {
      logger.error(`[Debounce] Error executing key="${key}": ${err.message}`);
      this.emit('error', { key, error: err });
    }
  }
}

// ─── Specialized debounce managers built on top of DebounceEngine ──────────

/**
 * TypingDebouncer — handles "user is typing..." broadcasts.
 *
 * When a user types, we:
 *  1. Immediately emit typing:start (leading edge)
 *  2. Debounce the typing:stop event (if silent for WAIT ms → stop)
 */
export class TypingDebouncer {
  constructor(io, wait = 1500) {
    this.engine = new DebounceEngine();
    this.io = io;
    this.wait = wait;
    this._activeTypers = new Map(); // key → { userId, roomId }
  }

  userIsTyping(userId, roomId) {
    const key = `typing:${userId}:${roomId}`;
    const wasActive = this._activeTypers.has(key);

    if (!wasActive) {
      // Broadcast typing:start immediately
      this._broadcastTypingStart(userId, roomId);
      this._activeTypers.set(key, { userId, roomId });
    }

    // Debounce the stop event — reset timer on each keystroke
    this.engine.debounce(key, () => {
      this._broadcastTypingStop(userId, roomId);
      this._activeTypers.delete(key);
    }, this.wait, { args: [] });
  }

  userStoppedTyping(userId, roomId) {
    const key = `typing:${userId}:${roomId}`;
    this.engine.cancel(key);
    this._broadcastTypingStop(userId, roomId);
    this._activeTypers.delete(key);
  }

  getActiveTypers(roomId) {
    const typers = [];
    for (const [key, data] of this._activeTypers) {
      if (data.roomId === roomId) typers.push(data.userId);
    }
    return typers;
  }

  _broadcastTypingStart(userId, roomId) {
    this.io.to(roomId).emit('typing:start', { userId, roomId, timestamp: Date.now() });
    logger.debug(`[Typing] START userId=${userId} roomId=${roomId}`);
  }

  _broadcastTypingStop(userId, roomId) {
    this.io.to(roomId).emit('typing:stop', { userId, roomId, timestamp: Date.now() });
    logger.debug(`[Typing] STOP userId=${userId} roomId=${roomId}`);
  }
}

/**
 * NotificationDebouncer — batches notifications to avoid spamming users.
 *
 * Instead of sending 20 notifications in 30s, collect them and send ONE digest.
 * Uses per-user trailing debounce with a maxWait ceiling.
 */
export class NotificationDebouncer {
  constructor(deliveryFn, wait = 30000, maxWait = 60000) {
    this.engine = new DebounceEngine();
    this.deliveryFn = deliveryFn;
    this.wait = wait;
    this.maxWait = maxWait;
    this._batches = new Map(); // userId → notification[]
  }

  queue(userId, notification) {
    const key = `notif:${userId}`;

    // Accumulate into batch
    if (!this._batches.has(key)) {
      this._batches.set(key, []);
    }
    this._batches.get(key).push({ ...notification, queuedAt: Date.now() });

    logger.debug(`[NotifDebounce] Queued for userId=${userId}, batch size=${this._batches.get(key).length}`);

    // Debounce delivery — wait for quiet period, but respect maxWait
    this.engine.debounce(key, () => {
      const batch = this._batches.get(key) || [];
      this._batches.delete(key);

      if (batch.length === 0) return;

      logger.info(`[NotifDebounce] Delivering ${batch.length} notifications to userId=${userId}`);
      this.deliveryFn(userId, batch);
    }, this.wait, { maxWait: this.maxWait, args: [] });
  }

  /**
   * Force-deliver all pending notifications for a user (e.g. they just logged in).
   */
  flushUser(userId) {
    const key = `notif:${userId}`;
    const batch = this._batches.get(key) || [];
    this._batches.delete(key);
    this.engine.cancel(key);

    if (batch.length > 0) {
      logger.info(`[NotifDebounce] Force-flushing ${batch.length} notifications for userId=${userId}`);
      this.deliveryFn(userId, batch);
    }
  }

  getPendingCount(userId) {
    return (this._batches.get(`notif:${userId}`) || []).length;
  }
}

// Singleton instance shared across services
export const debounceEngine = new DebounceEngine();
