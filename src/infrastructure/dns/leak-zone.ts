import type { LeakProbes } from "../../domain/dns-leak.js";
import { type Answer, CLASS_IN, type Query, RCODE, rdata, type ResourceRecord, TYPE, typeName } from "./message.js";

export interface LeakZoneOptions {
  zone: string; // e.g. "leak.example.com", delegated to this server by an NS record in the parent zone
  nameserver: string; // the NS name the parent delegates to, e.g. "ns.leak.example.com"
  nameserverAddress?: string | null; // its IPv4, answered when a resolver asks for the NS name itself
  answerV4?: string | null; // what probe names resolve to; without one they answer NODATA, which is enough
  answerV6?: string | null;
}

const TOKEN = /^[0-9a-f]{16}$/i;
const TTL = 60;
const lower = (labels: string[]) => labels.map((l) => l.toLowerCase());

/**
 * Answers for one zone: SOA and NS at the apex, the probe names one label below it, NXDOMAIN for
 * the rest and REFUSED outside it. Every query for an issued probe is recorded with who sent it.
 */
export class LeakZone {
  private readonly zone: string[];
  private readonly ns: string[];
  private readonly soa: ResourceRecord;

  constructor(
    private readonly probes: LeakProbes,
    private readonly options: LeakZoneOptions,
  ) {
    this.zone = lower(options.zone.split("."));
    this.ns = lower(options.nameserver.split("."));
    // The SOA minimum is the negative TTL (RFC 2308): kept short, a probe name is never asked twice anyway.
    this.soa = {
      labels: this.zone,
      type: TYPE.SOA,
      ttl: TTL,
      data: rdata.soa(this.ns, ["hostmaster", ...this.zone], 1, TTL),
    };
  }

  answer(query: Query, from: string): Answer {
    if (query.opcode !== 0) return { rcode: RCODE.NOTIMP, authoritative: false };
    const { labels, type, class: cls } = query.question;
    const name = lower(labels);
    if (cls !== CLASS_IN || !this.inZone(name)) return { rcode: RCODE.REFUSED, authoritative: false };
    const below = name.slice(0, name.length - this.zone.length);

    if (below.length === 0) return this.apex(labels, type);
    if (this.isNameserver(name)) {
      const address = this.options.nameserverAddress;
      if (type === TYPE.A && address) return this.records(labels, TYPE.A, rdata.a(address));
      return this.noData();
    }
    if (below.length === 1 && TOKEN.test(below[0])) {
      const issued = this.probes.record(below[0], {
        address: from,
        qtype: typeName(type),
        clientSubnet: query.edns?.clientSubnet ?? null,
      });
      if (!issued) return this.nxDomain();
      const { answerV4, answerV6 } = this.options;
      if (type === TYPE.A && answerV4) return this.records(labels, TYPE.A, rdata.a(answerV4));
      if (type === TYPE.AAAA && answerV6) return this.records(labels, TYPE.AAAA, rdata.aaaa(answerV6));
      return this.noData();
    }
    return this.nxDomain();
  }

  private apex(labels: string[], type: number): Answer {
    if (type === TYPE.SOA) return { rcode: RCODE.NOERROR, authoritative: true, answers: [this.soa] };
    if (type === TYPE.NS) return this.records(labels, TYPE.NS, rdata.ns(this.ns));
    return this.noData();
  }

  private records(labels: string[], type: number, data: Buffer): Answer {
    return { rcode: RCODE.NOERROR, authoritative: true, answers: [{ labels, type, ttl: TTL, data }] };
  }

  private noData(): Answer {
    return { rcode: RCODE.NOERROR, authoritative: true, authority: [this.soa] };
  }

  private nxDomain(): Answer {
    return { rcode: RCODE.NXDOMAIN, authoritative: true, authority: [this.soa] };
  }

  private inZone(name: string[]) {
    if (name.length < this.zone.length) return false;
    return this.zone.every((label, i) => name[name.length - this.zone.length + i] === label);
  }

  private isNameserver(name: string[]) {
    return name.length === this.ns.length && name.every((label, i) => label === this.ns[i]);
  }
}
