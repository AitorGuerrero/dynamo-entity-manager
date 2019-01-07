import {DynamoDB} from "aws-sdk";

export interface ITableConfig<Entity> {
	tableName: string;
	keySchema: {hash: string, range: string};
	marshal?: (e: Entity) => DynamoDB.DocumentClient.AttributeMap;
	versionKey?: string;
}
