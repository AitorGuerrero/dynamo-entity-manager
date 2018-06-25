import {DynamoDB} from "aws-sdk";

export interface ITableConfig<Entity> {
	tableName: string;
	keySchema: DynamoDB.DocumentClient.KeySchema;
	marshal?: (e: Entity) => DynamoDB.DocumentClient.AttributeMap;
}
