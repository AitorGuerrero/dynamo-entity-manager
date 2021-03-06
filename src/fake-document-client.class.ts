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
	private hashKey: string;
	private rangeKey: string;

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
	public get(input: DocumentClient.GetItemInput) {
		return {
			promise: async () => {
				await this.awaitFlush();
				this.guardShouldFail();
				return this.syncGet(input);
			},
		};
	}

	/* istanbul ignore next */
	public async set(tableName: TableName, item: DocumentClient.AttributeMap) {
		await this.put({ TableName: tableName, Item: item }).promise();
	}

	public getByKey<IEntity>(tableName: TableName, key: DocumentClient.Key): IEntity {
		return this.syncGet({ TableName: tableName, Key: key }).Item as IEntity;
	}

	/* istanbul ignore next */
	public batchGet(input: DocumentClient.BatchGetItemInput) {
		return {
			promise: async () => {
				await this.awaitFlush();
				this.guardShouldFail();
				const response: DocumentClient.BatchGetItemOutput = { Responses: {} };
				for (const tableName in input.RequestItems)
					if (input.RequestItems.hasOwnProperty(tableName)) {
						response.Responses[tableName] = [];
						for (const request of input.RequestItems[tableName].Keys) {
							const hashKey = request[this.keySchemas[tableName].hashKey];
							const rangeKey = request[this.keySchemas[tableName].rangeKey];
							this.ensureHashKey(tableName, hashKey);
							let item: any;
							if (this.keySchemas[tableName].rangeKey === undefined) {
								item = this.collections[tableName][hashKey];
							} else {
								item = this.collections[tableName][hashKey][rangeKey];
							}
							if (item !== undefined) {
								response.Responses[tableName].push(item);
							}
						}
					}

				return response;
			},
		};
	}

	/* istanbul ignore next */
	public scan(input: DocumentClient.ScanInput) {
		return {
			promise: async () => {
				await this.awaitFlush();
				this.guardShouldFail();
				const response: DocumentClient.ScanOutput = { Items: [] };
				const startKey = this.getStartKey(input.TableName, input.ExclusiveStartKey);
				const hashKeys = Object.keys(this.collections[input.TableName]);
				let hashKey = startKey.hash;
				let rangeKey = startKey.range;
				while (this.collections[input.TableName][hashKey] !== undefined) {
					const rangeKeys = Object.keys(this.collections[input.TableName][hashKey]);
					if (this.keySchemas[input.TableName].rangeKey === undefined) {
						response.Items.push(this.collections[input.TableName][hashKey]);
					} else {
						while (this.collections[input.TableName][hashKey][rangeKey] !== undefined) {
							response.Items.push(JSON.parse(this.collections[input.TableName][hashKey][rangeKey]));
							rangeKey = rangeKeys[rangeKeys.indexOf(rangeKey) + 1];
						}
					}
					hashKey = hashKeys[hashKeys.indexOf(hashKey) + 1];
				}
				if (hashKey !== undefined) {
					response.LastEvaluatedKey = {
						[this.keySchemas[input.TableName].hashKey]: hashKey,
						[this.keySchemas[input.TableName].rangeKey]: rangeKey,
					};
				}

				return response;
			},
		};
	}

	/* istanbul ignore next */
	public query(input: DocumentClient.QueryInput) {
		return {
			promise: async () => {
				await this.awaitFlush();
				this.guardShouldFail();
				const response: DocumentClient.ScanOutput = { Items: [] };
				const startKey = this.getStartKey(input.TableName, input.ExclusiveStartKey);
				const hashKeys = Object.keys(this.collections[input.TableName]);
				let hashKey = startKey.hash;
				let rangeKey = startKey.range;
				while (this.collections[input.TableName][hashKey] !== undefined) {
					const rangeKeys = Object.keys(this.collections[input.TableName][hashKey]);
					if (this.keySchemas[input.TableName].rangeKey === undefined) {
						response.Items.push(this.collections[input.TableName][hashKey]);
					} else {
						while (this.collections[input.TableName][hashKey][rangeKey] !== undefined) {
							response.Items.push(JSON.parse(this.collections[input.TableName][hashKey][rangeKey]));
							rangeKey = rangeKeys[rangeKeys.indexOf(rangeKey) + 1];
						}
					}
					hashKey = hashKeys[hashKeys.indexOf(hashKey) + 1];
				}
				if (hashKey !== undefined) {
					response.LastEvaluatedKey = {
						[this.keySchemas[input.TableName].hashKey]: hashKey,
						[this.keySchemas[input.TableName].rangeKey]: rangeKey,
					};
				}

				return response;
			},
		};
	}

	/* istanbul ignore next */
	public update(input: DocumentClient.UpdateItemInput) {
		return {
			promise: async () => {
				await this.awaitFlush();
				this.guardShouldFail();
				const item = this.getByKey(input.TableName, input.Key);
				const updates: { k: string; v: any }[] = /UPDATE/.test(input.UpdateExpression)
					? /UPDATE ([^,]*)/
							.exec(input.UpdateExpression)[1]
							.split(' AND ')
							.map((s) => s.replace(' ', '').split('='))
							.map((s) => ({ k: s[0], v: s[1] }))
					: [];
				const deletes: string[] = /DELETE/.test(input.UpdateExpression)
					? /DELETE ([^,]*)/
							.exec(input.UpdateExpression)[1]
							.split(' AND ')
							.map((s) => s.replace(' ', ''))
					: [];

				for (const update of updates) {
					let toUpdate: any = item;
					for (const k of update.k.split('.')) {
						const realName = input.ExpressionAttributeNames[k];
						if (typeof toUpdate[realName] !== 'object') {
							toUpdate[realName] = input.ExpressionAttributeValues[update.v];
							continue;
						}
						toUpdate = toUpdate[realName];
					}
				}
				for (const deleteField of deletes) {
					let toDelete: any = item;
					for (const k of deleteField.split('.')) {
						const realName = input.ExpressionAttributeNames[k];
						if (typeof toDelete[realName] !== 'object') {
							toDelete[realName] = undefined;
							continue;
						}
						toDelete = toDelete[realName];
					}
				}
				this.putItem({ TableName: input.TableName, Item: item });

				return {};
			},
		};
	}

	public put(input: DocumentClient.PutItemInput) {
		return {
			promise: async () => {
				await this.awaitFlush();
				this.guardShouldFail();
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
				this.guardShouldFail();
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
			promise: async () => {
				this.deleteItem(input);
				return {};
			},
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

	private getStartKey(tableName: string, exclusiveStartKey: DocumentClient.Key) {
		let range: string;
		let hash: string;

		if (exclusiveStartKey === undefined) {
			hash = Object.keys(this.collections[tableName])[0];
			range = Object.keys(this.collections[tableName][hash])[0];
			return { hash, range };
		}

		hash = exclusiveStartKey[this.keySchemas[tableName].hashKey];
		const rangeKeys = Object.keys(
			this.collections[tableName][exclusiveStartKey[this.keySchemas[tableName].hashKey]],
		);
		range =
			rangeKeys[rangeKeys.indexOf(exclusiveStartKey[this.keySchemas[tableName].rangeKey]) + 1];
		if (range === undefined) {
			const hashKeys = Object.keys(this.collections[tableName]);
			hash = hashKeys[hashKeys.indexOf(hash) + 1];
			range = Object.keys(this.collections[tableName][hash])[0];
		}

		return { hash, range };
	}

	private async awaitFlush() {
		if (this.stepMode) {
			await this.resumed;
		}
	}

	private guardShouldFail() {
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
