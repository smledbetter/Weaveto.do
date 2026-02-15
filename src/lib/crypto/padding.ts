/**
 * Message padding for metadata minimization.
 * Pads plaintext to fixed block sizes before encryption so ciphertext length
 * does not reveal plaintext length. Uses PKCS#7-style padding with a block
 * size tuned for chat messages.
 */

const BLOCK_SIZE = 256; // Pad to 256-byte blocks

/**
 * Pad a plaintext string to a multiple of BLOCK_SIZE bytes.
 * The last byte of padding stores the number of padding bytes added,
 * so the receiver can strip padding deterministically.
 */
export function padMessage(plaintext: string): string {
	const encoded = new TextEncoder().encode(plaintext);
	const paddedLength = Math.ceil((encoded.length + 1) / BLOCK_SIZE) * BLOCK_SIZE;
	const paddingLength = paddedLength - encoded.length;

	const padded = new Uint8Array(paddedLength);
	padded.set(encoded);
	// Fill padding bytes with the padding length value (PKCS#7 style)
	padded.fill(paddingLength, encoded.length);

	// Encode as base64 for safe JSON transport
	return btoa(String.fromCharCode(...padded));
}

/**
 * Remove padding from a padded message.
 */
export function unpadMessage(padded: string): string {
	const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));

	if (bytes.length === 0) return '';

	const paddingLength = bytes[bytes.length - 1];
	if (paddingLength === 0 || paddingLength > BLOCK_SIZE || paddingLength > bytes.length) {
		throw new Error('Invalid padding');
	}

	// Verify all padding bytes match (constant-time would be ideal, but
	// this is applied to already-decrypted plaintext so timing is not critical)
	for (let i = bytes.length - paddingLength; i < bytes.length; i++) {
		if (bytes[i] !== paddingLength) {
			throw new Error('Invalid padding');
		}
	}

	const unpadded = bytes.slice(0, bytes.length - paddingLength);
	return new TextDecoder().decode(unpadded);
}
