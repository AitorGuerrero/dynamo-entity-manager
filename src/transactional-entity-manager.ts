import {DynamoDB} from "aws-sdk";
import {Action, DynamoEntityManager, ITrackedITem} from "./entity-manager.class";
import ErrorFlushingEntity from "./error.flushing.class";
import {EventType} from "./event-type.enum";
import {ITableConfig} from "./table-config.interface";

import DocumentClient = DynamoDB.DocumentClient;

const maxTransactWriteElems = 10;

export default class TransactionalEntityManager extends DynamoEntityManager {

	private static createItemTransactional<E>(trackedEntity: ITrackedITem<E>): DynamoDB.TransactWriteItem {
		const marshaledEntity = trackedEntity.tableConfig.marshal(trackedEntity.entity);
		return {
			Put: Object.assign(
				TransactionalEntityManager.buildConditionExpression(marshaledEntity, trackedEntity.tableConfig),
				{
					Item: DynamoEntityManager.addVersionToCreateItem(marshaledEntity, trackedEntity.tableConfig),
					TableName: trackedEntity.tableConfig.tableName,
				},
			),
		};
	}

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

	protected async flushTracked() {
		await this.processOperations(this.buildOperations());
	}

	private buildOperations() {
		const operations: DocumentClient.TransactWriteItem[] = [];
		for (const entityConfig of this.tracked.values()) {
			operations.push(this.flushEntity(entityConfig));
		}

		return operations.filter((i) => i !== undefined);
	}

	private async processOperations(operations: DocumentClient.TransactWriteItem[]) {
		if (operations.length > maxTransactWriteElems) {
			this.eventEmitter.emit("maxTransactWriteElemsAlert");
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
			this.eventEmitter.emit(EventType.error, new ErrorFlushingEntity(err));

			throw err;
		}
	}

	private flushEntity<E>(entityConfig: ITrackedITem<E>): DynamoDB.TransactWriteItem {
		switch (entityConfig.action) {
			case Action.update:
				return this.updateItemTransactional(entityConfig);
			case Action.delete:
				return this.deleteItemTransactional(entityConfig);
			case Action.create:
				return TransactionalEntityManager.createItemTransactional(entityConfig);
		}
	}

	private asyncTransaction(request: DocumentClient.TransactWriteItemsInput) {
		return this.dc.transactWrite(request);
	}

	private updateItemTransactional<Entity>(trackedEntity: ITrackedITem<Entity>): DocumentClient.TransactWriteItem {
		const tableConfig = trackedEntity.tableConfig;
		if (!DynamoEntityManager.entityHasChanged(trackedEntity)) {
			return;
		}

		return {
			Put: this.addVersionConditionExpression(
				{
					Item: DynamoEntityManager.addVersionToUpdateItem(
						tableConfig.marshal(trackedEntity.entity),
						trackedEntity,
						tableConfig,
					),
					TableName: tableConfig.tableName,
				},
				trackedEntity.entity,
				tableConfig,
			),
		};
	}

	private deleteItemTransactional<E>(trackedEntity: ITrackedITem<E>): DynamoDB.TransactWriteItem {
		return {
			Delete: this.addVersionConditionExpression({
				Key: DynamoEntityManager.getEntityKey(trackedEntity.entity, trackedEntity.tableConfig),
				TableName: trackedEntity.tableConfig.tableName,
			}, trackedEntity.entity, trackedEntity.tableConfig),
		};
	}
}
