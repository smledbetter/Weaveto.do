import { error } from '@sveltejs/kit';
import { isValidRoomId } from '$lib/room/names';
import type { PageLoad } from './$types';

/**
 * Reject malformed room IDs at the route boundary.
 *
 * Without this the raw param reaches getRoomName() inside the component, which
 * throws during SSR and returns a 500. A mistyped or truncated share link is an
 * ordinary "this room does not exist", not a server error.
 *
 * The relay rejects the same shapes on WebSocket upgrade, so anything that
 * fails here could never have connected anyway.
 */
export const load: PageLoad = ({ params }) => {
	if (!isValidRoomId(params.id)) {
		error(404, 'That room link is not valid. Check the link and try again.');
	}

	return { roomId: params.id };
};
