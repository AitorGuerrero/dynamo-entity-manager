import { DynamoDB } from 'aws-sdk';
import { TrackedItems } from '../entity-manager.class';
import { ITableConfig } from '../table-config.interface';
import CreatedTrackedItem from '../tracked-items/created.class';
import DeletedTrackedItem from '../tracked-items/deleted.class';
import TrackedItem from '../tracked-items/tracked-item.class';
import UpdatedTrackedItem from '../tracked-items/updated.class';
import addVersionConditionExpression from './add-version-condition-expression.function';
import addVersionToCreateItem from './add-version-to-create-item.function';
import addVersionToUpdateItem from './add-version-to-update-item.function';
import TransactionItemsLimitReached from './error.transaction-items-limit-reached.class';
import IFlusher from './flusher.interface';

import DocumentClient = DynamoDB.DocumentClient;

const maxTransactWriteElems = 25;

export default class TransactionalFlusher implements IFlusher {
	private static flushEntity<E>(trackedItem: TrackedItem<E>): DynamoDB.TransactWriteItem {
		if (trackedItem instanceof UpdatedTrackedItem) {
			return TransactionalFlusher.updateItemTransactional(trackedItem);
		}
		if (trackedItem instanceof DeletedTrackedItem) {
			return TransactionalFlusher.deleteItemTransactional(trackedItem);
		}
		if (trackedItem instanceof CreatedTrackedItem) {
			return TransactionalFlusher.createItemTransactional(trackedItem);
		}
	}

	private static createItemTransactional<E>(
		trackedEntity: CreatedTrackedItem<E>,
	): DynamoDB.TransactWriteItem {
		const marshaledEntity = trackedEntity.tableConfig.marshal(trackedEntity.entity);
		return {
			Put: Object.assign(
				TransactionalFlusher.buildConditionExpression(marshaledEntity, trackedEntity.tableConfig),
				{
					Item: addVersionToCreateItem(marshaledEntity, trackedEntity.tableConfig),
					TableName: trackedEntity.tableConfig.tableName,
				},
			),
		};
	}

	private static buildConditionExpression(entity: any, tableConf: ITableConfig<unknown>) {
		const result: any = {
			ConditionExpression: '#keyHash<>:keyHash',
			ExpressionAttributeNames: { '#keyHash': tableConf.keySchema.hash },
			ExpressionAttributeValues: { ':keyHash': entity[tableConf.keySchema.hash] },
		};
		if (tableConf.keySchema.range !== undefined) {
			result.ConditionExpression = result.ConditionExpression + ' and #keyRange<>:keyRange';
			result.ExpressionAttributeNames['#keyRange'] = tableConf.keySchema.range;
			result.ExpressionAttributeValues[':keyRange'] = entity[tableConf.keySchema.range];
		}

		return result;
	}

	private static updateItemTransactional<Entity>(
		trackedEntity: UpdatedTrackedItem<Entity>,
	): DocumentClient.TransactWriteItem {
		const tableConfig = trackedEntity.tableConfig;
		if (!trackedEntity.hasChanged) {
			return;
		}

		return {
			Put: addVersionConditionExpression(trackedEntity, {
				Item: addVersionToUpdateItem(tableConfig.marshal(trackedEntity.entity), trackedEntity),
				TableName: tableConfig.tableName,
			}) as DocumentClient.Put,
		};
	}

	private static deleteItemTransactional<E>(
		trackedEntity: DeletedTrackedItem<E>,
	): DynamoDB.TransactWriteItem {
		return {
			Delete: addVersionConditionExpression(trackedEntity, {
				Key: trackedEntity.getEntityKey(),
				TableName: trackedEntity.tableConfig.tableName,
			}) as DocumentClient.Delete,
		};
	}

	private flushing: false | Promise<void> = false;

	/**
	 * @param dc
	 * @param options
	 */
	constructor(
		private dc: DynamoDB.DocumentClient,
		private options: {
			onItemsLimitFallbackFlusher?: IFlusher;
		} = {},
	) {}

	/**
	 * Flushes all the changes made to loaded entities.
	 * @returns {Promise<void>}
	 */
	public async flush(tracked: TrackedItems<unknown>) {
		try {
			await this.processOperations(this.buildOperations(tracked));
		} catch (err) {
			if (err instanceof TransactionItemsLimitReached && this.options.onItemsLimitFallbackFlusher) {
				await this.options.onItemsLimitFallbackFlusher.flush(tracked);
			} else {
				throw err;
			}
		}
	}

	private buildOperations(tracked: TrackedItems<unknown>) {
		const operations: DocumentClient.TransactWriteItem[] = [];
		for (const entityConfig of tracked.values()) {
			operations.push(TransactionalFlusher.flushEntity(entityConfig));
		}

		return operations.filter((i) => i !== undefined);
	}

	private async processOperations(operations: DocumentClient.TransactWriteItem[]) {
		if (operations.length > maxTransactWriteElems) {
			throw new TransactionItemsLimitReached(operations.length);
		}
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

			throw err;
		}
	}

	private asyncTransaction(request: DocumentClient.TransactWriteItemsInput) {
		return this.dc.transactWrite(request).promise();
	}
}
