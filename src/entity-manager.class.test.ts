import {DynamoDB} from "aws-sdk";
import {expect} from "chai";
import {beforeEach, describe, it} from "mocha";
import {DynamoEntityManager} from "./entity-manager.class";
import {FakeDocumentClient} from "./fake-document-client.class";
import {ITableConfig} from "./table-config.interface";

describe("Having a class entity type", () => {
	class Entity {
		public hashAttr: string;
		public rangeAttr: string;
		public marshaled: false;
		public updatableValue: any;
	}

	const tableName = "entityTable";
	const keySchema = [{KeyType: "HASH", AttributeName: "hashAttr"}, {KeyType: "RANGE", AttributeName: "rangeAttr"}];
	const marshal = (e: Entity) => Object.assign(JSON.parse(JSON.stringify(e)), {marshaled: true});
	const tableConfig: ITableConfig<any> = {keySchema, tableName, marshal};

	let entityManager: DynamoEntityManager;
	let documentClient: FakeDocumentClient;

	beforeEach(() => {
		documentClient = new FakeDocumentClient({[tableName]: keySchema});
		entityManager = new DynamoEntityManager(
			documentClient as any as DynamoDB.DocumentClient,
			[tableConfig],
		);
	});
	describe("when creating a entity", () => {
		const hashAttr = "entityHashAttr";
		const rangeAttr = "entityRangeAttr";

		let entity: Entity;

		beforeEach(() => {
			entity = new Entity();
			entity.hashAttr = hashAttr;
			entity.rangeAttr = rangeAttr;
			entity.marshaled = false;
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
		});
	});
	describe("and a existent entity", () => {
		const hashAttr = "entityHashAttr";
		const rangeAttr = "entityRangeAttr";
		const originalUpdatableValue = "originalUpdatableValue";

		let entity: Entity;

		beforeEach(async () => {
			entity = new Entity();
			entity.hashAttr = hashAttr;
			entity.rangeAttr = rangeAttr;
			entity.updatableValue = originalUpdatableValue;
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
	});
});
