import { TrackedItems } from '../entity-manager.class';

export default interface IFlusher {
	flush(tracked: TrackedItems<unknown>): Promise<unknown>;
}
