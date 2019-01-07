import {DynamoDB} from "aws-sdk";
import {EventEmitter} from "events";
import {EventType} from "./event-type.enum";
import getEntityKey from "./get-entity-key";
import {ITableConfig} from "./table-config.interface";

import DocumentClient = DynamoDB.DocumentClient;

type TrackedTable = Map<any, {
	action: "CREATE" | "UPDATE" | "DELETE",
	initialStatus?: any,
	entity: any,
	entityName: string,
}>;

/**
 * @TODO updating only modified attributes instead of all the item.
 * @TODO entity versioning
 */
export class DynamoEntityManager {

	/**
	 * Class event emitter.
	 * The emitted event types are defined in EventType.
	 */
	public readonly eventEmitter: EventEmitter;

	private readonly tableConfigs: {[entityName: string]: ITableConfig<any>};
	private tracked: TrackedTable;

	/**
	 * @param {DocumentClient} dc
	 * @param {Array<ITableConfig<any>>} tableConfigs
	 * @param {module:events.internal.EventEmitter} eventEmitter
	 */
	constructor(
		private dc: DocumentClient,
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
		const processed: Array<Promise<any>> = [];
		for (const entityConfig of this.tracked.values()) {
			switch (entityConfig.action) {
				case "UPDATE":
					processed.push(this.updateItem(entityConfig.entityName, entityConfig.entity));
					break;
				case "DELETE":
					processed.push(this.deleteItem(entityConfig.entityName, entityConfig.entity));
					break;
				case "CREATE":
					processed.push(this.createItem(entityConfig.entityName, entityConfig.entity));
					break;
			}
		}
		try {
			await Promise.all(processed);
		} catch (err) {
			this.eventEmitter.emit(EventType.errorFlushing);

			throw err;
		}
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
		this.tracked.set(entity, {action: "UPDATE", initialStatus: JSON.stringify(entity), entity, entityName: tableName});
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
		this.tracked.set(entity, {action: "CREATE", entity, entityName: tableName});
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
			&& this.tracked.get(entity).action === "CREATE"
		) {
			this.tracked.delete(entity);
		} else {
			this.tracked.set(entity, {action: "DELETE", entity, entityName: tableName});
		}
	}

	/**
	 * Clears all the tracked entities, without flushing them.
	 */
	public clear() {
		this.tracked = new Map();
	}

	private addTableConfig(config: ITableConfig<any>) {
		this.tableConfigs[config.tableName] = Object.assign({
			marshal: (entity: any) => JSON.parse(JSON.stringify(entity)) as DocumentClient.AttributeMap,
		}, config);
	}

	private async createItem<E>(entityName: string, entity: E) {
		try {
			await this.asyncPut({
				Item: this.tableConfigs[entityName].marshal(entity),
				TableName: this.tableConfigs[entityName].tableName,
			});
		} catch (err) {
			this.eventEmitter.emit(EventType.errorCreating, err, entity);

			throw err;
		}
	}

	private async updateItem<E>(entityName: string, entity: E) {
		if (!this.entityHasChanged(entity)) {
			return;
		}
		const tableConfig = this.tableConfigs[entityName];
		try {
			await this.asyncPut({
				Item: tableConfig.marshal(entity),
				TableName: tableConfig.tableName,
			});
		} catch (err) {
			this.eventEmitter.emit(EventType.errorUpdating, err, entity);

			throw err;
		}
	}

	private async deleteItem<E>(entityName: string, item: E) {
		const tableConfig = this.tableConfigs[entityName];
		try {
			return this.asyncDelete({
				Key: getEntityKey(tableConfig.keySchema, tableConfig.marshal(item)),
				TableName: tableConfig.tableName,
			});
		} catch (err) {
			this.eventEmitter.emit(EventType.errorDeleting, err, item);

			throw err;
		}
	}

	private entityHasChanged<E>(entity: E) {
		return JSON.stringify(entity) !== this.tracked.get(entity).initialStatus;
	}

	private asyncPut(request: DocumentClient.PutItemInput) {
		return new Promise<DocumentClient.PutItemOutput>(
			(rs, rj) => this.dc.put(request, (err, res) => err ? rj(err) : rs(res)),
		);
	}

	private asyncDelete(request: DocumentClient.DeleteItemInput) {
		return new Promise<DocumentClient.DeleteItemOutput>(
			(rs, rj) => this.dc.delete(request, (err) => err ? rj(err) : rs()),
		);
	}
}
