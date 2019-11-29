import {DynamoDB} from "aws-sdk";
import {expect} from "chai";
import {beforeEach, describe, it} from "mocha";
import PoweredDynamo from "powered-dynamo";
import {DynamoEntityManager, TransactionalFlusher} from "../";
import {FakeDocumentClient} from "./fake-document-client.class";
import TransactionItemsLimitReached from "./flushers/error.transaction-items-limit-reached.class";
import ParallelFlusher from "./flushers/parallel.class";
import {ITableConfig} from "./table-config.interface";

describe("Having entity manager with transactional flusher", () => {
	interface IEntity {
		hashAttr: string;
		rangeAttr: string;
		marshaled: false;
		updatableValue: any;
	}

	const tableName = "entityTable";
	const versionKey = "v";
	const hashAttr = "hashAttr";
	const rangeAttr = "rangeAttr";
	const keySchema = [{KeyType: "HASH", AttributeName: hashAttr}, {KeyType: "RANGE", AttributeName: rangeAttr}];
	const marshal = (e: IEntity) => Object.assign(JSON.parse(JSON.stringify(e)), {marshaled: true});
	const tableConfig: ITableConfig<any> = {
		keySchema: {hash: hashAttr, range: rangeAttr},
		marshal,
		tableName,
		versionKey,
	};

	let entityManager: DynamoEntityManager;
	let documentClient: FakeDocumentClient;

	beforeEach(() => {
		documentClient = new FakeDocumentClient({[tableName]: keySchema});
		const poweredDynamo = new PoweredDynamo(documentClient as any as DynamoDB.DocumentClient);
		entityManager = new DynamoEntityManager(
			new TransactionalFlusher(poweredDynamo),
			[tableConfig],
		);
	});
	describe("and creating a entity", () => {
		let entity: IEntity;

		beforeEach(() => {
			entity = {
				hashAttr,
				marshaled: false,
				rangeAttr,
				updatableValue: null,
			};
			entityManager.trackNew(tableName, entity);
		});
		it("Should not persist before flushing", async () => {
			const persisted = await documentClient.getByKey(tableName, {hashAttr, rangeAttr});
			expect(persisted).to.be.undefined;
		});
		describe("and flushing", () => {
			beforeEach(() => entityManager.flush());
			it("should persist in the db", async () => {
				const persisted = await documentClient.getByKey<any>(tableName, {hashAttr, rangeAttr});
				expect(persisted).not.to.be.undefined;
				expect(persisted.hashAttr).to.be.eq(hashAttr);
				expect(persisted.rangeAttr).to.be.eq(rangeAttr);
			});
			it("should persist marshaled", async () => {
				const persisted = await documentClient.getByKey<any>(tableName, {hashAttr, rangeAttr});
				expect(persisted.marshaled).to.be.true;
			});
			it("should persist with 0 version", async () => {
				const persisted = await documentClient.getByKey<any>(tableName, {hashAttr, rangeAttr});
				expect(persisted.v).to.be.eq(0);
			});
		});
		describe("and deleting the entity", () => {
			beforeEach(() => entityManager.delete(tableName, entity));
			describe("and flushing", () => {
				beforeEach(() => entityManager.flush());
				it("should not persist the entity", () => {
					expect(documentClient.getByKey(tableName, {[hashAttr]: hashAttr, [rangeAttr]: rangeAttr})).to.be.undefined;
				});
			});
		});
	});
	describe("and a existent entity", () => {
		const originalUpdatableValue = "originalUpdatableValue";

		let entity: IEntity;

		beforeEach(async () => {
			entity = {
				hashAttr,
				marshaled: false,
				rangeAttr,
				updatableValue: originalUpdatableValue,
			};
			await new Promise((rs, rj) => documentClient.put(
				{TableName: tableName, Item: entity},
				(err) => err ? rj(err) : rs(),
			));
			entityManager.track(tableName, entity);
		});
		describe("when updating the entity", () => {
			const updatedValue = "updatedValue";
			beforeEach(() => entity.updatableValue = updatedValue);
			describe("and flushed", () => {
				beforeEach(() => entityManager.flush());
				it("Should persist updated", async () => {
					const persisted = await documentClient.getByKey<any>(tableName, {hashAttr, rangeAttr});
					expect(persisted.updatableValue).to.be.eq(updatedValue);
				});
			});
		});
		describe("when deleting the entity", () => {
			beforeEach(() => entityManager.delete(tableName, entity));
			describe("and flushed", () => {
				beforeEach(() => entityManager.flush());
				it("the entity should not be in the document client", async () => {
					const persistedEntity = await documentClient.getByKey(tableName, {hashAttr, rangeAttr});
					expect(persistedEntity).to.be.undefined;
				});
			});
		});
	});
	describe("and Dynamo TransactWrite fails", () => {

		let thrownError: Error;
		let emittedError: Error;
		const documentClientError = new Error();

		beforeEach(async () => {
			entityManager.trackNew(tableName, {
				hashAttr,
				marshaled: false,
				rangeAttr,
				updatableValue: null,
			});
			entityManager.eventEmitter.on("error", (err) => emittedError = err);
			documentClient.failOnCall(documentClientError);
			await entityManager.flush().catch((err) => thrownError = err);
		});

		it("should emit error", () => expect(emittedError).to.be.equal(documentClientError));
		it("should resolve promise to error", () => expect(thrownError).to.be.equal(documentClientError));
	});
	describe("and there are more than 10 updates to be done", () => {
		let thrownError: Error;
		let emittedError: Error;

		beforeEach(async () => {
			for (let i = 0; i < 11; i++) {
				entityManager.trackNew(
					tableName,
					{
						hashAttr: `hash_${i}`,
						marshaled: false,
						rangeAttr: `range_${i}`,
						updatableValue: null,
					});
			}
			entityManager.eventEmitter.on("error", (err) => emittedError = err);
			await entityManager.flush().catch((err) => thrownError = err);
		});
		it("should emit error", () => expect(emittedError).to.be.instanceOf(TransactionItemsLimitReached));
		it("should resolve promise to error", () => expect(thrownError).to.be.instanceOf(TransactionItemsLimitReached));
	});
	describe("and asking to track undefined", () => {
		it("should not fail", () => entityManager.track(tableName, undefined));
	});
	describe("and asking to track new undefined", () => {
		it("should not fail", () => entityManager.trackNew(tableName, undefined));
	});
	describe("and asking to delete undefined", () => {
		it("should not fail", () => entityManager.delete(tableName, undefined));
	});
});

