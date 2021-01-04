import { EventEmitter } from 'events';
import { TrackedItems } from '../entity-manager.class';
import CreatedTrackedItem from '../tracked-items/created.class';
import DeletedTrackedItem from '../tracked-items/deleted.class';
import UpdatedTrackedItem from '../tracked-items/updated.class';
import addVersionConditionExpression from './add-version-condition-expression.function';
import addVersionToCreateItem from './add-version-to-create-item.function';
import addVersionToUpdateItem from './add-version-to-update-item.function';
import PoweredDynamo from 'powered-dynamo';
import IFlusher from './flusher.interface';

export default class ParallelFlusher implements IFlusher {
	/**
	 * @param poweredDynamo: PoweredDynamo
	 * @param eventEmitter: EventEmitter
	 */
	constructor(
		protected poweredDynamo: PoweredDynamo,
		public readonly eventEmitter = new EventEmitter(),
	) {}

	/**
	 * Flushes all the changes made to loaded entities.
	 * @returns {Promise<void>}
	 */
	public async flush(tracked: TrackedItems<unknown>) {
		const processes: Promise<any>[] = [];
		for (const entityConfig of tracked.values()) {
			if (entityConfig instanceof CreatedTrackedItem) {
				processes.push(this.createItem(entityConfig));
			} else if (entityConfig instanceof UpdatedTrackedItem) {
				processes.push(this.updateItem(entityConfig));
			} else if (entityConfig instanceof DeletedTrackedItem) {
				processes.push(this.deleteItem(entityConfig));
			}
		}

		await Promise.all(processes);
	}

	private async createItem<E>(trackedEntity: CreatedTrackedItem<E>) {
		await this.poweredDynamo.put({
			Item: addVersionToCreateItem(
				trackedEntity.tableConfig.marshal(trackedEntity.entity),
				trackedEntity.tableConfig,
			),
			TableName: trackedEntity.tableConfig.tableName,
		});
	}

	private async updateItem<E>(trackedEntity: UpdatedTrackedItem<E>) {
		const tableConfig = trackedEntity.tableConfig;
		if (!trackedEntity.hasChanged) {
			return;
		}

		await this.poweredDynamo.put(
			addVersionConditionExpression(trackedEntity, {
				Item: addVersionToUpdateItem(tableConfig.marshal(trackedEntity.entity), trackedEntity),
				TableName: tableConfig.tableName,
			}),
		);
	}

	private async deleteItem<E>(trackedEntity: DeletedTrackedItem<E>) {
		await this.poweredDynamo.delete(
			addVersionConditionExpression(trackedEntity, {
				Key: trackedEntity.getEntityKey(),
				TableName: trackedEntity.tableConfig.tableName,
			}),
		);
	}
}
