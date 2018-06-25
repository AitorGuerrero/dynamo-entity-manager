import {DynamoDB} from "aws-sdk";
import DocumentClient = DynamoDB.DocumentClient;

const hash = "HASH";
const range = "RANGE";

export default function getEntityKey<Entity>(keySchema: DocumentClient.KeySchema, entity: Entity) {
	const hashKey = keySchema.find((k) => k.KeyType === hash).AttributeName;
	const rangeSchema = keySchema.find((k) => k.KeyType === range);
	const rangeKey = rangeSchema ? rangeSchema.AttributeName : undefined;

	const key: DocumentClient.Key = {};
	key[hashKey] = (entity as any)[hashKey];
	if (rangeKey) {
		key[rangeKey] = (entity as any)[rangeKey];
	}

	return key;
}
