/**
 * Finding the printer on the network, read-only. Bambu printers announce themselves now and then with an SSDP
 * NOTIFY (UDP broadcast to port 2021, and multicast to 239.255.255.250:1990) that names the address, the serial
 * number and the model. The bridge only listens; it never sends a search. Whether the X2D announces itself the
 * same way is [uncertain]. The serial number is also read from the certificate the printer's MQTT service presents
 * (its common name, on the models we know of), which needs the address first [uncertain].
 */
import dgram from "node:dgram";
import tls from "node:tls";

export interface FoundPrinter {
  host: string;
  serial: string;
  model: string | null;
  name: string | null;
}

/** One SSDP message: the printer's fields, or null when it isn't a Bambu printer's. */
export function parseSsdp(text: string, from?: string): FoundPrinter | null {
  const headers = new Map<string, string>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  const serial = headers.get("usn");
  const host = headers.get("location") ?? from;
  if (!serial || !host || !headers.has("devmodel.bambu.com") || !/^[0-9A-Za-z]{8,20}$/.test(serial)) return null;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return {
    host,
    serial,
    model: headers.get("devmodel.bambu.com") ?? null,
    name: headers.get("devname.bambu.com") ?? null,
  };
}

/** Listens for printers' announcements for a while; resolves with each printer once. Never rejects. */
export function discoverPrinters(timeoutMs = 8_000, wanted?: string): Promise<FoundPrinter[]> {
  return new Promise((resolve) => {
    const found = new Map<string, FoundPrinter>();
    const sockets: dgram.Socket[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          // already closed
        }
      }
      resolve([...found.values()]);
    };
    const listen = (port: number, multicast: boolean) => {
      try {
        const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
        sockets.push(socket);
        socket.on("error", () => {});
        socket.on("message", (message, remote) => {
          const printer = parseSsdp(message.toString("utf8"), remote.address);
          if (!printer) return;
          found.set(printer.serial, printer);
          if (wanted && printer.serial === wanted) finish();
        });
        socket.bind(port, () => {
          if (!multicast) return;
          try {
            socket.addMembership("239.255.255.250");
          } catch {
            // no multicast on this interface: the broadcast port may still hear it
          }
        });
      } catch {
        // can't listen on this port (in use, not allowed): the other one may work
      }
    };
    listen(2021, false);
    listen(1990, true);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/** The common name of the certificate on the printer's MQTT port, which is its serial number on the models we know of. */
export function serialFromCertificate(host: string, port = 8883, timeoutMs = 6_000): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const name = socket.getPeerCertificate().subject?.CN;
      socket.destroy();
      const cn = Array.isArray(name) ? name[0] : name;
      resolve(cn && /^[0-9A-Za-z]{8,20}$/.test(cn) ? cn : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}
