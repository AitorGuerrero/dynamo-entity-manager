import { DynamoDB } from 'aws-sdk';
import TrackedItem from '../tracked-items/tracked-item.class';

export default function addVersionToUpdateItem<Entity>(
	item: any,
	trackedItem: TrackedItem<Entity>,
): DynamoDB.DocumentClient.PutItemInputAttributeMap {
	if (trackedItem.tableConfig.versionKey !== undefined) {
		item[trackedItem.tableConfig.versionKey] = trackedItem.version + 1;
	}

	return item;
}
