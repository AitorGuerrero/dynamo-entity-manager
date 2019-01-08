import {DynamoDB} from "aws-sdk";
import {EventEmitter} from "events";
import IPoweredDynamo from "powered-dynamo/powered-dynamo.interface";
import ErrorFlushingEntity from "./error.flushing.class";
import {EventType} from "./event-type.enum";
import {ITableConfig} from "./table-config.interface";

import DocumentClient = DynamoDB.DocumentClient;

const maxTransactWriteElems = 10;

enum Action {create, update, delete}

interface ITrackedITem<Entity> {
	action: Action;
	initialStatus?: unknown;
	entity: Entity;
	tableConfig: ITableConfig<Entity>;
	version?: number;
}

type TrackedItems<E> = Map<any, ITrackedITem<E>>;

/**
 * @TODO updating only modified attributes instead of all the item.
 */
export class DynamoEntityManager {

	private static buildConditionExpression(entity: any, tableConf: ITableConfig<unknown>) {
		const result: any = {
			ConditionExpression: "#keyHash<>:keyHash",
			ExpressionAttributeNames: {"#keyHash": tableConf.keySchema.hash},
			ExpressionAttributeValues: {":keyHash": entity[tableConf.keySchema.hash]},
		};
		if (tableConf.keySchema.range !== undefined) {
			result.ConditionExpression = result.ConditionExpression + " and #keyRange<>:keyRange";
			result.ExpressionAttributeNames["#keyRange"] = tableConf.keySchema.range;
			result.ExpressionAttributeValues[":keyRange"] = entity[tableConf.keySchema.range];
		}

		return result;
	}

	private static addVersionConditionExpression<I>(
		input: I & (DocumentClient.Put | DocumentClient.Delete),
		entity: any,
		tableConf: ITableConfig<unknown>,
	) {
		if (tableConf.versionKey !== undefined) {
			input.ConditionExpression = "#version=:version";
			input.ExpressionAttributeNames["#version"] = tableConf.versionKey;
			input.ExpressionAttributeValues[":version"] = entity[tableConf.versionKey];
		}

		return input;
	}

	private static getEntityKey<Entity>(entity: Entity, tableConfig: ITableConfig<unknown>) {
		const key: DocumentClient.Key = {};
		key[tableConfig.keySchema.hash] = (entity as any)[tableConfig.keySchema.hash];
		if (tableConfig.keySchema.range) {
			key[tableConfig.keySchema.range] = (entity as any)[tableConfig.keySchema.range];
		}

		return key;
	}

	private static createItem<E>(entity: E, tableConfig: ITableConfig<E>): DynamoDB.TransactWriteItem {
		const marshaledEntity = tableConfig.marshal(entity);
		return {
			Put: Object.assign(
				DynamoEntityManager.buildConditionExpression(marshaledEntity, tableConfig),
				{
					Item: marshaledEntity,
					TableName: tableConfig.tableName,
				},
			),
		};
	}

	private static deleteItem<E>(item: E, tableConfig: ITableConfig<E>): DynamoDB.TransactWriteItem {
		return {
			Delete: DynamoEntityManager.addVersionConditionExpression({
				Key: DynamoEntityManager.getEntityKey(item, tableConfig),
				TableName: tableConfig.tableName,
			}, item, tableConfig),
		};
	}

	/**
	 * Class event emitter.
	 * The emitted event types are defined in EventType.
	 */
	public readonly eventEmitter: EventEmitter;

	private readonly tableConfigs: {[tableName: string]: ITableConfig<unknown>} = {};
	private tracked: TrackedItems<unknown> = new Map();
	private flushing = false;

	/**
	 * @param {DocumentClient} dc
	 * @param {Array<ITableConfig<any>>} tableConfigs
	 * @param {module:events.internal.EventEmitter} eventEmitter
	 */
	constructor(
		private dc: IPoweredDynamo,
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
		this.guardFlushing();
		this.flushing = true;
		await this.processOperations(this.buildOperations());
		this.updateTrackedStatusAfterFlushing();
		this.flushing = false;
		this.eventEmitter.emit(EventType.flushed);
	}

