// src/workers/changeStreamWatcher.js
/**
 * MongoDB Change Streams Watcher
 *
 * NOTE: Change Streams require MongoDB to run as a Replica Set.
 * In standalone/dev mode this module skips gracefully with a warning.
 */
import { Message, Room } from '../models/index.js';
import logger from '../utils/logger.js';

let messageWatcher = null;
let roomWatcher = null;

// ─── Entry point ─────────────────────────────────────────────────────────────
export async function startChangeStreams(io, notificationService) {
  const supported = await checkChangeStreamSupport();

  if (!supported) {
    logger.warn([
      '',
      '  ⚠️  Change Streams DISABLED — MongoDB is not a Replica Set.',
      '  Real-time DB fan-out will be skipped.',
      '  All other features (messaging, notifications, sockets) work fine.',
      '  To enable → convert MongoDB to a replica set (see instructions below).',
      '',
    ].join('\n'));
    return;
  }

  startMessageStream(io, notificationService);
  startRoomStream(io);
}

// ─── Message stream ───────────────────────────────────────────────────────────
function startMessageStream(io, notificationService) {
  const pipeline = [
    {
      $match: {
        operationType: { $in: ['insert', 'update', 'delete'] },
      },
    },
    {
      $project: {
        operationType: 1,
        fullDocument: 1,
        updateDescription: 1,
        documentKey: 1,
      },
    },
  ];

  messageWatcher = Message.watch(pipeline, {
    fullDocument: 'updateLookup',
    resumeAfter: null,
  });

  messageWatcher.on('change', async (change) => {
    try {
      const { operationType, fullDocument } = change;

      if (operationType === 'insert' && fullDocument) {
        logger.debug(`[ChangeStream] New message: ${fullDocument._id}`);
        scheduleRoomStatsUpdate(fullDocument.room?.toString());
      }

      if (operationType === 'update' && fullDocument) {
        if (fullDocument.isDeleted) {
          io.to(fullDocument.room.toString()).emit('message:deleted', {
            messageId: fullDocument._id,
            roomId: fullDocument.room,
          });
        }
      }
    } catch (err) {
      logger.error(`[ChangeStream] Message handler error: ${err.message}`);
    }
  });

  messageWatcher.on('error', (err) => {
    logger.error(`[ChangeStream] Message stream error: ${err.message}`);
  });

  logger.info('✅ Message change stream started');
}

// ─── Room stream ──────────────────────────────────────────────────────────────
function startRoomStream(io) {
  roomWatcher = Room.watch(
    [{ $match: { operationType: { $in: ['update'] } } }],
    { fullDocument: 'updateLookup' }
  );

  roomWatcher.on('change', async (change) => {
    try {
      const { fullDocument } = change;
      if (!fullDocument) return;
      io.to(fullDocument._id.toString()).emit('room:updated', {
        roomId: fullDocument._id,
        name: fullDocument.name,
        memberCount: fullDocument.members.length,
        updatedAt: new Date(),
      });
    } catch (err) {
      logger.error(`[ChangeStream] Room handler error: ${err.message}`);
    }
  });

  logger.info('✅ Room change stream started');
}

// ─── Debounced stats aggregation ──────────────────────────────────────────────
const statsUpdateTimers = new Map();

function scheduleRoomStatsUpdate(roomId) {
  if (!roomId) return;
  if (statsUpdateTimers.has(roomId)) clearTimeout(statsUpdateTimers.get(roomId));
  statsUpdateTimers.set(roomId, setTimeout(async () => {
    statsUpdateTimers.delete(roomId);
    try {
      const count = await Message.countDocuments({ room: roomId, isDeleted: false });
      await Room.updateOne({ _id: roomId }, { $set: { messageCount: count } });
      logger.debug(`[ChangeStream] Stats updated for room=${roomId}: ${count} messages`);
    } catch (err) {
      logger.error(`[ChangeStream] Stats update failed: ${err.message}`);
    }
  }, 5000));
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────
export async function stopChangeStreams() {
  if (messageWatcher) await messageWatcher.close();
  if (roomWatcher) await roomWatcher.close();
  logger.info('Change streams stopped');
}

// ─── Replica set support probe ────────────────────────────────────────────────
async function checkChangeStreamSupport() {
  let watcher = null;
  try {
    watcher = Message.watch([], { maxAwaitTimeMS: 300 });
    await new Promise((resolve, reject) => {
      watcher.once('error', reject);
      setTimeout(resolve, 400);
    });
    return true;
  } catch (err) {
    const isReplicaSetError =
      err?.message?.toLowerCase().includes('replica') ||
      err?.message?.includes('$changeStream') ||
      err?.code === 40573;
    if (!isReplicaSetError) {
      logger.error(`[ChangeStream] Unexpected probe error: ${err.message}`);
    }
    return false;
  } finally {
    try { if (watcher) await watcher.close(); } catch (_) {}
  }
}