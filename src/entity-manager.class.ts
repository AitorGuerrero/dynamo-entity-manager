import {DynamoDB} from "aws-sdk";
import {EventEmitter} from "events";
import IFlusher from "./flushers/flusher.interface";
import {ITableConfig} from "./table-config.interface";
import CreatedTrackedItem from "./tracked-items/created.class";
import DeletedTrackedItem from "./tracked-items/deleted.class";
import TrackedItem from "./tracked-items/tracked-item.class";
import UpdatedTrackedItem from "./tracked-items/updated.class";

import DocumentClient = DynamoDB.DocumentClient;

export type TrackedItems<E> = Map<E, TrackedItem<E>>;

export enum EventType {
	flushed = "flushed",
	error = "error",
}

/**
 * @TODO updating only modified attributes instead of all the item.
 */
export default class DynamoEntityManager {

	private static isSameKey(k1: DocumentClient.Key, k2: DocumentClient.Key, config: ITableConfig<unknown>) {
		return k1[config.keySchema.hash] === k2[config.keySchema.hash] &&
			(config.keySchema.range === undefined || k1[config.keySchema.range] === k2[config.keySchema.range]);
	}

	/**
	 * Class event emitter.
	 * The emitted event types are defined in EventType.
	 */
	public readonly eventEmitter: EventEmitter;

	protected tracked: TrackedItems<unknown> = new Map();
	protected flushing: false | Promise<void> = false;
	private readonly tableConfigs: {[tableName: string]: ITableConfig<unknown>} = {};

	/**
	 * @param {Array<ITableConfig<any>>} tableConfigs
	 * @param flusher
	 * @param {module:events.internal.EventEmitter} eventEmitter
	 */
	constructor(
		private flusher: IFlusher,
		tableConfigs: ITableConfig<any>[],
		eventEmitter?: EventEmitter,
	) {
		this.tracked = new Map();
		this.tableConfigs = {};
		this.eventEmitter = eventEmitter || new EventEmitter();
		for (const tableConfig of tableConfigs) {
			this.addTableConfig(tableConfig);
		}
	}

	/**
	 * Flushes all the changes made to loaded entities.
	 * @returns {Promise<void>}
	 */
	public async flush() {
		if (this.flushing === false) {
			this.flushing = new Promise(async (rs, rj) => {
				try {
					await this.flusher.flush(this.tracked);
					this.updateTrackedStatusAfterFlushing();
					this.flushing = false;
					this.eventEmitter.emit(EventType.flushed);

					rs();
				} catch (err) {
					this.flushing = false;
					this.eventEmitter.emit("error", err);

					rj(err);
				}
			});
		}

		return this.flushing;
	}

	/**
	 * Tracks a existing entity in the DB. When flushing, it saves the diferences with the state in moment of tracking.
	 * @param {string} tableName
	 * @param {E} entity
	 * @param version
	 */
	public track<E>(tableName: string, entity: E, version?: number) {
		if (entity === undefined) {
			return;
		}
		const tableConfig = this.tableConfigs[tableName];
		this.addTrackedItem(new UpdatedTrackedItem(
			entity,
			tableConfig,
			tableConfig.versionKey ? version || 0 : undefined,
		));
	}

	/**
	 * Creates a entity in the DB. When flusing , it puts the entity in the DB.
	 * @param {string} tableName
	 * @param {E} entity
	 */
	public trackNew<E>(tableName: string, entity: E) {
		if (entity === undefined) {
			return;
		}
		const tableConfig = this.tableConfigs[tableName];
		this.addTrackedItem(new CreatedTrackedItem(entity, tableConfig));
	}

	/**
	 * When flushing, deletes the entity.
	 * @param {string} tableName
	 * @param {E} entity
	 */
	public delete<E>(tableName: string, entity: E) {
		if (entity === undefined) {
			return;
		}
		if (
			this.tracked.has(entity)
			&& this.tracked.get(entity) instanceof CreatedTrackedItem
		) {
			this.tracked.delete(entity);
		} else {
			this.tracked.set(entity, new DeletedTrackedItem(
				entity,
				this.tableConfigs[tableName],
			));
		}
	}

	/**
	 * Clears all the tracked entities, without flushing them.
	 */
	public clear() {
		this.tracked.clear();
	}

	public keyIsTracked(tableName: string, key: DocumentClient.Key) {
		return Array.from(this.tracked.values())
			.filter((i) => i.tableConfig.tableName === tableName)
			.map((i) => i.getEntityKey())
			.some((i) => DynamoEntityManager.isSameKey(i, key, this.tableConfigs[tableName]));
	}

	private updateTrackedStatusAfterFlushing() {
		this.tracked.forEach((value: TrackedItem<unknown>, key) => {
			if (value instanceof CreatedTrackedItem) {
				this.tracked.set(value.entity, value.toUpdate());
			} else if (value instanceof UpdatedTrackedItem) {
				value.setState();
			} else if (value instanceof DeletedTrackedItem) {
				this.tracked.delete(key);
			}
		});
	}

	private addTableConfig(config: ITableConfig<any>) {
		this.tableConfigs[config.tableName] = Object.assign({
			marshal: (entity: any) => JSON.parse(JSON.stringify(entity)) as DocumentClient.AttributeMap,
		}, config);
	}

	private addTrackedItem(trackedItem: TrackedItem<unknown>) {
		if (this.tracked.has(trackedItem.entity)) {
			return;
		}
		if (this.keyIsTracked(trackedItem.tableConfig.tableName, trackedItem.getEntityKey())) {
			throw new Error("Key is in use");
		}
		this.tracked.set(trackedItem.entity, trackedItem);
	}
}