describe("Having entity manager with parallel flusher", () => {
	interface IEntity {
		hashAttr: string;
		rangeAttr: string;
		marshaled: false;
		updatableValue: any;
	}

	const tableName = "entityTable";
	const versionKey = "v";
	const hashAttr = "hashAttr";
	const rangeAttr = "rangeAttr";
	const keySchema = [{KeyType: "HASH", AttributeName: hashAttr}, {KeyType: "RANGE", AttributeName: rangeAttr}];
	const marshal = (e: IEntity) => Object.assign(JSON.parse(JSON.stringify(e)), {marshaled: true});
	const tableConfig: ITableConfig<any> = {
		keySchema: {hash: hashAttr, range: rangeAttr},
		marshal,
		tableName,
		versionKey,
	};

	let entityManager: DynamoEntityManager;
	let documentClient: FakeDocumentClient;

	beforeEach(() => {
		documentClient = new FakeDocumentClient({[tableName]: keySchema});
		const poweredDynamo = new PoweredDynamo(documentClient as any as DynamoDB.DocumentClient);
		entityManager = new DynamoEntityManager(
			new ParallelFlusher(poweredDynamo),
			[tableConfig],
		);
	});
	describe("and creating a entity", () => {
		let entity: IEntity;

		beforeEach(() => {
			entity = {
				hashAttr,
				marshaled: false,
				rangeAttr,
				updatableValue: null,
			};
			entityManager.trackNew(tableName, entity);
		});
		it("Should not persist before flushing", async () => {
			const persisted = await documentClient.getByKey(tableName, {hashAttr, rangeAttr});
			expect(persisted).to.be.undefined;
		});
		describe("and flushing", () => {
			beforeEach(() => entityManager.flush());
			it("should persist in the db", async () => {
				const persisted = await documentClient.getByKey<any>(tableName, {hashAttr, rangeAttr});
				expect(persisted).not.to.be.undefined;
				expect(persisted.hashAttr).to.be.eq(hashAttr);
				expect(persisted.rangeAttr).to.be.eq(rangeAttr);
			});
			it("should persist marshaled", async () => {
				const persisted = await documentClient.getByKey<any>(tableName, {hashAttr, rangeAttr});
				expect(persisted.marshaled).to.be.true;
			});
			it("should persist with 0 version", async () => {
				const persisted = await documentClient.getByKey<any>(tableName, {hashAttr, rangeAttr});
				expect(persisted.v).to.be.eq(0);
			});
		});
		describe("and deleting the entity", () => {
			beforeEach(() => entityManager.delete(tableName, entity));
			describe("and flushing", () => {
				beforeEach(() => entityManager.flush());
				it("should not persist the entity", () => {
					expect(documentClient.getByKey(tableName, {[hashAttr]: hashAttr, [rangeAttr]: rangeAttr})).to.be.undefined;
				});
			});
		});
	});
	describe("and a existent entity", () => {
		const originalUpdatableValue = "originalUpdatableValue";

		let entity: IEntity;

		beforeEach(async () => {
			entity = {
				hashAttr,
				marshaled: false,
				rangeAttr,
				updatableValue: originalUpdatableValue,
			};
			await new Promise((rs, rj) => documentClient.put(
				{TableName: tableName, Item: entity},
				(err) => err ? rj(err) : rs(),
			));
			entityManager.track(tableName, entity);
		});
		describe("when updating the entity", () => {
			const updatedValue = "updatedValue";
			beforeEach(() => entity.updatableValue = updatedValue);
			describe("and flushed", () => {
				beforeEach(() => entityManager.flush());
				it("Should persist updated", async () => {
					const persisted = await documentClient.getByKey<any>(tableName, {hashAttr, rangeAttr});
					expect(persisted.updatableValue).to.be.eq(updatedValue);
				});
			});
		});
		describe("when deleting the entity", () => {
			beforeEach(() => entityManager.delete(tableName, entity));
			describe("and flushed", () => {
				beforeEach(() => entityManager.flush());
				it("the entity should not be in the document client", async () => {
					const persistedEntity = await documentClient.getByKey(tableName, {hashAttr, rangeAttr});
					expect(persistedEntity).to.be.undefined;
				});
			});
		});
	});
});
