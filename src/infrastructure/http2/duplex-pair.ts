import { Duplex } from "node:stream";

/**
 * Two connected in-memory streams: what is written to one is read from the other. Node 20 has no
 * stream.duplexPair, and an in-process hop needs no socket. Ending or destroying one side ends the other.
 */
export function duplexPair(): [Duplex, Duplex] {
  const side = (other: () => Duplex) =>
    new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        other().push(chunk);
        callback();
      },
      final(callback) {
        other().push(null);
        callback();
      },
      destroy(err, callback) {
        other().destroy();
        callback(err);
      },
    });
  const a: Duplex = side(() => b);
  const b: Duplex = side(() => a);
  return [a, b];
}
