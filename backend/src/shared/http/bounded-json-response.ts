export async function readBoundedJsonResponse(
  response: Response,
  label: string,
  maxBytes: number,
): Promise<unknown> {
  assertByteLimit(maxBytes);
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength)) {
      await cancelResponseBody(response);
      throw new Error(`${label} has an invalid content-length`);
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      await cancelResponseBody(response);
      throw new Error(`${label} exceeds ${maxBytes} bytes`);
    }
  }

  if (!response.body) {
    return parseBoundedJson(await response.text(), label, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const textChunks: string[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds ${maxBytes} bytes`);
      }
      textChunks.push(decoder.decode(value, { stream: true }));
    }
    textChunks.push(decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof Error) throw error;
    throw new Error(`${label} could not be read`);
  } finally {
    reader.releaseLock();
  }

  return parseBoundedJson(textChunks.join(""), label, maxBytes);
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function parseBoundedJson(raw: string, label: string, maxBytes: number): unknown {
  if (raw.length > maxBytes || new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function assertByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Byte limit must be a positive safe integer");
  }
}
