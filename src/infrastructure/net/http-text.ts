/** One GET answering the body as text. Throws when the answer is not 2xx or runs past `maxBytes`. */
export type TextGet = (url: string, signal: AbortSignal) => Promise<string>;

/**
 * Plain GET with a hard ceiling on the answer: the published address lists are megabytes, and a
 * list that suddenly grows must not take the pod's memory with it. The body is read in chunks and
 * the read is dropped as soon as it goes over.
 */
export function httpText(maxBytes: number, userAgent = "portfolio-ip-intel"): TextGet {
  return async (url, signal) => {
    const res = await fetch(url, {
      signal,
      headers: { accept: "text/plain, application/json", "user-agent": userAgent },
    });
    if (!res.ok) throw new Error(`GET ${new URL(url).host}: ${res.status}`);
    const length = Number(res.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`resposta acima de ${maxBytes} bytes`);
    const reader = res.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`resposta acima de ${maxBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  };
}
