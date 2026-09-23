import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

/** Invoke only in the isolated analyzer process, before loading the analyzer. */
export function disableNetwork(): void {
  const offline = (): never => {
    throw new Error("Network access is disabled during Kaev analysis.");
  };
  net.Socket.prototype.connect = offline;
  tls.connect = offline;
  http.request = offline;
  http.get = offline;
  https.request = offline;
  https.get = offline;
  dns.lookup = Object.assign(offline, { __promisify__: offline });
  dns.resolve = Object.assign(offline, { __promisify__: offline });
  dns.promises.lookup = offline;
  dns.promises.resolve = offline;
  dgram.createSocket = offline;
  globalThis.fetch = offline;
  syncBuiltinESMExports();
}
