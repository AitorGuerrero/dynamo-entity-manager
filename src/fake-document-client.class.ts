import { DynamoDB } from 'aws-sdk';
import { EventEmitter } from 'events';

import DocumentClient = DynamoDB.DocumentClient;

export type TableName = string;

export class FakeDocumentClient {
	public stepMode: boolean;
	public readonly collections: {
		[tableName: string]: { [hashKey: string]: { [rangeKey: string]: string } };
	};
	private readonly keySchemas: { [tableName: string]: { hashKey: string; rangeKey: string } };
	private resumed: Promise<any>;
	private resumedEventEmitter: EventEmitter;
	private shouldFail: boolean;
	private error: Error;

	constructor(keySchemas: { [tableName: string]: DocumentClient.KeySchema }) {
		this.resumed = Promise.resolve();
		this.stepMode = false;
		this.resumedEventEmitter = new EventEmitter();
		this.shouldFail = false;
		this.collections = {};
		this.keySchemas = {};
		for (const tableName of Object.keys(keySchemas)) {
			this.keySchemas[tableName] = {
				hashKey: keySchemas[tableName].find((ks) => ks.KeyType === 'HASH').AttributeName,
				rangeKey:
					keySchemas[tableName].find((ks) => ks.KeyType === 'RANGE') === undefined
						? undefined
						: keySchemas[tableName].find((ks) => ks.KeyType === 'RANGE').AttributeName,
			};
		}
	}

	/* istanbul ignore next */
	public async set(tableName: TableName, item: DocumentClient.AttributeMap) {
		await this.put({ TableName: tableName, Item: item }).promise();
	}

	public getByKey<IEntity>(tableName: TableName, key: DocumentClient.Key): IEntity {
		return this.syncGet({ TableName: tableName, Key: key }).Item as IEntity;
	}

	public put(input: DocumentClient.PutItemInput) {
		return {
			promise: async () => {
				await this.awaitFlush();
				await this.guardShouldFail();
				this.putItem(input);
				return {};
			},
		};
	}

	/* istanbul ignore next */
	public transactWrite(input: DocumentClient.TransactWriteItemsInput) {
		return {
			promise: async () => {
				await this.awaitFlush();
				await this.guardShouldFail();
				for (const item of input.TransactItems) {
					if (item.Update) {
						throw new Error('fake transact update not implemented');
					} else if (item.Put) {
						this.putItem(item.Put);
					} else if (item.Delete) {
						this.deleteItem(item.Delete);
					}
				}

				return {};
			},
		};
	}

	/* istanbul ignore next */
	public delete(input: DocumentClient.DeleteItemInput) {
		return {
			promise: async () => this.deleteItem(input),
		};
	}

	/* istanbul ignore next */
	public flush() {
		this.resumedEventEmitter.emit('resumed');
		this.resumed = new Promise((rs) => this.resumedEventEmitter.once('resumed', rs));
	}

	public failOnCall(error?: Error) {
		this.shouldFail = true;
		this.error = error;
	}

	private syncGet(input: DocumentClient.GetItemInput): DocumentClient.GetItemOutput {
		const hashKey = input.Key[this.keySchemas[input.TableName].hashKey];
		const rangeKey = input.Key[this.keySchemas[input.TableName].rangeKey];
		if (this.collections[input.TableName] === undefined) {
			return {};
		} else if (this.keySchemas[input.TableName].rangeKey === undefined) {
			return { Item: JSON.parse(this.collections[input.TableName][hashKey] as any) };
		} else if (this.collections[input.TableName][hashKey][rangeKey] === undefined) {
			return {};
		} else {
			return { Item: JSON.parse(this.collections[input.TableName][hashKey][rangeKey]) };
		}
	}

	private putItem(itemInput: DocumentClient.Put) {
		const hashKey = itemInput.Item[this.keySchemas[itemInput.TableName].hashKey];
		const rangeKey = itemInput.Item[this.keySchemas[itemInput.TableName].rangeKey];
		this.ensureHashKey(itemInput.TableName, hashKey);
		if (this.keySchemas[itemInput.TableName].rangeKey === undefined) {
			this.collections[itemInput.TableName][hashKey] = JSON.stringify(itemInput.Item) as any;
		} else {
			this.collections[itemInput.TableName][hashKey][rangeKey] = JSON.stringify(itemInput.Item);
		}
	}

	private deleteItem(itemInput: DocumentClient.Delete) {
		const hashKey = itemInput.Key[this.keySchemas[itemInput.TableName].hashKey];
		const rangeKey = itemInput.Key[this.keySchemas[itemInput.TableName].rangeKey];
		if (this.keySchemas[itemInput.TableName].rangeKey === undefined) {
			this.collections[itemInput.TableName][hashKey] = undefined;
		} else {
			this.collections[itemInput.TableName][hashKey][rangeKey] = undefined;
		}
	}

	private async awaitFlush() {
		if (this.stepMode) {
			await this.resumed;
		}
	}

	private async guardShouldFail() {
		if (this.shouldFail === false) {
			return;
		}
		throw this.error !== undefined ? this.error : new Error('Repository error');
	}

	private ensureHashKey(tableName: string, hashKey: string) {
		if (this.collections[tableName] === undefined) {
			this.collections[tableName] = {};
		}
		if (this.collections[tableName][hashKey] === undefined) {
			this.collections[tableName][hashKey] = {};
		}
	}
}
