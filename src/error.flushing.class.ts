export default class ErrorFlushingEntity extends Error {
	constructor(
		public readonly originalError: Error,
	) {
		super("An error has happen when flushing");
	}
}
