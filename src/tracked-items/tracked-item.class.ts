import {DynamoDB} from "aws-sdk";
import {ITableConfig} from "../table-config.interface";

import DocumentClient = DynamoDB.DocumentClient;

export default abstract class TrackedItem<Entity> {

	protected initialStatus?: string;

	protected constructor(
		public readonly entity: Entity,
		public readonly tableConfig: ITableConfig<Entity>,
		public readonly version?: number,
	) {}

	public getEntityKey() {
		const key: DocumentClient.Key = {};
		const marshaled = this.tableConfig.marshal(this.entity);
		key[this.tableConfig.keySchema.hash] = marshaled[this.tableConfig.keySchema.hash];
		if (this.tableConfig.keySchema.range) {
			key[this.tableConfig.keySchema.range] = marshaled[this.tableConfig.keySchema.range];
		}

		return key;
	}
}