	/**
	 * Tracks a existing entity in the DB. When flushing, it saves the diferences with the state in moment of tracking.
	 * @TODO If a entity does not exists with the key, it fails.
	 * @param {string} tableName
	 * @param {E} entity
	 */
	public track<E>(tableName: string, entity: E) {
		if (entity === undefined) {
			return;
		}
		if (this.tracked.has(entity)) {
			return;
		}
		this.tracked.set(entity, {
			action: Action.update,
			entity,
			initialStatus: JSON.stringify(entity),
			tableConfig: this.tableConfigs[tableName],
		});
	}

	/**
	 * Creates a entity in the DB. When flusing , it puts the entity in the DB.
	 * @TODO If a entity exists with the key, it fails.
	 * @param {string} tableName
	 * @param {E} entity
	 */
	public trackNew<E>(tableName: string, entity: E) {
		if (entity === undefined) {
			return;
		}
		if (this.tracked.has(entity)) {
			return;
		}
		this.tracked.set(entity, {
			action: Action.create,
			entity,
			tableConfig: this.tableConfigs[tableName],
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
		this.tracked = new Map();
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

	private buildOperations() {
		const operations: DocumentClient.TransactWriteItem[] = [];
		for (const entityConfig of this.tracked.values()) {
			operations.push(this.flushEntity(entityConfig, entityConfig.tableConfig));
		}

		return operations;
	}

	private async processOperations(operations: DocumentClient.TransactWriteItem[]) {
		for (let i = 0; i < operations.length; i += maxTransactWriteElems) {
			await this.processOperationsChunk(operations.slice(i, i + maxTransactWriteElems));
		}
	}

	private async processOperationsChunk(operationsChunk: DocumentClient.TransactWriteItem[]) {
		try {
			await this.asyncTransaction({
				TransactItems: operationsChunk,
			});
		} catch (err) {
			this.flushing = false;
			this.eventEmitter.emit(EventType.error, new ErrorFlushingEntity(err));

			throw err;
		}
	}

	private addTableConfig(config: ITableConfig<any>) {
		this.tableConfigs[config.tableName] = Object.assign({
			marshal: (entity: any) => JSON.parse(JSON.stringify(entity)) as DocumentClient.AttributeMap,
		}, config);
	}

	private flushEntity<E>(entityConfig: ITrackedITem<E>, tableConfig: ITableConfig<E>): DynamoDB.TransactWriteItem {
		switch (entityConfig.action) {
			case Action.update:
				return this.updateItem(entityConfig.entity, tableConfig);
			case Action.delete:
				return DynamoEntityManager.deleteItem(entityConfig.entity, tableConfig);
			case Action.create:
				return DynamoEntityManager.createItem(entityConfig.entity, tableConfig);
		}
	}

	private guardFlushing() {
		if (this.flushing) {
			throw new Error("Dynamo entity manager currently flushing");
		}
	}

	private asyncTransaction(request: DocumentClient.TransactWriteItemsInput) {
		return this.dc.transactWrite(request);
	}

	private updateItem<E>(entity: E, tableConfig: ITableConfig<E>): DocumentClient.TransactWriteItem {
		if (!this.entityHasChanged(entity)) {
			return;
		}

		return {
			Put: DynamoEntityManager.addVersionConditionExpression({
				Item: this.addVersionToUpdateItem(tableConfig.marshal(entity), entity, tableConfig),
				TableName: tableConfig.tableName,
			}, entity, tableConfig),
		};
	}

	private entityHasChanged<E>(entity: E) {
		return JSON.stringify(entity) !== this.tracked.get(entity).initialStatus;
	}

	private addVersionToUpdateItem<Entity>(item: any, entity: Entity, tableConfig: ITableConfig<unknown>) {
		if (tableConfig.versionKey !== undefined) {
			item[tableConfig.versionKey] = this.tracked.get(entity).version + 1;
		}

		return item;
	}
}
