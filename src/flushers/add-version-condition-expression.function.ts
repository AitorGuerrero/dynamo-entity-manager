import { DynamoDB } from 'aws-sdk';
import TrackedItem from '../tracked-items/tracked-item.class';

export default function addVersionConditionExpression<I>(
	tracked: TrackedItem<unknown>,
	input: I & (DynamoDB.DocumentClient.Put | DynamoDB.DocumentClient.Delete),
) {
	if (tracked.tableConfig.versionKey !== undefined && tracked.version > 0) {
		input.ConditionExpression = '#version=:version';
		input.ExpressionAttributeNames = Object.assign({}, input.ExpressionAttributeNames, {
			'#version': tracked.tableConfig.versionKey,
		});
		input.ExpressionAttributeValues = Object.assign({}, input.ExpressionAttributeValues, {
			':version': tracked.version,
		});
	}

	return input;
}
