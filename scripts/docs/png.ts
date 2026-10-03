import { crc32 } from "node:zlib";

const KEYWORD = "pi-harness:scene";
const SIGNATURE = 8;
const encoder = new TextEncoder();
const decoder = new TextDecoder("latin1");

interface Chunk {
	type: string;
	data: Uint8Array;
	start: number;
}

function* chunks(png: Uint8Array): Generator<Chunk> {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let offset = SIGNATURE;
	while (offset + 8 <= png.length) {
		const length = view.getUint32(offset);
		const type = decoder.decode(png.subarray(offset + 4, offset + 8));
		yield { type, data: png.subarray(offset + 8, offset + 8 + length), start: offset };
		offset += 12 + length;
	}
}

export function readKey(png: Uint8Array): string | undefined {
	const prefix = `${KEYWORD}\0`;
	for (const chunk of chunks(png)) {
		if (chunk.type !== "tEXt") continue;
		const text = decoder.decode(chunk.data);
		if (text.startsWith(prefix)) return text.slice(prefix.length);
	}
	return undefined;
}

export function withKey(png: Uint8Array, key: string): Uint8Array {
	const end = [...chunks(png)].find((chunk) => chunk.type === "IEND");
	if (end === undefined) throw new Error("not a PNG: no IEND chunk");

	const body = encoder.encode(`tEXt${KEYWORD}\0${key}`);
	const chunk = new Uint8Array(body.length + 8);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, body.length - 4);
	chunk.set(body, 4);
	view.setUint32(chunk.length - 4, crc32(body));

	const out = new Uint8Array(png.length + chunk.length);
	out.set(png.subarray(0, end.start));
	out.set(chunk, end.start);
	out.set(png.subarray(end.start), end.start + chunk.length);
	return out;
}
