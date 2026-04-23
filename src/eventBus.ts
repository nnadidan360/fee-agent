import { EventEmitter } from 'events';

// Singleton EventBus for in-process communication between modules.
// Channels:
//   'fee:event'    — FeeEvent emitted by RestreamListener
//   'action:result' — ActionResult emitted by ActionExecutor
const eventBus = new EventEmitter();

// Increase max listeners to avoid warnings when many modules subscribe.
eventBus.setMaxListeners(50);

export default eventBus;
