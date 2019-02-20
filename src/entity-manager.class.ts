import {DynamoDB} from "aws-sdk";
import {EventEmitter} from "events";
import IPoweredDynamo from "powered-dynamo/powered-dynamo.interface";
import {EventType} from "./event-type.enum";
import {ITableConfig} from "./table-config.interface";

import DocumentClient = DynamoDB.DocumentClient;

export enum Action {create, update, delete}

export interface ITrackedITem<Entity> {
	action: Action;
	initialStatus?: unknown;
	entity: Entity;
	tableConfig: ITableConfig<Entity>;
	version?: number;
}

export type TrackedItems<E> = Map<any, ITrackedITem<E>>;

/**
 * @TODO updating only modified attributes instead of all the item.
 */
export class DynamoEntityManager {

	protected static entityHasChanged<Entity>(entity: ITrackedITem<Entity>) {
		return JSON.stringify(entity.entity) !== entity.initialStatus;
	}

	protected static addVersionToUpdateItem<Entity>(
		item: any,
		trackedItem: ITrackedITem<Entity>,
		tableConfig: ITableConfig<unknown>,
	) {
		if (tableConfig.versionKey !== undefined) {
			item[tableConfig.versionKey] = trackedItem.version + 1;
		}

		return item;
	}

	protected static getEntityKey<Entity>(entity: Entity, tableConfig: ITableConfig<unknown>) {
		const key: DocumentClient.Key = {};
		key[tableConfig.keySchema.hash] = (entity as any)[tableConfig.keySchema.hash];
		if (tableConfig.keySchema.range) {
			key[tableConfig.keySchema.range] = (entity as any)[tableConfig.keySchema.range];
		}

		return key;
	}

	protected static addVersionToCreateItem<Entity>(item: any, tableConfig: ITableConfig<unknown>) {
		if (tableConfig.versionKey !== undefined) {
			item[tableConfig.versionKey] = 0;
		}

		return item;
	}

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
	 * @param {DocumentClient} dc
	 * @param {Array<ITableConfig<any>>} tableConfigs
	 * @param {module:events.internal.EventEmitter} eventEmitter
	 */
	constructor(
		protected dc: IPoweredDynamo,
		tableConfigs: Array<ITableConfig<any>>,
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
					await this.flushTracked();
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
	 * @TODO If a entity does not exists with the key, it fails.
	 * @param {string} tableName
	 * @param {E} entity
	 * @param version
	 */
	public track<E>(tableName: string, entity: E, version?: number) {
		const tableConfig = this.tableConfigs[tableName];
		if (entity === undefined) {
			return;
		}
		if (this.tracked.has(entity)) {
			return;
		}
		if (this.keyIsTracked(tableName, DynamoEntityManager.getEntityKey(entity, this.tableConfigs[tableName]))) {
			throw new Error("Key is in use");
		}
		this.tracked.set(entity, {
			action: Action.update,
			entity,
			initialStatus: JSON.stringify(entity),
			tableConfig,
			version: tableConfig.versionKey ? version || 0 : undefined,
		});
	}

	/**
	 * Creates a entity in the DB. When flusing , it puts the entity in the DB.
	 * @TODO If a entity exists with the key, it fails.
	 * @param {string} tableName
	 * @param {E} entity
	 */
	public trackNew<E>(tableName: string, entity: E) {
		const tableConfig = this.tableConfigs[tableName];
		if (entity === undefined) {
			return;
		}
		if (this.tracked.has(entity)) {
			return;
		}
		if (this.keyIsTracked(tableName, DynamoEntityManager.getEntityKey(entity, this.tableConfigs[tableName]))) {
			throw new Error("Key is in use");
		}
		this.tracked.set(entity, {
			action: Action.create,
			entity,
			tableConfig,
			version: tableConfig.versionKey ? 0 : undefined,
		});
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
			&& this.tracked.get(entity).action === Action.create
		) {
			this.tracked.delete(entity);
		} else {
			this.tracked.set(entity, {
				action: Action.delete,
				entity,
				tableConfig: this.tableConfigs[tableName],
			});
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
			.map((i) => DynamoEntityManager.getEntityKey(i.entity, this.tableConfigs[tableName]))
			.some((i) => DynamoEntityManager.isSameKey(i, key, this.tableConfigs[tableName]));
	}

	protected async flushTracked() {
		const processes: Array<Promise<any>> = [];
		for (const entityConfig of this.tracked.values()) {
			switch (entityConfig.action) {
				case Action.create:
					processes.push(this.createItemAsPut(entityConfig));

					break;
				case Action.update:
					processes.push(this.updateItemAsPut(entityConfig));

					break;
				case Action.delete:
					this.eventEmitter.emit(EventType.error, new Error("Delete entity not implemented"));

					break;
			}
		}

		await Promise.all(processes);
	}

	protected addVersionConditionExpression<I>(
		input: I & (DocumentClient.Put | DocumentClient.Delete),
		entity: any,
		tableConf: ITableConfig<unknown>,
	) {
		if (tableConf.versionKey !== undefined && this.tracked.get(entity).version > 0) {
			input.ConditionExpression = "#version=:version";
			input.ExpressionAttributeNames = Object.assign(
				{},
				input.ExpressionAttributeNames,
				{"#version": tableConf.versionKey},
			);
			input.ExpressionAttributeValues = Object.assign(
				{},
				input.ExpressionAttributeValues,
				{":version": this.tracked.get(entity).version},
			);
		}

		return input;
	}

	private async createItemAsPut<E>(trackedEntity: ITrackedITem<E>): Promise<unknown> {
		if (!DynamoEntityManager.entityHasChanged(trackedEntity)) {
			return;
		}

		await this.dc.put({
			Item: DynamoEntityManager.addVersionToCreateItem(
				trackedEntity.tableConfig.marshal(trackedEntity.entity),
				trackedEntity.tableConfig,
			),
			TableName: trackedEntity.tableConfig.tableName,
		});
	}

	private async updateItemAsPut<E>(trackedEntity: ITrackedITem<E>): Promise<unknown> {
		const tableConfig = trackedEntity.tableConfig;
		if (!DynamoEntityManager.entityHasChanged(trackedEntity)) {
			return;
		}

		await this.dc.put(this.addVersionConditionExpression({
			Item: DynamoEntityManager.addVersionToUpdateItem(
				tableConfig.marshal(trackedEntity.entity),
				trackedEntity,
				tableConfig,
			),
			TableName: trackedEntity.tableConfig.tableName,
		}, trackedEntity.entity, trackedEntity.tableConfig));
	}

	private updateTrackedStatusAfterFlushing() {
		this.tracked.forEach((value, key) => {
			switch (value.action) {
				case Action.create:
					value.action = Action.update;
					value.initialStatus = JSON.stringify(value.entity);
					break;
				case Action.update:
					value.initialStatus = JSON.stringify(value.entity);
					break;
				case Action.delete:
					this.tracked.delete(key);
					break;
			}
		});
	}

	private addTableConfig(config: ITableConfig<any>) {
		this.tableConfigs[config.tableName] = Object.assign({
			marshal: (entity: any) => JSON.parse(JSON.stringify(entity)) as DocumentClient.AttributeMap,
		}, config);
	}

	private guardFlushing() {
		if (this.flushing) {
			throw new Error("Dynamo entity manager currently flushing");
		}
	}
}
