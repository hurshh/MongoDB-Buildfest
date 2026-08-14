// Boots an in-memory MongoDB on a fixed port for local, Atlas-free demos.
// Data lives only for the life of this process. Keep it running in a terminal.
// Usage: node scripts/local-mongo.mjs   (port defaults to 27017)
import { MongoMemoryServer } from "mongodb-memory-server";

const port = Number(process.env.LOCAL_MONGO_PORT || 27017);

const server = await MongoMemoryServer.create({
  instance: { port, dbName: "convtree" },
});

const uri = server.getUri();
console.log("─".repeat(60));
console.log("Local MongoDB is UP (in-memory).");
console.log("URI:", uri);
console.log("Put this in .env.local:");
console.log(`  MONGODB_URI="mongodb://127.0.0.1:${port}/"`);
console.log(`  MONGODB_DB="convtree"`);
console.log("Leave this process running. Ctrl-C to stop.");
console.log("─".repeat(60));

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// keep alive
setInterval(() => {}, 1 << 30);
